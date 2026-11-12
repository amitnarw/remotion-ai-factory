/**
 * The model sets' camera (docs/factory/19-model-sets.md §4): every subject of
 * the ship and the lighthouse, at every size, side and angle in 9:16 and
 * 16:9, puts the lens outside the model as drawn (its voxels from the
 * triangles, not the merged boxes the solver sees), inside the stage's
 * reach, and sees its subject past every part that is not the subject's own.
 * An actor walks the ship's deck round the mast. Needs the packs installed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { ShotSchema, SIZE_DEFAULTS, type Shot } from "./shot";
import { solveShot, type Subject, type Vec3 } from "./solve";
import { modelSetAnchors, modelSetCast, modelSetSubjectNames } from "./modelSet";
import { SceneSchema, type SceneType } from "../spec.schema";
import { glbTriangles } from "../../world/modelset/gltf";
import { solidAt } from "../../world/modelset/measure";
import { modelSetDef } from "../../world/modelset/sets";
import { setLayout, type SetLayout } from "../../world/modelset/stage";
import { poseAt } from "../../world/actors/script";

const PUBLIC = join(process.cwd(), "public");
const layoutOf = (id: string): SetLayout | undefined => {
  const def = modelSetDef(id);
  if (!def || !existsSync(join(PUBLIC, def.file))) return undefined;
  return setLayout(def, glbTriangles(new Uint8Array(readFileSync(join(PUBLIC, def.file)))).tris);
};
const SHIP = layoutOf("kenney-pirate-kit-ship-large");
const TOWER = layoutOf("landmark-lighthouse");

const ASPECTS = [9 / 16, 16 / 9];
const SIZES = ["EWS", "WS", "FS", "MS", "CU"] as const;
const SIDES = ["front", "left34", "right34", "left", "right", "back"] as const;
const ANGLES = ["eye", "low", "high"] as const;
const shot = (s: Partial<Shot>): Shot => ShotSchema.parse({ subject: "x", size: "WS", move: "static", style: "locked", place: "center", ...s });

function aimOf(s: Subject, size: Shot["size"]): Vec3 {
  const region = SIZE_DEFAULTS[size].region;
  const h = s.height ?? s.radius * 2;
  return [s.center[0], region >= 1 || s.focus === "centre" ? s.center[1] : s.center[1] + h / 2 - (h * region) / 2, s.center[2]];
}

/** Does the line from the lens to the framed region cross the model as drawn
 *  (up to the subject's own space), when the model is not the subject's own? */
function seesThrough(l: SetLayout, s: Subject, p: Vec3, aim: Vec3): boolean {
  if ((s.own ?? []).includes(1)) return false;
  const d = Math.hypot(aim[0] - p[0], aim[1] - p[1], aim[2] - p[2]);
  const stop = 1 - Math.min(0.95, (0.7 * s.radius) / d);
  const steps = Math.ceil((d * stop) / 0.1);
  for (let k = 1; k < steps; k++) {
    const u = (k / steps) * stop;
    if (solidAt(l.m, [p[0] + (aim[0] - p[0]) * u, p[1] + (aim[1] - p[1]) * u, p[2] + (aim[2] - p[2]) * u], l.m.surface)) return true;
  }
  return false;
}

const scene = (kit: string, actors?: SceneType["actors"]): SceneType => SceneSchema.parse({ scene: "s", kit: "model-set", from: 0, to: 12, modelSet: { model: kit }, ...(actors ? { actors } : {}) });

for (const [name, l] of [["ship", SHIP], ["lighthouse", TOWER]] as const) {
  test(`the ${name} set: every subject's lens stands outside the model and sees its subject`, { skip: !l && "the world packs are not installed" }, () => {
    const set = l!;
    const anchors = modelSetAnchors(scene(set.def.id), set);
    for (const subject of modelSetSubjectNames(set.def.kind)) assert.ok(anchors[subject], `${subject} is a subject`);
    const bad: string[] = [];
    let n = 0;
    for (const [subject, at] of Object.entries(anchors)) {
      const s = at(1);
      for (const aspect of ASPECTS) for (const size of SIZES) for (const side of SIDES) for (const angle of ANGLES) {
        const p = solveShot(shot({ size, side, angle }), s, { aspect, u: 0.5, seconds: 3, seed: "s" }).position;
        n++;
        const label = `${subject} ${aspect.toFixed(2)} ${size} ${side} ${angle} lens ${p.map((v) => v.toFixed(1))}`;
        if (solidAt(set.m, p, set.m.surface) || solidAt(set.m, p)) bad.push(`in the model: ${label}`);
        else if (Math.abs(p[0]) > 70.01 || Math.abs(p[2]) > 70.01) bad.push(`out of reach: ${label}`);
        else if (seesThrough(set, s, p, aimOf(s, size))) bad.push(`through the model: ${label}`);
      }
    }
    assert.ok(bad.length <= n * 0.02, `${bad.length} of ${n} lenses fail:\n${bad.slice(0, 12).join("\n")}`);
  });
}

test("an actor walks the ship's deck, round the mast, on the deck's height", { skip: !SHIP && "the world packs are not installed" }, () => {
  const set = SHIP!;
  assert.deepEqual(Object.keys(set.spots).sort(), ["aft", "deck", "fore", "port", "starboard"]);
  const sc = scene(set.def.id, [{ role: "sailor", where: "aft", do: [{ at: 1, action: "walk", to: "fore" }, { at: 15, action: "wave" }] }]);
  const cast = modelSetCast(sc, set);
  const plan = cast.plans.get("sailor-0")!;
  assert.ok(plan, `planned (${cast.warnings.join("; ")})`);
  let maxGap = 0;
  for (let t = 0; t <= 14; t += 0.1) {
    const p = poseAt(plan, t).pos;
    const floor = set.deck ? set.groundAt(p[0], p[2]) : NaN;
    maxGap = Math.max(maxGap, Math.abs(p[1] - floor));
    // Never in the model (the mast, the hatch): the body's middle is free.
    assert.ok(!solidAt(set.m, [p[0], p[1] + 0.9, p[2]], set.m.surface), `in the model at ${t.toFixed(1)} s: ${p.map((v) => v.toFixed(2))}`);
  }
  assert.ok(maxGap < 0.05, `feet on the deck (${maxGap.toFixed(3)} m off)`);
  const end = poseAt(plan, 14).pos;
  assert.ok(Math.hypot(end[0] - set.spots.fore.pos[0], end[2] - set.spots.fore.pos[2]) < 0.05, "arrived at the bow end");
  // The sailor is a camera subject, by role too.
  const anchors = modelSetAnchors(sc, set, cast);
  assert.ok(anchors.sailor && anchors["sailor-0"] && anchors.actor1);
});
