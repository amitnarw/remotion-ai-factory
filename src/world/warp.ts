/**
 * src/world/warp.ts
 *
 * The bullet-time clock (docs/factory/14-bullet-time.md §3.1). A world scene
 * may carry `bulletTime`: over a window [a, d] of video seconds the world's
 * clock ramps down to a crawl (or stops), holds, and ramps back, while the
 * camera, the HUD, the captions and the voice stay on real time.
 *
 * Three clocks, each a closed-form function of video time t:
 *   - real t: the camera, the grade, the HUD, the captions and the voice;
 *   - the world clock w(t): everything in the place (sway, water, reactions,
 *     traffic, birds, flags, the featured cast);
 *   - the hero clock h(t): one featured actor who moves faster than the world
 *     (the same curve with its own hold rate), so the dodge can be seen.
 * The sound clock is the same curve again with a floor (SOUND_FLOOR), so a
 * frozen world hums low instead of going silent.
 *
 * The window [a, d] has a ramp-in [a, b], a hold [b, c] and a ramp-out
 * [c, d]. With S(x) = 3x^2 - 2x^3 (smoothstep) and r the hold's rate:
 *   rho(t) = 1 outside; 1 - (1 - r) S((t - a)/(b - a)) in the ramp-in; r in
 *   the hold; r + (1 - r) S((t - c)/(d - c)) in the ramp-out.
 * w is its integral, exact because the integral of S over [0, x] is
 * x^3 - x^4/2. After the window w = t - debt: the world lags real time by the
 * debt, so a world-timed thing the spec puts after the window is mapped
 * through w where it is planned (actors' steps, reactions, traffic) and still
 * lands on its real moment on screen.
 *
 * Properties: pure (no table, no state), C1 (the rate never jumps), monotone,
 * and invertible outside a frozen hold (the inverse is a bisection).
 *
 * Plain imports only (no three.js, no React): the assembler, the validator
 * and the renderer all use it.
 */

/** The window of a bullet time, in video seconds (as the spec holds it). */
export interface WarpWindow {
  from: number;
  to: number;
  rampIn: number;
  rampOut: number;
  /** The world's rate in the hold: 0 is frozen. */
  rate: number;
}

export const DODGES = ["lean", "duck", "roll"] as const;
export type Dodge = (typeof DODGES)[number];
export const PROJECTILE_KINDS = ["bullet", "ball"] as const;
export type ProjectileKind = (typeof PROJECTILE_KINDS)[number];
/** Which way a projectile misses its target (it passes where the target was, offset this way). */
export const MISSES = ["high", "high-left", "high-right", "left", "right"] as const;
export type Miss = (typeof MISSES)[number];
export const ARC_DIRS = ["left", "right"] as const;

/** One projectile of a bullet time: who or where from, at whom, when it passes. */
export interface ProjectileSpec {
  kind: ProjectileKind;
  /** A featured actor's name (the shooter), a city spot, or a compass direction (off screen). */
  from: string;
  /** The featured actor it passes (and misses). */
  at: string;
  /** When it passes its target, as a share of the hold (0..1). */
  pass: number;
  miss: Miss;
}

/** scene.bulletTime as the spec holds it (real video seconds; everything else derived per frame). */
export interface BulletTime extends WarpWindow {
  hero?: { actor: string; rate: number; dodge?: Dodge };
  arc?: { sweep: number; dir: (typeof ARC_DIRS)[number] };
  projectiles?: ProjectileSpec[];
}

/* ------------------------------------------------------------------ */
/*  Limits                                                             */
/* ------------------------------------------------------------------ */

