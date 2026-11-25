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

/** Where each box of a room stands, relative to the room's origin. */
export function slots(zone: ZoneView, boxes: Box[], lanes: string[], depth: number): Map<string, Slot> {
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
  const cols = 5;
  const rows = 3;
  boxes.forEach((b, i) => {
    const at = i % (cols * rows);
    out.set(b.key, { gx: 1.3 + (at % cols) * 1.32, gy: 2.6 + Math.floor(at / cols) * 1.3, level: Math.floor(i / (cols * rows)) });
  });
  return out;
}
