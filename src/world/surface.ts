/**
 * src/world/surface.ts
 *
 * What the ground is at a point on Earth, as stored in the surface grid
 * (built by scripts/setup-world-data.ts, read by earth-grid.ts).
 */

/** Quarter-degree cells: 1440 columns (lon -180..180), 720 rows (lat 90..-90). */
export const GRID_W = 1440;
export const GRID_H = 720;

export enum Surface {
  Ocean = 0,
  Land = 1,
  Desert = 2,
  Mountain = 3,
  Tundra = 4,
  Ice = 5,
  Lake = 6,
}