/** The window's length (s). */
export const MIN_WINDOW = 2.5;
export const MAX_WINDOW = 6;
/** The hold must last at least this (s). */
export const MIN_HOLD = 1.5;
/** Each ramp's length (s). */
export const MIN_RAMP = 0.25;
export const MAX_RAMP = 1;
/** Default ramps (s). */
export const RAMP = 0.45;
/** The world's slowest rate in the hold (a crawl), and the most a "slow" hold may run at. */
export const SLOW_RATE = 0.005;
export const MAX_RATE = 0.05;
/** The hero's default rate in the hold, and its most. */
export const HERO_RATE = 0.4;
export const MAX_HERO_RATE = 0.6;
/** The sound's slowest rate (about 14 semitones down). */
export const SOUND_FLOOR = 0.45;
/** A window starts at least this long after its scene does (s). */
export const SCENE_LEAD = 0.5;
/** Projectiles per window. */
export const MAX_PROJECTILES = 6;
/** The default arc's sweep (degrees). */
export const ARC_SWEEP = 180;
/** The hold's grade shift at full depth (decision 10): saturation down,
 *  contrast up, as shares. CinematicLook applies it; the photographer
 *  allows for it (src/generator/qa/photographer.ts). */
export const HOLD_DESATURATE = 0.18;
export const HOLD_CONTRAST = 0.08;
/** In a scene a flight arrives in, the window starts this long after the scene does (the flight lands up to 5 s in). */
export const FLIGHT_CLEAR = 5;
/** When each of n projectiles passes its target, as shares of the hold (spread along the path). */
export function passShares(n: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [0.5];
  return Array.from({ length: n }, (_, i) => Math.round((0.3 + (0.4 * i) / (n - 1)) * 1000) / 1000);
}
/** Directions a projectile may come from off the set. */
export const COMPASS_WORDS: readonly string[] = ["north", "south", "east", "west", "north-east", "north-west", "south-east", "south-west"];
/** The misses of n projectiles in turn. */
export const MISS_ORDER: readonly Miss[] = ["high", "high-left", "high-right", "left", "right", "high"];

/* ------------------------------------------------------------------ */
/*  The curve                                                          */
/* ------------------------------------------------------------------ */

const S = (x: number) => x * x * (3 - 2 * x);
const s1 = (x: number) => `${x.toFixed(1)} s`;
/** The integral of S over [0, x]. */
const IS = (x: number) => x * x * x - (x * x * x * x) / 2;
const clamp01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x);

/** The window's four edges: a (start), b (hold starts), c (hold ends), d (end). */
export function warpEdges(win: WarpWindow): { a: number; b: number; c: number; d: number } {
  const a = win.from;
  const d = win.to;
  const b = Math.min(d, a + Math.max(0, win.rampIn));
  const c = Math.max(b, d - Math.max(0, win.rampOut));
  return { a, b, c, d };
}

/** The rate at video time t of the curve with hold rate r (1 outside the window). */
export function warpRate(win: WarpWindow, t: number, r = win.rate): number {
  const { a, b, c, d } = warpEdges(win);
  if (t <= a || t >= d) return 1;
  if (t < b) return 1 - (1 - r) * S(clamp01((t - a) / (b - a)));
  if (t <= c) return r;
  return r + (1 - r) * S(clamp01((t - c) / (d - c)));
}

/** How far the clock lags real time once the window is over (s), for hold rate r. */
export function warpDebt(win: WarpWindow, r = win.rate): number {
  const { a, b, c, d } = warpEdges(win);
  return d - a - (((b - a) * (1 + r)) / 2 + r * (c - b) + ((d - c) * (1 + r)) / 2);
}

/** The clock at video time t (the rate's integral, exact), for hold rate r. */
export function warpAt(win: WarpWindow, t: number, r = win.rate): number {
  const { a, b, c, d } = warpEdges(win);
  if (t <= a) return t;
  const inRamp = ((b - a) * (1 + r)) / 2;
  if (t < b) {
    const x = (t - a) / (b - a);
    return a + (b - a) * (x - (1 - r) * IS(x));
  }
  if (t <= c) return a + inRamp + r * (t - b);
  if (t < d) {
    const y = (t - c) / (d - c);
    return a + inRamp + r * (c - b) + (d - c) * (r * y + (1 - r) * IS(y));
  }
  return t - warpDebt(win, r);
}

/** The video time at which the clock (hold rate r) reads `w`: the first such
 *  moment (a frozen hold reads one value throughout; this gives its start). */
export function warpInverse(win: WarpWindow, w: number, r = win.rate): number {
  const { a, d } = warpEdges(win);
  if (w <= a) return w;
  const end = warpAt(win, d, r);
  if (w >= end) return w + warpDebt(win, r);
  let lo = a;
  let hi = d;
  for (let i = 0; i < 60 && hi - lo > 1e-9; i++) {
    const mid = (lo + hi) / 2;
    if (warpAt(win, mid, r) < w) lo = mid;
    else hi = mid;
  }
  return hi;
}

