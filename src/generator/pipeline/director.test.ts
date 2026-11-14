import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SettingsSchema } from "../spec.schema";
import { bulletProblems, counterReactProblem, DirectorSchema, directedBullet, directorInventory, directorPrompt, directStory, lapseProblems, modelSetBlock, modelSetProblems, normalizeDirector, vfxKind, vfxProblems, worldBlock } from "./director";
import { resetFixtureCounters } from "./llm";
import { buildTimeline, type Timeline } from "./timeline";
import type { WriterStory } from "./writer";

const story: WriterStory = {
  title: "Money Doubles",
  hook: "What if your money doubled every three seconds?",
  mood: "upbeat",
  characters: [],
  beats: ["b1", "b2", "b3", "b4", "b5"].map((id) => ({ id, say: `Line for ${id} goes here now.`, lines: [], see: "x", pace: "normal" as const, stress: "line" })),
};
const BEATS = story.beats.map((b) => b.id);
const paris = { world: { place: "paris", date: "2026-06-21", time: "12:00" }, time: "noon" };
const steps = [
  { beat: "b1", value: "1", sub: "one" },
  { beat: "b2", value: "2", sub: "two" },
  { beat: "b4", value: "1000", sub: "a thousand" },
];
const direct = (raw: unknown) => DirectorSchema.parse(normalizeDirector(raw));

test("director: the counter's react is fuzzy-matched like the other enums", () => {
  const react = (v: unknown) => direct({ scenes: [{ start: "b1" }], counter: { title: "X", unit: "x", steps, react: v } }).counter?.react;
  assert.equal(react("money"), "money");
  assert.equal(react("Money Rain"), "money");
  assert.equal(react("CONFETTI"), "confetti");
  assert.equal(react("darkness"), "dark");
  // By meaning when the name is missing.
  assert.equal(react("zero gravity"), "lift");
  assert.equal(react("earthquake"), "crack");
  assert.equal(react("power cut"), "dark");
  assert.equal(react("floods"), "water");
  assert.equal(react("winter"), "snow");
  assert.equal(react("banana"), undefined);
  assert.equal(react(undefined), undefined);
  // Other keys a model may use.
  assert.equal(direct({ scenes: [{ start: "b1" }], counter: { title: "X", steps, reaction: "lift" } }).counter?.react, "lift");
});

test("director: new world events parse, and near-misses land on the right one", () => {
  const events = (names: string[]) => direct({ scenes: [{ start: "b1" }], world: names.map((n, i) => ({ beat: `b${i + 1}`, event: n })) }).world.map((w) => w.event);
  assert.deepEqual(events(["gravity-off", "gravity on", "ground_break", "snow-start", "snow stop"]), ["gravity-off", "gravity-on", "ground-break", "snow-start", "snow-stop"]);
  assert.deepEqual(events(["power off", "blackout", "gravity returns", "earthquake"]), ["lights-out", "lights-out", "gravity-on", "ground-break"]);
});

test("director: a counter with a step in a world scene must say how the place reacts", () => {
  const kit = { start: "b1", kit: "street-block" };
  // A step in the Paris scene (b3 on) and no react: rejected, naming the steps.
  const problem = counterReactProblem(direct({ scenes: [kit, { start: "b3", ...paris }], counter: { title: "X", steps } }), BEATS);
  assert.ok(problem && /b4/.test(problem) && /react/.test(problem) && /money/.test(problem), problem ?? "no problem found");
  // With react it passes.
  assert.equal(counterReactProblem(direct({ scenes: [kit, { start: "b3", ...paris }], counter: { title: "X", steps, react: "money" } }), BEATS), null);
  // Every step in kit scenes: no react needed (kit stages ignore it).
  assert.equal(counterReactProblem(direct({ scenes: [kit, { start: "b5", ...paris }], counter: { title: "X", steps } }), BEATS), null);
  // No counter, nothing to check.
  assert.equal(counterReactProblem(direct({ scenes: [{ start: "b1", ...paris }], counter: null }), BEATS), null);
  // The first scene covers from b1 even when it names a later start (the assembler does the same).
  assert.ok(counterReactProblem(direct({ scenes: [{ start: "b2", ...paris }, { start: "b4", kit: "forest" }], counter: { title: "X", steps } }), BEATS));
  // A step at an unknown beat is ignored (the assembler drops it).
  assert.equal(counterReactProblem(direct({ scenes: [kit, { start: "b5", ...paris }], counter: { title: "X", steps: [...steps, { beat: "b9", value: "5", sub: "" }] } }), BEATS), null);
});

