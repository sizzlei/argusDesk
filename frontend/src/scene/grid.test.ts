import { describe, expect, it } from 'vitest';
import { COLS, COL_GAP, ROW_GAP, ZH, ZW, grid, iso, roomOrigin, rowY } from './grid';

describe('grid', () => {
  it('maps grid steps to the isometric diamond', () => {
    expect(iso(0, 0)).toEqual({ x: 0, y: 0 });
    expect(iso(1, 0)).toEqual({ x: 32, y: 16 });
    expect(iso(0, 1)).toEqual({ x: -32, y: 16 });
    expect(iso(1, 1)).toEqual({ x: 0, y: 32 });
  });

  it('snakes the rooms: left to right, then back', () => {
    grid.rowGap = ROW_GAP;
    grid.rowDepths = [ZH, ZH + 3];
    expect(roomOrigin(0)).toMatchObject({ col: 0, row: 0, gx: 0, gy: 0, d: ZH });
    expect(roomOrigin(COLS - 1)).toMatchObject({ col: COLS - 1, row: 0, gx: (COLS - 1) * (ZW + COL_GAP) });
    // the second row starts under the last room of the first
    expect(roomOrigin(COLS)).toMatchObject({ col: COLS - 1, row: 1, gy: ZH + ROW_GAP, d: ZH + 3 });
    expect(roomOrigin(COLS * 2 - 1)).toMatchObject({ col: 0, row: 1 });
  });

  it('stacks rows by their own depth', () => {
    grid.rowGap = 5;
    grid.rowDepths = [7, 10, 7];
    expect([rowY(0), rowY(1), rowY(2)]).toEqual([0, 12, 27]);
  });
});