/* ------------------------------------------------------------------ */
/*  The clocks of one scene                                            */
/* ------------------------------------------------------------------ */

export interface BulletClock {
  window: WarpWindow;
  edges: { a: number; b: number; c: number; d: number };
  /** The world's time at video time t, and its rate. */
  world(t: number): number;
  worldRate(t: number): number;
  /** The featured hero's time and rate (the world's when there is no hero). */
  hero(t: number): number;
  heroRate(t: number): number;
  /** The sound's time and rate (never below SOUND_FLOOR in the hold). */
  sound(t: number): number;
  soundRate(t: number): number;
  /** Video time for a world time, a hero time, a sound time (the first such moment). */
  worldToReal(w: number): number;
  heroToReal(h: number): number;
  soundToReal(s: number): number;
  /** How far the world lags real time after the window (s). */
  debt: number;
  /** How far into the hold (0..1) video time t is; <0 before it, >1 after. */
  holdShare(t: number): number;
  /** The real time at a share of the hold. */
  atHold(share: number): number;
  /** The cast id of the hero (featured actor), when there is one. */
  heroId?: string;
}

/** The hero's hold rate (from the world's to MAX_HERO_RATE). */
const heroRateOf = (bt: BulletTime) => Math.min(MAX_HERO_RATE, Math.max(bt.rate, bt.hero?.rate ?? HERO_RATE));

/** The clocks of a scene's bullet time, or null without one. `heroId` is the
 *  hero's cast id (castId) when the caller knows the cast. Pure; cheap to
 *  make, but memoize per scene. */
export function bulletClock(bt: BulletTime | null | undefined, heroId?: string): BulletClock | null {
  if (!bt || !(bt.to > bt.from)) return null;
  const win: WarpWindow = { from: bt.from, to: bt.to, rampIn: bt.rampIn, rampOut: bt.rampOut, rate: Math.max(0, bt.rate) };
  const r = win.rate;
  const rh = bt.hero ? heroRateOf(bt) : r;
  const rs = Math.max(r, SOUND_FLOOR);
  const edges = warpEdges(win);
  return {
    window: win,
    edges,
    world: (t) => warpAt(win, t, r),
    worldRate: (t) => warpRate(win, t, r),
    hero: (t) => warpAt(win, t, rh),
    heroRate: (t) => warpRate(win, t, rh),
    sound: (t) => warpAt(win, t, rs),
    soundRate: (t) => warpRate(win, t, rs),
    worldToReal: (w) => warpInverse(win, w, r),
    heroToReal: (h) => warpInverse(win, h, rh),
    soundToReal: (s) => warpInverse(win, s, rs),
    debt: warpDebt(win, r),
    holdShare: (t) => (edges.c > edges.b ? (t - edges.b) / (edges.c - edges.b) : t < edges.b ? -1 : 2),
    atHold: (share) => edges.b + (edges.c - edges.b) * share,
    ...(heroId ? { heroId } : {}),
  };
}

/** A scene's bullet-time clocks with its hero's cast id (null without a bullet time). Memoize per scene. */
export function sceneClock(scene: { bulletTime?: BulletTime | null; actors?: readonly { role: string }[] }): BulletClock | null {
  const bt = scene.bulletTime;
  if (!bt) return null;
  const i = bt.hero ? actorIndex(scene.actors, bt.hero.actor) : -1;
  return bulletClock(bt, i >= 0 ? castId(scene.actors![i].role, i) : undefined);
}

/**
 * A spec with its world-timed moments moved onto a scene's world clock: the
 * world events and the counter's steps at w(t), so the place's reaction,
 * planned and read on world time, still lands on its real moment on screen
 * (and one inside the hold happens at once in world time). The spec itself
 * (the HUD's, the sound's) keeps real time. Without a clock, the spec itself.
 */
