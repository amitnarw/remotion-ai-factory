/**
 * timing.ts
 * Shared time <-> frame conversion + ramps used by the 3D scene, HUD and audio layers.
 * Everything derives from spec.t (seconds) * fps so picture, caption, timer and sound
 * stay frame-locked — sync is arithmetic, not editing.
 */

export const DEFAULT_FPS = 30;

export function secToFrame(seconds: number, fps = DEFAULT_FPS): number {
  return Math.round(seconds * fps);
}

/**
 * Format m:ss.ccc for the "TIME WITHOUT ___" HUD timer.
 */
export function formatTimer(seconds: number): string {
  const total = Math.max(0, seconds);
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const c = Math.round((total % 1) * 1000);
  return `${m}:${String(s).padStart(2, "0")}.${String(c).padStart(3, "0")}`;
}

/**
 * Simple ease-out for camera movement.
 */
export function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
