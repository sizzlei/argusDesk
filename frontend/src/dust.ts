// Dust monsters: where old boxes pile up in a room, a monster of dust moves
// in. It grows with the pile and shrinks, looking worried, as the team sweeps
// it away; when fewer than two old boxes are left it is gone. Counted from
// the whole centre, not the filtered view, so a filter never "defeats" one.

import type { Snapshot } from './types';

export const DUST_FROM = 2; // old boxes in a room before a monster appears

export interface Dust {
  count: number; // old boxes in the room
  size: number; // 1..3
  hurt: number; // 0..1: how much of today's biggest pile has been swept away
  key: string; // "space/zone"
  name: string; // the room
}

const STORE = 'argusdesk.dust';
let day = '';
let peak: Record<string, number> = {};
let last: Map<string, Dust> | null = null;

const today = () => new Date().toDateString();

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? 'null') as { day: string; peak: Record<string, number> } | null;
    if (v && v.day === today()) [day, peak] = [v.day, v.peak];
  } catch {
    /* start afresh */
  }
}
function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify({ day, peak }));
  } catch {
    /* kept for this run only */
  }
}

/**
 * Reads the monsters from a snapshot. `gone` lists the rooms whose monster
 * was just swept away (by a change in Jira, since the last snapshot).
 */
export function readDust(snap: Snapshot): { dust: Map<string, Dust>; gone: Dust[] } {
  if (!day) load();
  if (day !== today()) [day, peak] = [today(), {}];
  const dust = new Map<string, Dust>();
  for (const sp of snap.spaces) {
    for (const z of sp.zones) {
      if (z.kind === 'done' || z.kind === 'returned') continue;
      const key = `${sp.id}/${z.id}`;
      const count = snap.boxes.filter((b) => b.space === sp.id && b.zone === z.id && b.stale).length;
      peak[key] = Math.max(peak[key] ?? 0, count);
      if (count < DUST_FROM) continue;
      const size = count >= 6 ? 3 : count >= 4 ? 2 : 1;
      dust.set(key, { key, count, size, hurt: peak[key] > count ? 1 - count / peak[key] : 0, name: z.name });
    }
  }
  const gone = last ? [...last.entries()].filter(([k]) => !dust.has(k)).map(([, d]) => d) : [];
  last = dust;
  save();
  return { dust, gone };
}
