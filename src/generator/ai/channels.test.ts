import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { writerSystem } from "../pipeline/writer";
import { allowsAll, channelBrand, channelMoods, checkChannel, criticSystem, DEFAULT_CHANNEL, directorGuide, formatProblem, listChannels, loadChannel, readChannelFile, saveChannel, soundGuide } from "./channels";
import { recentStories, withMemoryChannel } from "./knowledge";

const recorded = JSON.parse(readFileSync(join(process.cwd(), "test-fixtures", "pipeline", "what-if-prompts.json"), "utf8")) as Array<{ system: string; prompt: string }>;

test("the four channels load, what-if first and the default", () => {
  const ids = listChannels().map((c) => c.id);
  assert.deepEqual(ids, ["what-if", "action", "documentary", "drama"]);
  assert.equal(DEFAULT_CHANNEL, "what-if");
  for (const id of ids) assert.equal(loadChannel(id).id, id);
  assert.throws(() => loadChannel("horror"), /No channel "horror"\. Channels: .*drama/);
});

test("what-if allows everything and asks the writer and the critic what they were asked before", () => {
  const p = loadChannel();
  assert.ok(allowsAll(p.devices));
  assert.equal(p.music.moods, "all");
  assert.equal(directorGuide(p), "", "nothing to add to the director's prompt");
  assert.equal(soundGuide(p), "");
  assert.equal(writerSystem(p), recorded[0].system, "the writer's system text of before profiles");
  const critic = recorded.find((r) => r.system.startsWith("You are a ruthless editor"));
  assert.equal(criticSystem(p), critic?.system, "the critic's system text of before profiles");
});

test("the other channels change the writer, the critic, the devices and the moods", () => {
  const drama = loadChannel("drama");
  assert.match(writerSystem(drama), /^You write short dramas/);
  assert.match(writerSystem(drama), /Structure, in order: setup \(about 25%: who they are and what they want\)/);
  assert.match(criticSystem(drama), /plot hole/);
  assert.equal(drama.writer.scriptMode, "as-written");
  assert.ok(!drama.devices.counter && !drama.devices.bulletTime);
  assert.deepEqual(channelMoods(drama), ["sad", "ambient", "upbeat"]);
  assert.match(directorGuide(drama), /does not use: counter, react, timer, heroProp, bpm, flights, bulletTime/);
  assert.match(soundGuide(drama), /sad, ambient, upbeat/);
  assert.equal(loadChannel("documentary").writer.maxCharacters, 0);
  assert.equal(loadChannel("action").writer.maxLineWords, 8);
});

test("a channel's formats: a misfit is named, a fit is not", () => {
  const action = loadChannel("action");
  assert.equal(formatProblem(action, "9:16", 30), null);
  assert.match(formatProblem(action, "16:9") ?? "", /makes 9:16 videos, not 16:9/);
  assert.match(formatProblem(action, "9:16", 90) ?? "", /15 to 45 s/);
  assert.equal(formatProblem(loadChannel(), "16:9", 60), null, "what-if makes every format");
});

test("a broken profile is refused with its problem", () => {
  const dir = mkdtempSync(join(tmpdir(), "channels-"));
  const good = JSON.parse(readFileSync(join(process.cwd(), "channels", "action.json"), "utf8"));
  writeFileSync(join(dir, "loud.json"), JSON.stringify({ ...good, id: "loud", music: { moods: ["dubstep"], fallback: "epic" } }));
  writeFileSync(join(dir, "other.json"), JSON.stringify({ ...good, id: "elsewhere" }));
  assert.throws(() => loadChannel("loud", dir), /moods the library does not know: dubstep/);
  assert.throws(() => loadChannel("other", dir), /says its id is "elsewhere"/);
  assert.throws(() => loadChannel("../what-if", dir), /not a channel id/);
  assert.deepEqual(listChannels(dir), [], "broken files are left out of the list");
});