export function warpSpecTimes<S extends { worldEvents?: readonly { t: number }[] | null; statPanel?: { beats: readonly { t: number }[] } | null }>(spec: S, clock: BulletClock | null): S {
  if (!clock) return spec;
  return {
    ...spec,
    ...(spec.worldEvents ? { worldEvents: spec.worldEvents.map((e) => ({ ...e, t: clock.world(e.t) })) } : {}),
    ...(spec.statPanel ? { statPanel: { ...spec.statPanel, beats: spec.statPanel.beats.map((b) => ({ ...b, t: clock.world(b.t) })) } } : {}),
  };
}

/** How deep into the hold the world is at t (0 outside the window, 1 through
 *  the hold, eased on the ramps): what the grade shift and the heartbeat follow. */
export function holdDepth(clock: BulletClock | null, t: number): number {
  if (!clock) return 0;
  const r = clock.window.rate;
  return r >= 1 ? 0 : clamp01((1 - clock.worldRate(t)) / (1 - r));
}

/* ------------------------------------------------------------------ */
/*  Actors by name                                                     */
/* ------------------------------------------------------------------ */

/** A featured actor's cast id, as the world's cast keys it (camera/world.ts worldCast). */
export function castId(role: string, index: number): string {
  return `${role.replace(/[^a-z0-9]+/gi, "-").slice(0, 24)}-${index}`;
}

