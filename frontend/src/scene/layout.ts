// Where each box stands inside its room.

import type { Box, ZoneView } from '../types';

// ---- layout -----------------------------------------------------------------

export interface Slot {
  gx: number; // grid position relative to the room
  gy: number;
  level: number;
}

export const LANE_TOP = 1.2; // first row of a desk room
export const LANE_LEN = 6; // boxes side by side before they stack
export const lanePitch = (lanes: number, depth: number) => Math.min(1.7, (depth - LANE_TOP - 0.5) / Math.max(1, lanes - 1 || 1));

const GRID = { gx: 1.3, gy: 2.6, dx: 1.32, dy: 1.3, cols: 5, rows: 3 }; // a waiting room's floor grid

/** How many of the grid's columns the pallet takes: a share like that of the boxes nobody holds. */
export function palletCols(loose: number, total: number) {
  if (!loose) return 0;
  if (loose >= total) return GRID.cols;
  return Math.max(1, Math.min(GRID.cols - 1, Math.round((GRID.cols * loose) / total)));
}

/** The pallet for boxes nobody holds: a marked patch of floor over the grid's last columns, relative to the room. */
export function pallet(cols: number) {
  return {
    gx: GRID.gx + (GRID.cols - cols) * GRID.dx - 0.6,
    gy: GRID.gy - 0.6,
    w: (cols - 1) * GRID.dx + 1.2,
    d: (GRID.rows - 1) * GRID.dy + 1.2,
  };
}

/**
 * Where each box of a room stands, relative to the room's origin. With
 * `keep`, boxes nobody holds stand apart on the pallet and the rest keep
 * to the columns beside it.
 */
export function slots(zone: ZoneView, boxes: Box[], lanes: string[], depth: number, keep = false): Map<string, Slot> {
  const out = new Map<string, Slot>();
  if (zone.kind === 'desk') {
    // One row per assignee: the desk on the left, that person's boxes lined up
    // beside it. The last row is the shared shelf for unassigned boxes.
    const pitch = lanePitch(lanes.length, depth);
    const perLane = new Map<string, number>();
    for (const b of boxes) {
      const lane = Math.max(0, lanes.indexOf(b.assigneeId));
      const n = perLane.get(b.assigneeId) ?? 0;
      perLane.set(b.assigneeId, n + 1);
      out.set(b.key, { gx: 2.3 + (n % LANE_LEN) * 1.0, gy: LANE_TOP + lane * pitch, level: Math.floor(n / LANE_LEN) });
    }
    return out;
  }
  const place = (list: Box[], first: number, cols: number) =>
    list.forEach((b, i) => {
      const at = i % (cols * GRID.rows);
      out.set(b.key, { gx: GRID.gx + (first + (at % cols)) * GRID.dx, gy: GRID.gy + Math.floor(at / cols) * GRID.dy, level: Math.floor(i / (cols * GRID.rows)) });
    });
  const loose = keep ? boxes.filter((b) => !b.assigneeId) : [];
  const cols = palletCols(loose.length, boxes.length);
  if (cols < GRID.cols) place(boxes.filter((b) => !loose.includes(b)), 0, GRID.cols - cols);
  if (cols) place(loose, GRID.cols - cols, cols);
  return out;
}