test("director: the prompt offers react with a meaning each, and the place events", () => {
  const text = directorInventory("What if money doubled?");
  for (const r of ["lift = weightless", "crack = pressure", "confetti = celebration", "money = wealth", "water = sea level", "snow = cold", "dark = power"]) {
    assert.ok(text.includes(r), `the prompt explains ${r}`);
  }
  assert.ok(/REQUIRED when any step falls in a world scene/.test(text));
  for (const e of ["gravity-off", "gravity-on", "ground-break", "snow-start", "snow-stop"]) assert.ok(text.includes(e), `the prompt offers ${e}`);
  assert.ok(/reaction beat: film it WS or EWS, or low/.test(text), "the shot hint");
});

test("director: the repair loop asks again when a world counter has no react", async () => {
  const dir = mkdtempSync(join(tmpdir(), "director-react-"));
  const reply = (react?: string) =>
    JSON.stringify({ scenes: [{ start: "b1", ...paris }], counter: { title: "YOUR MONEY", unit: "x", steps, ...(react ? { react } : {}) }, timer: null, prop: null, world: [] });
  writeFileSync(join(dir, "director-1.txt"), reply());
  writeFileSync(join(dir, "director-2.txt"), reply("money"));
  const before = process.env.FACTORY_LLM_FIXTURES;
  process.env.FACTORY_LLM_FIXTURES = dir;
  resetFixtureCounters();
  try {
    const timeline = buildTimeline({ beats: story.beats, lines: [], format: "9:16", target: 20, cap: 90, wps: 2.6 });
    const direction = await directStory({
      premise: "What if money doubled every 3 seconds?",
      story,
      timeline,
      settings: SettingsSchema.parse({ format: "9:16", targetDuration: 20 }),
      models: { writer: { provider: "ollama", model: "fixture" } },
    });
    assert.equal(direction.counter?.react, "money", "the second reply, with react, is the one used");
  } finally {
    if (before === undefined) delete process.env.FACTORY_LLM_FIXTURES;
    else process.env.FACTORY_LLM_FIXTURES = before;
    resetFixtureCounters();
    rmSync(dir, { recursive: true, force: true });
  }
});

const autumn = (time: string, lapse?: unknown) => ({ place: "paris", date: "2026-10-23", time, ...(lapse !== undefined ? { lapse } : {}) });
/** Five beats of 4 s (b1 0-4 .. b5 16-20). */
const timeline20 = { beats: BEATS.map((id, i) => ({ id, from: i * 4, to: i * 4 + 4 })), duration: 20 } as unknown as Pick<Timeline, "beats" | "duration">;

test("director: a time-lapse rides on the world choice; clock times, words and aliases normalize", () => {
  const lapse = (v: unknown, onScene = false) =>
    direct({ scenes: [onScene ? { start: "b1", world: autumn("17:00"), lapse: v } : { start: "b1", world: autumn("17:00", v) }] }).scenes[0].worldPlace?.lapse;
  assert.deepEqual(lapse({ to: "19:30" }), { to: "19:30" });
  assert.deepEqual(lapse({ to: "9:30" }), { to: "09:30" }, "an hour without its zero");
  assert.deepEqual(lapse("Night"), { to: "night" }, "a bare word");
  assert.deepEqual(lapse({ until: "nightfall" }), { to: "night" });
  assert.deepEqual(lapse({ to: "sunrise" }), { to: "dawn" });
  assert.deepEqual(lapse({ to: "blue hour" }), { to: "dusk" });
  assert.deepEqual(lapse({ to: "evening" }), { to: "evening" }, "kept as written, so the essential check asks for a repair");
  assert.deepEqual(lapse({ to: "dusk" }, true), { to: "dusk" }, "on the scene instead of the world choice");
  assert.equal(lapse(undefined), undefined);
  const plain = direct({ scenes: [{ start: "b1", ...paris }] }).scenes[0].worldPlace!;
  assert.ok(!("lapse" in plain), "no lapse key when the director wrote none");
});