test("the director's memory is the channel's own videos; older videos are what-if", async () => {
  const dir = mkdtempSync(join(tmpdir(), "memory-"));
  const report = (id: string, premise: string, at: string, channel?: string) => {
    mkdirSync(join(dir, id));
    writeFileSync(join(dir, id, "report.json"), JSON.stringify({ id, premise, generatedAt: at, ...(channel ? { channel } : {}) }));
  };
  report("a", "What if the sea froze?", "2026-11-01T10:00:00.000Z");
  report("b", "The keeper", "2026-11-02T10:00:00.000Z", "drama");
  report("c", "What if clocks stopped?", "2026-11-03T10:00:00.000Z", "what-if");
  assert.deepEqual(recentStories(8, dir).map((s) => s.premise), ["What if clocks stopped?", "The keeper", "What if the sea froze?"], "no channel: every video, newest first");
  assert.deepEqual(await withMemoryChannel("what-if", async () => recentStories(8, dir).map((s) => s.premise)), ["What if clocks stopped?", "What if the sea froze?"]);
  assert.deepEqual(await withMemoryChannel("drama", async () => recentStories(8, dir).map((s) => s.premise)), ["The keeper"]);
});

test("the settings page saves a profile: checked, its version raised only when it changed", () => {
  const dir = mkdtempSync(join(tmpdir(), "channels-save-"));
  const action = readFileSync(join(process.cwd(), "channels", "action.json"), "utf8");
  writeFileSync(join(dir, "action.json"), action);
  const raw = readChannelFile("action", dir)!;
  assert.equal(saveChannel(raw, {}, dir).changed, false, "the same profile is not saved again");
  assert.equal(readFileSync(join(dir, "action.json"), "utf8"), action, "the file is untouched");
  const edited = saveChannel({ ...raw, version: 99, name: "Fast action" }, {}, dir);
  assert.equal(edited.changed, true);
  assert.equal(edited.profile.version, Number(raw.version) + 1, "one up from the file's, whatever the page sent");
  assert.deepEqual(Object.keys(readChannelFile("action", dir)!).slice(0, 2), ["id", "version"]);
  assert.equal(loadChannel("action", dir).name, "Fast action");
  assert.throws(() => saveChannel({ ...raw, music: { moods: ["dubstep"], fallback: "epic" } }, {}, dir), /dubstep/);
  assert.equal(loadChannel("action", dir).name, "Fast action", "a refused profile leaves the file as it was");
  const copy = saveChannel({ ...raw, id: "shorts", name: "Shorts" }, { create: true }, dir);
  assert.equal(copy.profile.version, 1);
  assert.throws(() => saveChannel({ ...raw, id: "shorts" }, { create: true }, dir), /already a channel "shorts"/);
  assert.throws(() => saveChannel({ ...raw, id: "nope" }, {}, dir), /No channel "nope"/);
});

test("a brand is optional: what-if has none, action has one, a logo must be the channel's own file", () => {
  assert.equal(channelBrand(loadChannel()), undefined, "what-if renders as before");
  const action = loadChannel("action");
  const brand = channelBrand(action);
  assert.equal(brand?.name, "Action short");
  assert.equal(brand?.mark, "bolt");
  assert.equal(brand?.fonts.title, "anton");
  assert.deepEqual([brand?.intro?.seconds, brand?.outro?.seconds, brand?.watermark], [1.5, 3, true]);
  const raw = JSON.parse(readFileSync(join(process.cwd(), "channels", "action.json"), "utf8"));
  const pub = mkdtempSync(join(tmpdir(), "brand-public-"));
  mkdirSync(join(pub, "brand", "action"), { recursive: true });
  writeFileSync(join(pub, "brand", "action", "logo.svg"), "<svg/>");
  const withLogo = (logo: string) => ({ ...raw, brand: { ...raw.brand, logo } });
  assert.equal(checkChannel(withLogo("brand/action/logo.svg"), "action", pub).brand?.logo, "brand/action/logo.svg");
  assert.throws(() => checkChannel(withLogo("brand/drama/logo.svg"), "action", pub), /must be in public\/brand\/action\//);
  assert.throws(() => checkChannel(withLogo("brand/action/gone.png"), "action", pub), /no logo file public\/brand\/action\/gone\.png/);
  assert.throws(() => checkChannel({ ...raw, brand: { ...raw.brand, colors: { accent: "orange" } } }, "action", pub), /brand\.colors/);
});
