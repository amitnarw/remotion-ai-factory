/**
 * src/compositions/lightning.ts — when a storm's lightning flashes. Shared by
 * the storm overlay (weather.tsx), which draws the flash, and the
 * photographer (qa/photographer.ts), which must not judge a shot by the one
 * frame that is a white flash on purpose.
 */

/** Seconds between the strong flashes. */
export const LIGHTNING_PERIOD = 7.2;

/** Flash strength 0..1 at video time t (seconds): a strong flash, then a weaker one 4.65 s later. */
export function lightningAt(t: number): number {
  const ph = t % LIGHTNING_PERIOD;
  if (ph < 0.14) return 1 - ph / 0.14;
  if (ph > 4.58 && ph < 4.72) return 0.45 * (1 - Math.abs(ph - 4.65) / 0.07);
  return 0;
}

/**
 * The flash on at video time t, if any (lightningAt > 0): which one (2k for
 * the strong flash of period k, 2k + 1 for the weak one after it), whether it
 * is the strong one, and its strength. A world storm draws its bolt by it
 * (world/weather/weather.ts boltAt), so a bolt shows exactly while its flash does.
 */
export function lightningFlashAt(t: number): { index: number; strong: boolean; strength: number } | null {
  const strength = lightningAt(t);
  if (!(strength > 0)) return null;
  const k = Math.floor(t / LIGHTNING_PERIOD);
  const strong = t - k * LIGHTNING_PERIOD < 0.14;
  return { index: 2 * k + (strong ? 0 : 1), strong, strength };
}