test("director: a time-lapse must be usable, at most one, with real times in the repair", () => {
  const kit = { start: "b1", kit: "street-block" };
  const check = (scenes: unknown[]) => lapseProblems(direct({ scenes }), timeline20);
  // Paris at 17:00 in October, to night, over b3-b5 (12 s): fine.
  assert.equal(check([kit, { start: "b3", world: autumn("17:00", { to: "night" }) }]), null);
  assert.equal(check([kit, { start: "b3", world: autumn("17:00", { to: "19:30" }) }]), null);
  // No lapse: nothing to check.
  assert.equal(check([{ start: "b1", ...paris }]), null);
  // Half an hour at noon: the sun barely moves; the repair names the scene and real times.
  const noon = check([kit, { start: "b3", world: autumn("12:00", { to: "12:30" }) }]);
  assert.ok(noon && /scene at b3/.test(noon) && /barely moves/.test(noon) && /sunset 18:4\d/.test(noon), noon ?? "accepted");
  // A word that never comes, and one that isn't a word.
  assert.ok(/never comes after 21:00/.test(check([{ start: "b1", world: autumn("21:00", { to: "dusk" }) }]) ?? ""));
  assert.ok(/night, dusk, dawn, noon/.test(check([{ start: "b1", world: autumn("17:00", { to: "evening" }) }]) ?? ""));
  // Two lapses: keep one.
  const two = check([{ start: "b1", world: autumn("08:00", { to: "noon" }) }, { start: "b3", world: autumn("17:00", { to: "night" }) }]);
  assert.ok(two && /only one time-lapse per video/.test(two) && /scene at b1/.test(two) && /at b3/.test(two), two ?? "accepted");
  // Too short on screen: a lapse on b5 alone when the video ends 2 s into it.
  const shortEnd = { ...timeline20, duration: 18 };
  assert.ok(/at least 3 s/.test(lapseProblems(direct({ scenes: [kit, { start: "b5", world: autumn("17:00", { to: "night" }) }] }), shortEnd) ?? ""));
  // A broken place is the assembler's fallback, not a lapse problem.
  assert.equal(check([{ start: "b1", world: { place: "atlantis", date: "2026-10-23", time: "12:00", lapse: { to: "12:30" } } }]), null);
});

test("director: the prompt teaches the time-lapse and keeps it rare", () => {
  const text = worldBlock();
  assert.ok(text.includes('a "lapse" inside it only for a time-lapse'), "where the lapse goes");
  assert.ok(/TIME-LAPSE \(optional, at most one per video\)/.test(text));
  assert.ok(/a time-lapse scene is the exception/.test(directorInventory("What if a day lasted ten minutes?")), "the shot rule's exception");
});

test("director: the repair loop asks once about a lapse, then lets the assembler drop it", async () => {
  const reply = (lapse: unknown) => JSON.stringify({ scenes: [{ start: "b1", world: autumn("12:00", lapse) }], counter: null, timer: null, prop: null, world: [] });
  const run = async (replies: string[]) => {
    const dir = mkdtempSync(join(tmpdir(), "director-lapse-"));
    replies.forEach((r, i) => writeFileSync(join(dir, `director-${i + 1}.txt`), r));
    const before = process.env.FACTORY_LLM_FIXTURES;
    process.env.FACTORY_LLM_FIXTURES = dir;
    resetFixtureCounters();
    try {
      const timeline = buildTimeline({ beats: story.beats, lines: [], format: "9:16", target: 20, cap: 90, wps: 2.6 });
      return await directStory({
        premise: "What if a day lasted ten minutes?",
        story,
        timeline,
        settings: SettingsSchema.parse({ format: "9:16", targetDuration: 20 }),
        models: { writer: { provider: "ollama", model: "fixture" } },
      });
    } finally {
      if (before === undefined) delete process.env.FACTORY_LLM_FIXTURES;
      else process.env.FACTORY_LLM_FIXTURES = before;
      resetFixtureCounters();
      rmSync(dir, { recursive: true, force: true });
    }
  };
  // Noon to 12:30 is refused; the second reply runs to night.
  const fixed = await run([reply({ to: "12:30" }), reply({ to: "night" })]);
  assert.deepEqual(fixed.scenes[0].worldPlace?.lapse, { to: "night" }, "the repaired lapse is used");
  // Still wrong after one ask: accepted (no third reply is read), the assembler drops it.
  const still = await run([reply({ to: "12:30" }), reply({ to: "12:40" })]);
  assert.deepEqual(still.scenes[0].worldPlace?.lapse, { to: "12:40" });
});

