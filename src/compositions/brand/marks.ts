/**
 * src/compositions/brand/marks.ts — the brand's mark and its shape morphs.
 *
 * A brand without a logo image shows a simple mark (BRAND_MARKS). The intro
 * bumper grows a dot into the mark and the outro turns the mark into the
 * subscribe button's bell, by Flubber's shape interpolation
 * (github.com/veltman/flubber, MIT): a pure function of the progress 0..1, so
 * a frame's shape depends on its frame number only (no timers, no state).
 *
 * Every shape is drawn in a 100 x 100 box.
 */
import { interpolate } from "flubber";
import { MARK_PATHS } from "./shapes";

export { MARK_PATHS };

const cache = new Map<string, (t: number) => string>();

/**
 * The path between two shapes at `t` (0: the first, 1: the second). The
 * interpolator is built once per pair and kept (a cache keyed on values,
 * allowed by the determinism rules: 17-code-map-world.md §1.6 rule 2).
 */
export function morphPath(from: keyof typeof MARK_PATHS, to: keyof typeof MARK_PATHS, t: number): string {
  const k = Math.min(1, Math.max(0, t));
  if (k <= 0) return MARK_PATHS[from];
  if (k >= 1) return MARK_PATHS[to];
  const key = `${from}>${to}`;
  let f = cache.get(key);
  if (!f) {
    f = interpolate(MARK_PATHS[from], MARK_PATHS[to], { maxSegmentLength: 4 });
    cache.set(key, f);
  }
  return f(k);
}
