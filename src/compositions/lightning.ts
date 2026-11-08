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