/* ---- bullet time (docs/factory/14-bullet-time.md) ---- */

const plaza = (actors: unknown[]) => ({ start: "b3", world: { place: "paris", date: "2026-11-14", time: "16:50" }, time: "golden", actors });
const nadia = { role: "Nadia", where: "plaza-west" };
const karim = { role: "Karim, man in a grey hoodie", where: "plaza-east" };

test("director: bullet time normalizes from the usual spellings, and stays absent when not given", () => {
  const d = direct({ scenes: [{ start: "b1" }], bullet_time: { beat: "b4", hero: "Nadia", shooter: "Karim", bullets: "3", projectile: "Bullet", dodge: "LEAN", mode: "freeze" } });
  assert.deepEqual(d.bulletTime, { beat: "b4", hero: "Nadia", from: "Karim", shots: 3, kind: "bullet", dodge: "lean", freeze: true });
  assert.equal(direct({ scenes: [{ start: "b1" }] }).bulletTime, undefined, "old replies keep their shape");
  assert.equal(direct({ scenes: [{ start: "b1" }], bulletTime: null }).bulletTime, null);
  const none = direct({ scenes: [{ start: "b1" }], bulletTime: { beat: "b2", hero: "Nadia", from: "none", shots: 9, dodge: "sideways" } });
  assert.equal(none.bulletTime?.from, null);
  assert.equal(none.bulletTime?.shots, 6, "at most six");
});

test("director: a bullet time must sit on a world beat with its hero there; asked with the beat lengths", () => {
  const check = (raw: Record<string, unknown>) => bulletProblems(direct(raw), timeline20);
  const scenes = [{ start: "b1", kit: "forest" }, plaza([nadia, karim])];
  const bt = { beat: "b4", hero: "Nadia", from: "Karim", shots: 3, kind: "bullet", dodge: "lean", freeze: false };
  assert.equal(check({ scenes, bulletTime: bt }), null);
  assert.equal(check({ scenes, bulletTime: { ...bt, from: "south-east" } }), null, "shots from off screen");
  assert.equal(check({ scenes, bulletTime: { ...bt, from: "plaza-north" } }), null, "shots from a spot");
  assert.match(check({ scenes, bulletTime: { ...bt, beat: "b1" } }) ?? "", /only for a scene at a real world place/);
  assert.match(check({ scenes, bulletTime: { ...bt, hero: "Omar" } }) ?? "", /"Omar" is not a featured actor/);
  assert.match(check({ scenes, bulletTime: { ...bt, from: "the rooftops" } }) ?? "", /comes from "the rooftops"|come from "the rooftops"/);
  assert.match(check({ scenes: [scenes[0], { ...plaza([nadia]), world: { place: "paris", date: "2026-11-14", time: "16:50", lapse: { to: "17:30" } } }], bulletTime: bt }) ?? "", /time-lapse/);
  // The last beat is cut short by the video's end: its real length is in the repair.
  assert.equal(bulletProblems(direct({ scenes, bulletTime: { ...bt, beat: "b5" } }), timeline20), null, "b5 runs 16-20: 4 s is fine");
  const short = bulletProblems(direct({ scenes, bulletTime: { ...bt, beat: "b5" } }), { ...timeline20, duration: 18 });
  assert.match(short ?? "", /would last only 2\.0 s/);
  const tiny = bulletProblems(direct({ scenes: [{ start: "b1", kit: "forest" }, { ...plaza([nadia]), start: "b5" }], bulletTime: { ...bt, beat: "b5" } }), { beats: timeline20.beats.map((b) => (b.id === "b5" ? { ...b, to: 18 } : b)), duration: 18 } as never);
  assert.match(tiny ?? "", /would last only 1\.5 s.*b5 2\.0 s/);
});