const lower = (s: string) => s.toLowerCase().trim();
/** The name a role starts with: "Karim, man in a grey hoodie" -> "karim". */
const leadName = (role: string) => lower(role).split(/[,(;:]| - /)[0].trim();

/**
 * Which of a scene's featured actors a name means (-1 if none): the role
 * itself, the name it starts with ("Karim, man in a grey hoodie" is
 * "Karim"), a whole word of it, the cast id, or "actorN".
 */
export function actorIndex(actors: readonly { role: string }[] | undefined, name: string | undefined): number {
  if (!actors?.length || !name) return -1;
  const n = lower(name);
  if (!/[a-z0-9]/.test(n)) return -1;
  const tests: ((role: string, i: number) => boolean)[] = [
    (role) => lower(role) === n,
    (role) => leadName(role) === n,
    (role, i) => lower(castId(role, i)) === n,
    (_role, i) => n === `actor${i + 1}`,
    (role) => new RegExp(`(^|[^a-z0-9])${n.replace(/[^a-z0-9]+/g, "[^a-z0-9]+")}([^a-z0-9]|$)`).test(lower(role)),
  ];
  for (const test of tests) {
    const i = actors.findIndex((a, k) => test(a.role, k));
    if (i >= 0) return i;
  }
  return -1;
}

/* ------------------------------------------------------------------ */
/*  Plans on the world's clock                                         */
/* ------------------------------------------------------------------ */

/** A step whose time is mapped onto an actor's clock. */
interface Timed {
  at: number;
}

/**
 * Actor scripts with every step time mapped onto the actor's own clock: the
 * hero's through h, everyone else's through w. Plans built from these and
 * posed at w(t) (or h(t)) do each step on its real moment on screen, and a
 * step put inside the hold happens at once in world time. Without a clock the
 * scripts come back as they are (the same objects).
 */
export function warpScripts<S extends { id: string; steps?: readonly Timed[] }>(scripts: readonly S[], clock: BulletClock | null): S[] {
  if (!clock) return scripts as S[];
  return scripts.map((s) => {
    if (!s.steps?.length) return s;
    const map = s.id === clock.heroId ? clock.hero : clock.world;
    return { ...s, steps: s.steps.map((st) => ({ ...st, at: Math.max(0, map(st.at)) })) };
  });
}

/** A scene's featured actors as the spec holds them (scene.actors). */
export interface SceneActor {
  role: string;
  where: string;
  carry?: "bag" | "box" | "briefcase";
  do?: { at?: number; action: string; to?: string; target?: string; for?: number; how?: Dodge }[];
}

/** A target or shooter that names another featured actor: its cast id (the
 *  role, the name it starts with, the cast id or "actorN"; a spot name is
 *  left as it is). */
function actorTarget(actors: readonly SceneActor[], target: string): string {
  const n = lower(target);
  const i = actors.findIndex((a, k) => lower(a.role) === n || leadName(a.role) === n || lower(castId(a.role, k)) === n || n === `actor${k + 1}`);
  return i < 0 ? target : castId(actors[i].role, i);
}

/**
 * A bullet-time scene's featured actors as actor scripts (camera/world.ts
 * worldCast's shape and ids), with a target that names another actor turned
 * into its cast id (a shooter aims at the hero, the hero watches the shooter)
 * and every step on its actor's clock (warpScripts).
 */
export function bulletScripts(
  scene: { from: number; actors?: readonly SceneActor[] },
  clock: BulletClock | null,
): { id: string; role: string; start: string; carry?: SceneActor["carry"]; steps?: { at: number; action: string; to?: string; target?: string; for?: number; how?: Dodge }[] }[] {
  const actors = scene.actors ?? [];
  const scripts = actors.map((a, i) => ({
    id: castId(a.role, i),
    role: a.role,
    start: a.where,
    ...(a.carry ? { carry: a.carry } : {}),
    ...(a.do?.length
      ? {
          steps: a.do
            .map((st) => ({
              at: st.at ?? scene.from,
              action: st.action,
              ...(st.to ? { to: st.to } : {}),
              ...(st.target ? { target: actorTarget(actors, st.target) } : {}),
              ...(st.for != null ? { for: st.for } : {}),
              ...(st.how ? { how: st.how } : {}),
            }))
            .sort((x, y) => x.at - y.at),
        }
      : {}),
  }));
  return warpScripts(scripts, clock);
}

/** An actor's own time at video time t: the hero's clock, the world's, or t itself. */
export function actorTime(clock: BulletClock | null, id: string, t: number): number {
  if (!clock) return t;
  return id === clock.heroId ? clock.hero(t) : clock.world(t);
}

/* ------------------------------------------------------------------ */
/*  The window from a beat                                             */
/* ------------------------------------------------------------------ */

/**
 * A bullet time's window from the beat the director chose (video seconds,
 * on whole frames): the beat's span, starting at least SCENE_LEAD into its
 * scene (FLIGHT_CLEAR when a flight lands in it); a beat shorter than
 * MIN_WINDOW runs into the next beats of the same scene; one longer than
 * MAX_WINDOW is cut there. A string says why there is none, with the beats'
 * real lengths for a repair prompt.
 */
export function bulletWindow(
  beats: readonly { id: string; from: number; to: number }[],
  beat: string,
  scene: { from: number; to: number; flight?: boolean },
  fps = 30,
): { from: number; to: number } | string {
  const i = beats.findIndex((b) => b.id === beat);
  if (i < 0) return `bulletTime.beat "${beat}" is not one of the story's beats (${beats.map((b) => b.id).join(", ")})`;
  const lead = scene.flight ? FLIGHT_CLEAR : SCENE_LEAD;
  const from = Math.ceil(Math.max(beats[i].from, scene.from + lead) * fps - 1e-6) / fps;
  let to = Math.min(beats[i].to, scene.to);
  for (let k = i + 1; to - from < MIN_WINDOW && k < beats.length && beats[k].from < scene.to - 1e-6; k++) to = Math.min(beats[k].to, scene.to);
  to = Math.floor(Math.min(to, from + MAX_WINDOW) * fps + 1e-6) / fps;
  if (to - from < MIN_WINDOW - 1e-6) {
    const lengths = beats
      .filter((b) => b.from >= scene.from - 1e-6 && b.to <= scene.to + 1e-6)
      .map((b) => `${b.id} ${(b.to - b.from).toFixed(1)} s`)
      .join(", ");
    return `the bullet time at ${beat} would last only ${s1(Math.max(0, to - from))} (it needs ${MIN_WINDOW}-${MAX_WINDOW} s, starting ${lead} s or more into its scene, inside the scene); its scene's beats: ${lengths}`;
  }
  return { from, to };
}

/* ------------------------------------------------------------------ */
/*  The checks                                                         */
/* ------------------------------------------------------------------ */

/** What bulletProblem needs to know about the scene a window sits in. */
export interface BulletScene {
  from: number;
  to: number;
  kit?: string;
  world?: { lapse?: unknown } | null;
  actors?: readonly { role: string }[];
}

/**
 * Why a scene's bullet time can't be used (null if fine), worded for a repair
 * prompt: world scenes only, inside one scene from SCENE_LEAD after its start,
 * not across a flight or a transition, a window of MIN_WINDOW-MAX_WINDOW with a
 * hold of MIN_HOLD, ramps of MIN_RAMP-MAX_RAMP, the world's rate 0-MAX_RATE and
 * the hero's from it to MAX_HERO_RATE, no time-lapse in the scene, a featured
 * hero, and at most MAX_PROJECTILES projectiles between featured actors or from
 * off the set. Whether each projectile misses every body is the projectiles'
 * own check (projectiles.ts), which needs the planned cast.
 */
export function bulletProblem(
  bt: BulletTime,
  scene: BulletScene,
  ctx: { flights?: readonly { from: number; to: number }[]; transitions?: readonly { t: number; dur: number }[] } = {},
): string | null {
  if (scene.kit !== "world" || !scene.world) return "bullet time is for world scenes only (a real place)";
  if (scene.world.lapse) return "a scene with a time-lapse can't also have a bullet time: drop one of them";
  const len = bt.to - bt.from;
  if (!(len >= MIN_WINDOW - 1e-6) || len > MAX_WINDOW + 1e-6) {
    return `the bullet-time window lasts ${s1(len)}; it must last ${MIN_WINDOW}-${MAX_WINDOW} s (choose a beat of that length, or one that runs into the next beat of the same scene)`;
  }
  if (bt.from < scene.from + SCENE_LEAD - 1e-6 || bt.to > scene.to + 1e-6) {
    return `the bullet-time window (${s1(bt.from)}-${s1(bt.to)}) must sit inside its scene (${s1(scene.from)}-${s1(scene.to)}), starting at least ${SCENE_LEAD} s after the scene starts`;
  }
  for (const r of [bt.rampIn, bt.rampOut]) {
    if (!(r >= MIN_RAMP - 1e-6 && r <= MAX_RAMP + 1e-6)) return `the bullet-time ramps must last ${MIN_RAMP}-${MAX_RAMP} s (got ${r})`;
  }
  const hold = len - bt.rampIn - bt.rampOut;
  if (hold < MIN_HOLD - 1e-6) return `the bullet-time hold lasts ${s1(hold)}; it needs at least ${MIN_HOLD} s: choose a longer beat`;
  if (!(bt.rate >= 0 && bt.rate <= MAX_RATE)) return `the bullet-time rate must be 0 (frozen) to ${MAX_RATE} (got ${bt.rate})`;
  for (const f of ctx.flights ?? []) {
    if (bt.from < f.to && bt.to > f.from) return `the bullet-time window (${s1(bt.from)}-${s1(bt.to)}) overlaps a flight (${s1(f.from)}-${s1(f.to)})`;
  }
  for (const tr of ctx.transitions ?? []) {
    if (bt.from < tr.t + tr.dur / 2 && bt.to > tr.t - tr.dur / 2) return `the bullet-time window (${s1(bt.from)}-${s1(bt.to)}) crosses a transition at ${s1(tr.t)}`;
  }
  const actors = scene.actors ?? [];
  if (bt.hero) {
    if (actorIndex(actors, bt.hero.actor) < 0) {
      return `the bullet-time hero "${bt.hero.actor}" is not a featured actor of the scene${actors.length ? ` (its actors: ${actors.map((a) => a.role).join("; ")})` : " (it has none: add the hero to the scene's actors)"}`;
    }
    if (!(bt.hero.rate >= bt.rate - 1e-9 && bt.hero.rate <= MAX_HERO_RATE + 1e-9)) return `the hero's rate must be from the world's (${bt.rate}) to ${MAX_HERO_RATE} (got ${bt.hero.rate})`;
  }
  const shots = bt.projectiles ?? [];
  if (shots.length > MAX_PROJECTILES) return `a bullet time has at most ${MAX_PROJECTILES} projectiles (got ${shots.length})`;
  for (const p of shots) {
    if (actorIndex(actors, p.at) < 0) return `a projectile passes "${p.at}", who is not a featured actor of the scene`;
    if (!(p.pass >= 0 && p.pass <= 1)) return `a projectile's pass must be a share of the hold, 0-1 (got ${p.pass})`;
  }
  return null;
}
