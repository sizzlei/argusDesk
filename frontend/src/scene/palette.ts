// Colours, and how a box's age turns into one.

import type { Box, ZoneKind } from '../types';

// ---- colours ----------------------------------------------------------------

export const INK = 0x1f2a44;
export const QUIET = 0x667085;
export const ACCENT = 0x3b5bdb;
export const GROUND_SLAB = 0xdde3ec;
export const WALL = 0xf6f8fb;
export const PARTITION = 0xc8d0dc;
export const FLOOR: Record<ZoneKind, number> = {
  wait: 0xf2e6cc,
  work: 0xd6e7f7,
  desk: 0xd3eedd,
  done: 0xfbe2b4,
  returned: 0xf5d7d3,
  unsorted: 0xe4dcf5,
  siding: 0xe9e3f2,
};
export const TAGS: Record<string, number> = {
  orange: 0xf08c3a,
  purple: 0x8b63c9,
  blue: 0x3d85c6,
  green: 0x3f9c63,
  teal: 0x2f9a9a,
  pink: 0xd9629a,
  yellow: 0xd9b02f,
  navy: 0x34477f,
  gray: 0x8a8f99,
};
export const CARDBOARD = 0xd9a866;
/** Box colour by how old it is: fresh, nearing the limit, then three steps past it. */
export const AGE = [CARDBOARD, 0xe9a23b, 0xe56b3c, 0xc7352f, 0x8a1c2c];
export const UNSCHEDULED = 0xcfd5de;
export const SKIN = 0xf3d2b3;

export function mix(a: number, b: number, t: number) {
  const ch = (s: number) => {
    const x = (a >> s) & 255;
    const y = (b >> s) & 255;
    return Math.round(x + (y - x) * t) << s;
  };
  return ch(16) | ch(8) | ch(0);
}
export const shade = (c: number, t: number) => mix(c, 0x1b2233, t);
export const tint = (c: number, t: number) => mix(c, 0xffffff, t);

/** 0 fresh · 1 past half the limit · 2 past the limit · 3 past 3x · 4 past 10x. */
export function ageStep(b: Box) {
  if (b.note || !b.staleRatio) return 0;
  const r = b.staleRatio;
  return r < 0.5 ? 0 : r < 1 ? 1 : r < 3 ? 2 : r < 10 ? 3 : 4;
}

/** "5시간", "3일", "2달": how long past its starting point a box is. */
export function shortAge(ms: number) {
  const h = ms / 3600_000;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}분`;
  if (h < 48) return `${Math.round(h)}시간`;
  const d = h / 24;
  return d < 60 ? `${Math.round(d)}일` : `${Math.round(d / 30)}달`;
}

/** Jira display names may carry a department after the name: keep the name. */
export const shortName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