test("director: the directed bullet time becomes the spec's, timed from the beat", () => {
  const scene = { from: 8, to: 20, kit: "world", world: {}, actors: [{ role: "Nadia" }, { role: "Karim, man in a grey hoodie" }] };
  const bt = directedBullet({ beat: "b4", hero: "Nadia", from: "Karim", shots: 3, kind: "bullet", dodge: "lean", freeze: false }, timeline20, scene);
  assert.ok(typeof bt !== "string", String(bt));
  assert.equal(bt.from, 12);
  assert.equal(bt.to, 16);
  assert.equal(bt.rate, 0.005);
  assert.deepEqual(bt.hero, { actor: "Nadia", rate: 0.4, dodge: "lean" });
  assert.deepEqual(bt.projectiles!.map((p) => p.pass), [0.3, 0.5, 0.7]);
  assert.deepEqual(bt.projectiles!.map((p) => p.miss), ["high", "high-left", "high-right"]);
  const frozen = directedBullet({ beat: "b4", hero: "Nadia", from: null, shots: 0, kind: "bullet", dodge: "none", freeze: true }, timeline20, scene);
  assert.ok(typeof frozen !== "string" && frozen.rate === 0 && !frozen.projectiles && !frozen.hero?.dodge, "a frozen moment with no projectiles");
});

