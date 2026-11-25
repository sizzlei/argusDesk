// The isometric grid: tile sizes, room sizes and where each room stands.



// ---- isometric grid ---------------------------------------------------------

export const TW = 64; // tile width on screen
export const TH = 32; // tile height on screen
export const ZW = 8; // room size in tiles
export const ZH = 7;
export const COL_GAP = 0.5; // partition between rooms of a row
export const ROW_GAP = 4.8; // corridor between rows (holds the two lanes of the conveyor)
export const ATRIUM_GAP = 8.2; // upper floors: the rows stand apart around a garden, with the conveyor circling it
/** What changes from floor to floor: set each time a building is drawn. */
export const grid = {
  rowGap: ROW_GAP, // the gap in use
  // A row that holds a desk room is deeper, so every teammate's row of boxes has space.
  rowDepths: [] as number[],
};
export const COLS = 3; // rooms per row
export const PAD = 0.7; // floor slab around the rooms
export const WALL_H = 58; // outer wall height on screen
export const STOREY = 34; // height of a floor below the one shown, on screen

export const iso = (gx: number, gy: number) => ({ x: ((gx - gy) * TW) / 2, y: ((gx + gy) * TH) / 2 });

export const DESK_EXTRA = 3;
export const rowY = (row: number) => grid.rowDepths.slice(0, row).reduce((sum, d) => sum + d + grid.rowGap, 0);

/** Rooms snake through the building: left to right, then back. */
export function roomOrigin(index: number) {
  const row = Math.floor(index / COLS);
  const col = row % 2 === 0 ? index % COLS : COLS - 1 - (index % COLS);
  return { gx: col * (ZW + COL_GAP), gy: rowY(row), col, row, d: grid.rowDepths[row] ?? ZH };
}