test("director: the prompt teaches bullet time, keeps its actions out of the general list, and draws no crowd it doesn't have", () => {
  const text = worldBlock();
  assert.ok(/BULLET TIME/.test(text) && /nobody is ever hit/.test(text) && /"bulletTime": \{ "beat"/.test(text));
  assert.ok(!/Background crowds fill themselves/.test(text), "no promise of a crowd");
  assert.ok(/no background crowd/.test(text));
  const actionsLine = text.split("\n").find((l) => l.startsWith("Actions:"))!;
  assert.ok(!/\baim =|\bshoot =|\bdodge =/.test(actionsLine), actionsLine);
});

test("director: an actor step's time is never read as its target", () => {
  const d = direct({ scenes: [{ start: "b1", ...paris, actors: [{ role: "Karim", where: "plaza", do: [{ at: 13.2, action: "react" }, { at: 14, action: "look", target: "plaza-east" }] }] }] });
  const steps = d.scenes[0].actors![0].do!;
  assert.equal(steps[0].at, 13.2);
  assert.equal(steps[0].target, undefined, "no target from the time");
  assert.equal(steps[1].target, "plaza-east");
});

test("director: the new actions and their usual words, a pickup's prop, and the prompt lists them", () => {
  const d = direct({
    scenes: [
      {
        start: "b1",
        ...paris,
        actors: [
          {
            role: "Mara",
            where: "plaza",
            do: [
              { at: 1, action: "punch", target: "Tom" },
              { at: 2, action: "kick" },
              { at: 3, action: "pick up", prop: "box" },
              { at: 5, action: "put_down" },
              { at: 6, action: "kneel" },
              { at: 7, action: "stand up" },
              { at: 8, action: "climb" },
            ],
          },
        ],
      },
    ],
  });
  const steps = d.scenes[0].actors![0].do!;
  assert.deepEqual(steps.map((s) => s.action), ["punch", "kick", "pickup", "putdown", "crouch", "stand", "idle"], "no climb: unknown words stay idle");
  assert.equal(steps[2].prop, "box");
  assert.equal(steps[0].prop, undefined);
  const actionsLine = worldBlock().split("\n").find((l) => l.startsWith("Actions:"))!;
  for (const a of ["punch", "kick", "crouch", "stand", "pickup", "putdown"]) assert.ok(actionsLine.includes(`; ${a} = `), a);
  assert.match(worldBlock(), /"prop"\?: "bag"\|"box"\|"briefcase"/);
});

test("director: a model set rides on the scene by id, the prompt lists the generated sets, and an unknown one is asked about", () => {
  const d = direct({
    scenes: [
      { start: "b1", kit: "ocean", modelSet: { model: "kenney-pirate-kit-ship-large" }, actors: [{ role: "sailor", where: "aft", do: [{ at: 1, action: "walk", to: "fore" }] }] },
      { start: "b3", kit: "ocean", modelSet: "landmark-lighthouse" },
      { start: "b5", kit: "forest" },
    ],
  });
  assert.deepEqual(d.scenes[0].modelSet, { model: "kenney-pirate-kit-ship-large" });
  assert.deepEqual(d.scenes[1].modelSet, { model: "landmark-lighthouse" });
  assert.equal(d.scenes[2].modelSet, undefined);
  assert.equal(d.scenes[0].actors?.[0].where, "aft");
  assert.equal(modelSetProblems(d), null);
  const bad = direct({ scenes: [{ start: "b1", kit: "ocean", modelSet: { model: "a-spaceship" } }] });
  assert.match(modelSetProblems(bad) ?? "", /b1 \("a-spaceship"\) is not a listed set; use one of .*kenney-pirate-kit-ship-large.*landmark-lighthouse/);
  const block = modelSetBlock();
  assert.match(block, /MODEL SETS/);
  assert.match(block, /- kenney-pirate-kit-ship-large: the "ship large" model as a ship on open sea/);
  assert.match(block, /ship sets: actors' spots deck, fore, aft, port, starboard; the camera also frames scene, ship, bow, stern, mast/);
  assert.match(block, /tower sets: actors' spots door, back, left, right, shore/);
});

/* ---- effects (docs/factory/21-vfx-effekseer.md) ---- */

test("director: a scene's effects parse from the usual spellings; none listed, no key", () => {
  const d = direct({
    scenes: [
      {
        start: "b1",
        ...paris,
        effects: [
          { type: "Explosion", at: "beat 2", spot: "Plaza North", size: "1.5" },
          { effect: "flames", beat: 1, duration: 8, colour: "Gas" },
          "sparks",
          { kind: "dust", beat: "b3" },
          { kind: "magic", beat: "b2" },
        ],
      },
      { start: "b4", kit: "forest" },
    ],
  });
  assert.deepEqual(d.scenes[0].vfx, [
    { kind: "explosion", beat: "b2", where: "plaza-north", scale: 1.5 },
    { kind: "fire", beat: "b1", palette: "gas", seconds: 8 },
    { kind: "smoke", beat: "b3", palette: "dust" },
  ], "a bare name has no beat (dropped); at most 3 a scene");
  assert.equal(d.scenes[1].vfx, undefined);
  assert.ok(!("vfx" in JSON.parse(JSON.stringify(d.scenes[1]))), "no key in the saved direction");
  assert.equal(direct({ scenes: [{ start: "b1", ...paris, vfx: [] }] }).scenes[0].vfx, undefined);
  assert.equal(direct({ scenes: [{ start: "b1", ...paris, vfx: [{ kind: "fire" }] }] }).scenes[0].vfx, undefined, "no beat, no effect");
  // Aliases and near-misses land on a family; an unknown word is kept, for the repair to ask about.
  assert.deepEqual(vfxKind("fireball"), { kind: "explosion" });
  assert.deepEqual(vfxKind("Short circuit"), { kind: "sparks", palette: "electric" });
  assert.deepEqual(vfxKind("explosions"), { kind: "explosion" });
  assert.deepEqual(vfxKind("campfire"), { kind: "fire" });
  assert.deepEqual(vfxKind("spell"), { kind: "magic" });
  assert.deepEqual(vfxKind("Nuke"), { kind: "nuke" });
});

test("director: effects must be listed families on a beat of a world scene; the repair says how", () => {
  const kit = { start: "b1", kit: "street-block" };
  const check = (scenes: unknown[]) => vfxProblems(direct({ scenes }), timeline20);
  assert.equal(check([kit, { start: "b3", ...paris, vfx: [{ kind: "explosion", beat: "b4" }, { kind: "fire", beat: "b3", palette: "witch" }] }]), null);
  assert.equal(check([kit, { start: "b3", ...paris }]), null, "none listed, nothing to check");
  assert.match(check([kit, { start: "b3", ...paris, vfx: [{ kind: "nuke", beat: "b4" }] }]) ?? "", /"nuke" at b4 is not a listed effect; use one of explosion, fire, smoke, sparks, impact, magic/);
  assert.match(check([kit, { start: "b3", ...paris, vfx: [{ kind: "fire", beat: "b2" }] }]) ?? "", /fire at b2 is not on a beat of its scene \(the scene at b3 has b3, b4, b5\)/);
  assert.match(check([{ ...kit, vfx: [{ kind: "fire", beat: "b1" }] }, { start: "b3", ...paris }]) ?? "", /scene at b1 has "vfx", but effects are drawn only in a world scene/);
  assert.match(check([{ start: "b1", ...paris, vfx: [{ kind: "smoke", beat: "b1", palette: "purple" }] }]) ?? "", /palette "purple"; use one of grey, black, white, dust/);
  // The first scene covers from b1 even when it names a later start.
  assert.equal(check([{ start: "b2", ...paris, vfx: [{ kind: "impact", beat: "b1" }] }]), null);
});

test("director: the prompt teaches effects as story events, after the world events, and shows the field", () => {
  const text = directorInventory("What if a volcano woke under Paris?");
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.startsWith("EFFECTS (optional, world scenes only"));
  assert.ok(at > 0, "the effects block");
  assert.ok(lines[at - 1].trimStart().startsWith("World places only: gravity-off"), "right after the world events");
  assert.match(lines[at], /"kind": "explosion\|fire\|smoke\|sparks\|impact\|magic"/);
  assert.ok(lines.some((l) => /an effect is a story event, never decoration or mood/.test(l) && /Most videos have none/.test(l)));
  assert.ok(lines[lines.findIndex((l) => l.startsWith("SHOTS (one per beat)")) - 1].startsWith("- an effect is a story event"), "the shots block follows");
  const timeline = buildTimeline({ beats: story.beats, lines: [], format: "9:16", target: 20, cap: 90, wps: 2.6 });
  const prompt = directorPrompt({ premise: "x", story, timeline, settings: SettingsSchema.parse({ format: "9:16", targetDuration: 20 }) });
  assert.match(prompt, /"time": "golden", "vfx": \[\] \}\],/);
});

test("director: the repair loop asks once about an effect off the list, then lets the assembler drop it", async () => {
  const reply = (kind: string) => JSON.stringify({ scenes: [{ start: "b1", world: autumn("12:00"), vfx: [{ kind, beat: "b2" }] }], counter: null, timer: null, prop: null, world: [] });
  const run = async (replies: string[]) => {
    const dir = mkdtempSync(join(tmpdir(), "director-vfx-"));
    replies.forEach((r, i) => writeFileSync(join(dir, `director-${i + 1}.txt`), r));
    const before = process.env.FACTORY_LLM_FIXTURES;
    process.env.FACTORY_LLM_FIXTURES = dir;
    resetFixtureCounters();
    try {
      const timeline = buildTimeline({ beats: story.beats, lines: [], format: "9:16", target: 20, cap: 90, wps: 2.6 });
      return await directStory({
        premise: "What if a volcano woke under Paris?",
        story,
        timeline,
        settings: SettingsSchema.parse({ format: "9:16", targetDuration: 20 }),
        models: { writer: { provider: "ollama", model: "fixture" } },
      });
    } finally {
      if (before === undefined) delete process.env.FACTORY_LLM_FIXTURES;
      else process.env.FACTORY_LLM_FIXTURES = before;
      resetFixtureCounters();
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const fixed = await run([reply("lava"), reply("fire")]);
  assert.deepEqual(fixed.scenes[0].vfx, [{ kind: "fire", beat: "b2" }], "the repaired effect is used");
  const still = await run([reply("lava"), reply("volcano")]);
  assert.deepEqual(still.scenes[0].vfx, [{ kind: "volcano", beat: "b2" }], "asked once only: no third reply is read");
});

test("director: the vfx-fire fixture's recorded reply parses into its effects, nothing to ask", () => {
  const text = readFileSync(join(process.cwd(), "test-fixtures", "pipeline", "vfx-fire", "director-1.txt"), "utf8");
  const d = direct(JSON.parse(text.slice(text.indexOf("{", text.indexOf("</think>")))));
  assert.deepEqual(d.scenes.map((s) => (s.vfx ?? []).map((v) => `${v.kind}@${v.beat}:${v.where}`)), [
    ["smoke@b2:plaza", "fire@b3:plaza"],
    ["explosion@b4:avenue", "sparks@b5:sidewalk-north", "smoke@b6:plaza"],
  ]);
  const seven = { beats: ["b1", "b2", "b3", "b4", "b5", "b6", "b7"].map((id, i) => ({ id, from: 2 + i * 3, to: 5 + i * 3 })), duration: 23 } as unknown as Pick<Timeline, "beats" | "duration">;
  assert.equal(vfxProblems(d, seven), null);
});
