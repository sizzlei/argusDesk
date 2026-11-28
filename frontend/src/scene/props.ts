// The things a room is built from: flat-shaded blocks drawn in code.

import { Graphics, Text } from 'pixi.js';
import { type Look } from '../avatars';
import type { Box, ZoneKind } from '../types';
import { ZW, iso } from './grid';
import { INK, ACCENT, TAGS, AGE, UNSCHEDULED, SKIN, CARDBOARD, shade, tint, ageStep } from './palette';

// ---- drawing blocks ---------------------------------------------------------

export function label(text: string, size: number, colour: number, weight: '400' | '600' | '700' = '400') {
  return new Text({
    text,
    style: {
      fontFamily: '-apple-system, "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif',
      fontSize: size,
      fontWeight: weight,
      fill: colour,
    },
  });
}

/**
 * A flat-shaded block. (gx, gy) is its back corner on the grid, w and d its
 * size in tiles, h its height on screen and base how far it floats above the
 * floor. Light comes from the upper left: top brightest, right face darkest.
 */
export function block(g: Graphics, gx: number, gy: number, w: number, d: number, h: number, colour: number, base = 0) {
  const a = iso(gx, gy);
  const b = iso(gx + w, gy);
  const c = iso(gx + w, gy + d);
  const e = iso(gx, gy + d);
  const lo = -base;
  const hi = -base - h;
  g.poly([e.x, e.y + lo, c.x, c.y + lo, c.x, c.y + hi, e.x, e.y + hi]).fill(shade(colour, 0.1));
  g.poly([c.x, c.y + lo, b.x, b.y + lo, b.x, b.y + hi, c.x, c.y + hi]).fill(shade(colour, 0.26));
  g.poly([a.x, a.y + hi, b.x, b.y + hi, c.x, c.y + hi, e.x, e.y + hi]).fill(tint(colour, 0.16));
}

/** A soft shadow on the floor under a block. */
export function shadow(g: Graphics, gx: number, gy: number, w: number, d: number) {
  const p = [iso(gx + 0.12, gy + 0.12), iso(gx + w + 0.12, gy + 0.12), iso(gx + w + 0.12, gy + d + 0.12), iso(gx + 0.12, gy + d + 0.12)];
  g.poly(p.flatMap((q) => [q.x, q.y])).fill({ color: 0x1b2233, alpha: 0.1 });
}

export const BOX = 0.4; // half-size of a box in tiles
export const BOX_H = 27; // box height on screen

/** A cardboard box whose base centre sits at (0, 0). */
/** A box. `holder` is the colour of its holder's clothes (null = nobody holds it). */
export function drawBox(g: Graphics, b: Box, lit: boolean, holder: number | null = null) {
  const step = ageStep(b);
  const c = b.note ? UNSCHEDULED : AGE[step];
  g.clear();
  shadow(g, -BOX, -BOX, BOX * 2, BOX * 2);
  block(g, -BOX, -BOX, BOX * 2, BOX * 2, BOX_H, lit ? tint(c, 0.18) : c);
  // tape across the top: the colour of whoever holds the box, wider on mine; plain when nobody does
  const m1 = iso(0, -BOX);
  const m2 = iso(0, BOX);
  const tape = (width: number, color: number, alpha = 1) => g.moveTo(m1.x, m1.y - BOX_H).lineTo(m2.x, m2.y - BOX_H).stroke({ width, color, alpha });
  if (holder === null) {
    tape(3, shade(c, 0.16), 0.6);
  } else {
    // a white edge keeps the colour readable on a box of any age; mine is wider
    tape(b.mine ? 11 : 8, 0xffffff);
    tape(b.mine ? 7 : 5, holder);
  }
  // waybill on the left face: white label with a stripe in the request type's colour
  const l = iso(-BOX, BOX);
  const d = iso(BOX, BOX);
  const at = (t: number, up: number) => [l.x + (d.x - l.x) * t, l.y + (d.y - l.y) * t - up];
  g.poly([...at(0.08, 5), ...at(0.92, 5), ...at(0.92, 22), ...at(0.08, 22)]).fill(0xffffff);
  g.poly([...at(0.08, 5), ...at(0.26, 5), ...at(0.26, 22), ...at(0.08, 22)]).fill(TAGS[b.tag] ?? TAGS.gray);
  // urgent flag
  if (/high|highest|critical|긴급|높음/i.test(b.priority)) {
    g.moveTo(0, -BOX_H).lineTo(0, -BOX_H - 18).stroke({ width: 1.5, color: INK });
    g.poly([0, -BOX_H - 18, 10, -BOX_H - 14, 0, -BOX_H - 9]).fill(0xe03131);
  }
}

export function floorPoly(gx: number, gy: number, w: number, d: number) {
  return [iso(gx, gy), iso(gx + w, gy), iso(gx + w, gy + d), iso(gx, gy + d)].flatMap((q) => [q.x, q.y]);
}

/** Floor marking for boxes nobody holds: a yellow frame with warning stripes. */
export function hatch(g: Graphics, gx: number, gy: number, w: number, d: number) {
  const YELLOW = 0xe2a800;
  g.poly(floorPoly(gx, gy, w, d)).fill({ color: 0xffd84d, alpha: 0.22 });
  for (let t = 0.5; t < w + d; t += 0.5) {
    // diagonal stripes, clipped to the patch
    const a = iso(gx + Math.min(t, w), gy + Math.max(0, t - w));
    const b = iso(gx + Math.max(0, t - d), gy + Math.min(t, d));
    g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 2, color: YELLOW, alpha: 0.35 });
  }
  g.poly(floorPoly(gx, gy, w, d)).stroke({ width: 2, color: YELLOW, alpha: 0.9 });
}

/** A potted plant, for corners. */
export function plant(g: Graphics, gx: number, gy: number) {
  shadow(g, gx, gy, 0.4, 0.4);
  block(g, gx, gy, 0.4, 0.4, 9, 0xb7795a);
  const c = iso(gx + 0.2, gy + 0.2);
  g.poly([c.x - 13, c.y - 9, c.x, c.y - 2, c.x, c.y - 44]).fill(0x4fa86b);
  g.poly([c.x + 13, c.y - 9, c.x, c.y - 2, c.x, c.y - 44]).fill(0x3b8a55);
}

/** A tree in a planter: taller than the potted plant, with layered leaves. */
export function tree(g: Graphics, gx: number, gy: number) {
  shadow(g, gx - 0.1, gy - 0.1, 0.7, 0.7);
  block(g, gx, gy, 0.5, 0.5, 11, 0xe9e2d6);
  block(g, gx + 0.2, gy + 0.2, 0.1, 0.1, 16, 0x8a6a4a, 11);
  const c = iso(gx + 0.25, gy + 0.25);
  for (const [w, up, h] of [[20, 22, 26], [16, 38, 24], [11, 54, 22]] as const) {
    g.poly([c.x - w, c.y - up, c.x, c.y - up + 7, c.x, c.y - up - h]).fill(0x5cb37a);
    g.poly([c.x + w, c.y - up, c.x, c.y - up + 7, c.x, c.y - up - h]).fill(0x3f9460);
  }
  if (season() === 'xmas') dressTree(g, c.x, c.y);
}

/**
 * The season the centre dresses up for. December: every tree becomes a
 * Christmas tree. `?season=xmas` (or `none`) in the address forces one, to look at.
 */
export function season(now = new Date()): 'xmas' | '' {
  const forced = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('season') : null;
  if (forced) return forced === 'xmas' ? 'xmas' : '';
  return now.getMonth() === 11 ? 'xmas' : '';
}

const BAUBLES = [0xe5484d, 0xf5c542, 0x4c8df6, 0xf2f2f2, 0xd9479c];

/** Baubles, a garland and a star on a tree whose foot is at (x, y) on screen. */
function dressTree(g: Graphics, x: number, y: number) {
  // a garland winding down: a few gold strokes across the layers
  for (const [w, up] of [[9, 66], [13, 49], [17, 32]] as const) {
    g.moveTo(x - w, y - up + 2).quadraticCurveTo(x, y - up + 9, x + w, y - up - 2).stroke({ width: 1.4, color: 0xf5c542, alpha: 0.9 });
  }
  // baubles, the same on every tree so the floor does not flicker between redraws
  const at: [number, number][] = [[-12, 26], [8, 30], [15, 24], [-5, 40], [10, 43], [-9, 52], [4, 58], [-2, 70], [-15, 29], [2, 34]];
  at.forEach(([dx, up], i) => g.circle(x + dx, y - up, 2.1).fill(BAUBLES[i % BAUBLES.length]));
  // the star on top
  const sx = x;
  const sy = y - 78;
  const pts: number[] = [];
  for (let k = 0; k < 10; k++) {
    const r = k % 2 ? 2.6 : 6;
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    pts.push(sx + Math.cos(a) * r, sy + Math.sin(a) * r);
  }
  g.poly(pts).fill(0xf5c542).stroke({ width: 0.8, color: 0xc99a1e });
}

/** A long planter of low bushes, to line a wall. */
export function hedge(g: Graphics, gx: number, gy: number, along: 'x' | 'y', len: number) {
  const [w, d] = along === 'x' ? [len, 0.4] : [0.4, len];
  shadow(g, gx, gy, w, d);
  block(g, gx, gy, w, d, 8, 0xe9e2d6);
  for (let t = 0.05; t < len - 0.3; t += 0.42) {
    const [bx, by] = along === 'x' ? [gx + t, gy + 0.05] : [gx + 0.05, gy + t];
    block(g, bx, by, 0.3, 0.3, 9 + ((t * 10) % 3) * 2, t % 0.84 < 0.42 ? 0x5cb37a : 0x4aa36c, 8);
  }
}

/** An air purifier: a white tower with a grille and a status light. */
export function purifier(g: Graphics, gx: number, gy: number) {
  shadow(g, gx, gy, 0.5, 0.5);
  block(g, gx, gy, 0.5, 0.5, 34, 0xf4f6f9);
  block(g, gx + 0.06, gy + 0.06, 0.38, 0.38, 3, 0x9aa3b5, 34); // outlet on top
  // grille on the left front face
  const l = iso(gx, gy + 0.5);
  const r = iso(gx + 0.5, gy + 0.5);
  for (let i = 0; i < 4; i++) {
    const up = 8 + i * 5;
    g.moveTo(l.x + 3, l.y + 1.5 - up).lineTo(r.x - 3, r.y - 1.5 - up).stroke({ width: 1.5, color: 0xc3cad6 });
  }
  g.circle((l.x + r.x) / 2, (l.y + r.y) / 2 - 29, 1.8).fill(0x3fd08a); // air is clean
}

/** A water cooler. */
export function cooler(g: Graphics, gx: number, gy: number) {
  shadow(g, gx, gy, 0.4, 0.4);
  block(g, gx, gy, 0.4, 0.4, 24, 0xeef1f5);
  block(g, gx + 0.07, gy + 0.07, 0.26, 0.26, 14, 0x9fd0f5, 24);
  block(g, gx + 0.1, gy + 0.1, 0.2, 0.2, 2, 0x6fb1e6, 38);
}

/** A bench against a wall. */
export function bench(g: Graphics, gx: number, gy: number, along: 'x' | 'y', len: number) {
  const [w, d] = along === 'x' ? [len, 0.5] : [0.5, len];
  shadow(g, gx, gy, w, d);
  block(g, gx, gy, w, d, 4, 0x7f95c9, 7);
  block(g, gx + 0.05, gy + 0.05, 0.1, 0.1, 7, 0x8a93a6);
  block(g, gx + w - 0.15, gy + d - 0.15, 0.1, 0.1, 7, 0x8a93a6);
}

/** A sofa with its back to the far side, and a low table in front of it. */
export function sofa(g: Graphics, gx: number, gy: number) {
  shadow(g, gx, gy, 2.2, 0.9);
  block(g, gx, gy, 2.2, 0.3, 22, 0x6f86c9); // back
  block(g, gx, gy + 0.3, 2.2, 0.6, 10, 0x8ea3dd); // seat
  block(g, gx, gy + 0.3, 0.25, 0.6, 16, 0x6f86c9); // arms
  block(g, gx + 1.95, gy + 0.3, 0.25, 0.6, 16, 0x6f86c9);
  shadow(g, gx + 0.5, gy + 1.5, 1.2, 0.6);
  block(g, gx + 0.5, gy + 1.5, 1.2, 0.6, 3, 0xe6d3b3, 8);
  block(g, gx + 0.6, gy + 1.6, 0.1, 0.1, 8, 0x8a93a6);
  block(g, gx + 1.5, gy + 1.9, 0.1, 0.1, 8, 0x8a93a6);
  block(g, gx + 0.9, gy + 1.65, 0.16, 0.16, 5, 0xffffff, 11); // a cup
}

/** A database: the stacked-discs symbol as a tank, so the room says what it is. */
export function dbTank(g: Graphics, gx: number, gy: number) {
  const c = iso(gx, gy);
  g.ellipse(c.x + 3, c.y + 2, 22, 11).fill({ color: 0x1b2233, alpha: 0.12 });
  for (let i = 0; i < 3; i++) {
    const y = c.y - 4 - i * 15;
    g.rect(c.x - 18, y - 12, 36, 12).fill(shade(ACCENT, 0.18));
    g.rect(c.x - 18, y - 12, 14, 12).fill(shade(ACCENT, 0.05));
    g.ellipse(c.x, y, 18, 9).fill(shade(ACCENT, 0.18));
    g.ellipse(c.x, y - 12, 18, 9).fill(tint(ACCENT, 0.35));
  }
}

export interface Lamp {
  x: number;
  y: number;
  colour: number;
  phase: number;
  rate: number;
  g?: Graphics; // drawn once; blinking changes only its tint and alpha
}

/** A server rack. Its lamps are returned so they can blink. */
export function rack(g: Graphics, gx: number, gy: number, lamps: Lamp[]) {
  const w = 1.0;
  const d = 0.8;
  const h = 46;
  shadow(g, gx, gy, w, d);
  block(g, gx, gy, w, d, h, 0x2b3550);
  // the front (left face): shelves of equipment, each with a pair of lamps
  const l = iso(gx, gy + d);
  const r = iso(gx + w, gy + d);
  const at = (t: number, up: number) => ({ x: l.x + (r.x - l.x) * t, y: l.y + (r.y - l.y) * t - up });
  for (let i = 0; i < 5; i++) {
    const up = 6 + i * 8;
    const a = at(0.1, up);
    const b = at(0.9, up);
    g.poly([a.x, a.y, b.x, b.y, b.x, b.y - 5, a.x, a.y - 5]).fill(0x3a4668);
    for (const t of [0.2, 0.32]) {
      const p = at(t, up + 2.5);
      lamps.push({ x: p.x, y: p.y, colour: (i + Math.round(t * 10)) % 5 === 0 ? 0xffc145 : 0x3fd08a, phase: Math.random() * 6, rate: 1.5 + Math.random() * 5 });
    }
  }
}

/** A cooling unit for the server room. */
export function chiller(g: Graphics, gx: number, gy: number) {
  shadow(g, gx, gy, 0.8, 1.2);
  block(g, gx, gy, 0.8, 1.2, 30, 0xe6eaf0);
  const l = iso(gx, gy + 1.2);
  const r = iso(gx + 0.8, gy + 1.2);
  const cx = (l.x + r.x) / 2;
  const cy = (l.y + r.y) / 2 - 15;
  g.ellipse(cx, cy, 8, 9).fill(0x9aa3b5);
  g.ellipse(cx, cy, 3, 3.5).fill(0xe6eaf0);
}

/**
 * The packing bench: the waiting room's counter on a floor where the team
 * writes its own tickets. A label printer, a roll of waybills and an open
 * box wait on it. `lit` is the look under the pointer.
 */
export function packing(g: Graphics, gx: number, gy: number, lit: boolean) {
  const x = gx + 2.6;
  const y = gy + 0.5;
  const top = 15;
  shadow(g, x, y, 2.8, 0.6);
  block(g, x, y, 2.8, 0.6, top, lit ? 0xd9b98c : 0xc9a77a);
  block(g, x, y, 2.8, 0.6, 3, lit ? 0xfffaf0 : 0xf3ead9, top);
  // label printer, a waybill coming out of it
  block(g, x + 0.2, y + 0.1, 0.55, 0.4, 9, 0x2b3550, top + 3);
  block(g, x + 0.28, y + 0.46, 0.4, 0.12, 1, 0xffffff, top + 6);
  block(g, x + 0.3, y + 0.16, 0.12, 0.1, 2, lit ? 0x7cf0a8 : 0x4fd08a, top + 12);
  // a pad of waybills, the top one with its coloured stripe
  block(g, x + 1.0, y + 0.14, 0.5, 0.34, 3, 0xffffff, top + 3);
  block(g, x + 1.0, y + 0.14, 0.1, 0.34, 1, ACCENT, top + 6);
  // an open box, flaps up, waiting for its waybill
  block(g, x + 1.85, y + 0.06, 0.72, 0.5, 13, CARDBOARD, top + 3);
  block(g, x + 1.91, y + 0.1, 0.6, 0.42, 1, shade(CARDBOARD, 0.35), top + 15);
  block(g, x + 1.85, y + 0.06, 0.06, 0.5, 6, tint(CARDBOARD, 0.25), top + 16);
  block(g, x + 2.51, y + 0.06, 0.06, 0.5, 6, shade(CARDBOARD, 0.1), top + 16);
}

/** A desk with a monitor, seen from its side; the shelf variant is a low rack. */
export function desk(g: Graphics, gx: number, gy: number, kind: 'desk' | 'shelf' | 'mine') {
  const x = gx - 0.3;
  const y = gy - 0.45;
  shadow(g, x, y, 0.6, 0.9);
  if (kind === 'shelf') {
    block(g, x, y, 0.6, 0.9, 10, 0x8792a5);
    block(g, x, y, 0.6, 0.9, 3, 0xaab3c2, 16);
    return;
  }
  block(g, x + 0.05, y + 0.05, 0.1, 0.1, 11, 0x8a93a6); // legs
  block(g, x + 0.45, y + 0.75, 0.1, 0.1, 11, 0x8a93a6);
  block(g, x, y, 0.6, 0.9, 3, kind === 'mine' ? 0x9db4f5 : 0xe6d3b3, 11); // top
  block(g, x + 0.4, y + 0.2, 0.06, 0.5, 13, 0x2b3550, 17); // monitor
  block(g, x + 0.4, y + 0.41, 0.06, 0.08, 4, 0x8a93a6, 14);
}

/** A person: body, head and hair as three blocks. */
export function person(g: Graphics, look: Look, me: boolean, mood = 0) {
  const colour = look.body;
  g.ellipse(0, 1, 11, 5.5).fill({ color: 0x1b2233, alpha: 0.14 });
  const sit = mood === 2 ? 7 : 0; // resting: seated on a bench, so the body is shorter and the legs point forward
  if (sit) block(g, -0.17, 0.02, 0.34, 0.3, 5, shade(colour, 0.3), 7);
  block(g, -0.17, -0.17, 0.34, 0.34, sit ? 13 : 20, colour, sit);
  block(g, -0.14, -0.14, 0.28, 0.28, 12, SKIN, 20);
  // hair: four shapes, so two teammates in the same colour still differ
  switch (look.style) {
    case 'tall':
      block(g, -0.15, -0.15, 0.3, 0.3, 8, look.hair, 32);
      break;
    case 'side':
      block(g, -0.15, -0.15, 0.3, 0.3, 4, look.hair, 32);
      block(g, -0.16, -0.16, 0.32, 0.1, 9, look.hair, 25); // falls down the back
      break;
    case 'cap':
      block(g, -0.15, -0.15, 0.3, 0.3, 5, look.hair, 32);
      block(g, -0.15, 0.13, 0.3, 0.12, 2, look.hair, 32); // the brim
      break;
    default:
      block(g, -0.15, -0.15, 0.3, 0.3, 4, look.hair, 32);
  }
  if (mood >= 1) {
    // tired: drops of sweat beside the head
    for (const [dx, dy] of mood === 2 ? [[-13, -34], [13, -30], [-10, -24]] : [[-13, -32], [12, -27]]) {
      g.poly([dx, dy - 5, dx + 2.6, dy, dx, dy + 2.6, dx - 2.6, dy]).fill(0x6fb1e6);
    }
  }
  if (me) g.poly([0, -56, 6, -50, 0, -44, -6, -50]).fill(ACCENT); // marker above my head
}

/** A bed in the lodge, with someone asleep in it or neatly made. */
export function bed(g: Graphics, gx: number, gy: number, colour: number | null) {
  shadow(g, gx, gy, 1.0, 1.9);
  block(g, gx, gy, 1.0, 0.12, 16, 0xb58a55); // headboard
  block(g, gx, gy + 0.1, 1.0, 1.8, 6, 0xf4efe6, 5); // mattress
  block(g, gx + 0.05, gy + 0.15, 0.1, 0.1, 5, 0x8a6a4a);
  block(g, gx + 0.85, gy + 1.75, 0.1, 0.1, 5, 0x8a6a4a);
  block(g, gx + 0.2, gy + 0.18, 0.6, 0.36, 4, 0xffffff, 11); // pillow
  block(g, gx, gy + 0.62, 1.0, 1.28, 5, colour ?? 0xcfd8e6, 11); // blanket
  if (colour !== null) {
    block(g, gx + 0.36, gy + 0.22, 0.28, 0.28, 9, SKIN, 15); // a head on the pillow
    block(g, gx + 0.35, gy + 0.21, 0.3, 0.14, 3, shade(colour, 0.55), 24);
    block(g, gx + 0.25, gy + 0.7, 0.5, 1.0, 4, tint(colour, 0.1), 16); // the sleeper under the blanket
  }
}

/** A floor lamp. */
export function lamp(g: Graphics, gx: number, gy: number) {
  shadow(g, gx, gy, 0.3, 0.3);
  block(g, gx + 0.1, gy + 0.1, 0.1, 0.1, 30, 0x8a93a6);
  block(g, gx, gy, 0.3, 0.3, 9, 0xffe7a3, 30);
}

/** A delivery truck parked outside the dock. */
export function truck(g: Graphics, gx: number, gy: number) {
  shadow(g, gx, gy, 2.9, 1.1);
  block(g, gx, gy, 1.9, 1.1, 34, 0xf7f9fc, 8); // cargo
  block(g, gx + 1.95, gy + 0.05, 0.85, 1.0, 24, ACCENT, 8); // cab
  block(g, gx + 2.45, gy + 0.1, 0.36, 0.9, 10, 0xbfd3f7, 20); // windscreen
  for (const wx of [0.35, 1.35, 2.3]) {
    const p = iso(gx + wx, gy + 1.1);
    g.ellipse(p.x + 4, p.y - 6, 7, 8).fill(0x2b3550);
    g.ellipse(p.x + 4, p.y - 6, 3, 3.5).fill(0x8a93a6);
  }
}

/** Furniture that tells the rooms apart at a glance. */
/**
 * Things that make a room a place rather than a store of boxes. They stand
 * where boxes and people never do: the corners and the strips along the walls.
 */
export function decorate(add: (gx: number, gy: number, draw: (g: Graphics) => void) => void, kind: ZoneKind, nth: number, gx: number, gy: number, d: number) {
  const right = gx + ZW;
  const front = gy + d;
  switch (kind) {
    case 'wait':
      add(gx + 0.5, gy + 0.5, (g) => tree(g, gx + 0.25, gy + 0.25));
      add(gx + 0.5, front - 1.6, (g) => bench(g, gx + 0.2, front - 2.4, 'y', 1.8));
      add(right - 0.5, front - 0.5, (g) => plant(g, right - 0.7, front - 0.7));
      break;
    case 'work':
      if (nth % 2 === 0) {
        add(gx + 0.45, front - 0.5, (g) => purifier(g, gx + 0.2, front - 0.75));
        add(gx + 0.4, gy + 0.5, (g) => plant(g, gx + 0.25, gy + 0.3));
      } else {
        add(gx + 0.5, front - 0.5, (g) => tree(g, gx + 0.25, front - 0.8));
        add(gx + 0.45, gy + 0.5, (g) => cooler(g, gx + 0.25, gy + 0.3));
      }
      add(gx + 3.9, front - 0.3, (g) => hedge(g, gx + 2.9, front - 0.5, 'x', 2.0));
      add(gx + 1.7, front - 0.75, (g) => bench(g, gx + 0.95, front - 1.0, 'x', 1.6));
      break;
    case 'desk':
      add(right - 0.5, gy + 0.4, (g) => purifier(g, right - 0.75, gy + 0.15));
      add(right - 0.5, front - 0.5, (g) => tree(g, right - 0.8, front - 0.8));
      add(gx + 0.45, front - 0.45, (g) => cooler(g, gx + 0.25, front - 0.65));
      add(gx + 4.2, front - 0.3, (g) => hedge(g, gx + 3.0, front - 0.5, 'x', 2.4));
      add(gx + 1.7, front - 0.75, (g) => bench(g, gx + 0.95, front - 1.0, 'x', 1.6));
      break;
    case 'done':
      add(right - 0.5, gy + 0.5, (g) => tree(g, right - 0.8, gy + 0.25));
      add(gx + 0.4, front - 0.5, (g) => plant(g, gx + 0.25, front - 0.7));
      break;
    default:
      break;
  }
}

export function furnish(g: Graphics, kind: ZoneKind, gx: number, gy: number) {
  switch (kind) {
    case 'wait': // reception counter
      shadow(g, gx + 2.6, gy + 0.5, 2.8, 0.6);
      block(g, gx + 2.6, gy + 0.5, 2.8, 0.6, 15, 0xc9a77a);
      block(g, gx + 2.6, gy + 0.5, 2.8, 0.6, 3, 0xf3ead9, 15);
      break;
    case 'work': // review table with two screens
      shadow(g, gx + 2.4, gy + 0.45, 3.2, 0.8);
      block(g, gx + 2.4, gy + 0.45, 3.2, 0.8, 3, 0xe6d3b3, 12);
      block(g, gx + 2.5, gy + 0.55, 0.14, 0.14, 12, 0x8a93a6);
      block(g, gx + 5.35, gy + 1.0, 0.14, 0.14, 12, 0x8a93a6);
      block(g, gx + 3.0, gy + 0.55, 0.6, 0.06, 14, 0x2b3550, 18);
      block(g, gx + 4.3, gy + 0.55, 0.6, 0.06, 14, 0x2b3550, 18);
      plant(g, gx + ZW - 0.9, gy + 0.4);
      break;
    case 'done': // pallet
      shadow(g, gx + 0.5, gy + 0.5, 1.4, 1.0);
      block(g, gx + 0.5, gy + 0.5, 1.4, 1.0, 5, 0xb58a55);
      break;
    case 'returned': // cage bin
      shadow(g, gx + 0.6, gy + 0.5, 1.2, 1.0);
      block(g, gx + 0.6, gy + 0.5, 1.2, 1.0, 20, 0x9aa3b5);
      block(g, gx + 0.7, gy + 0.6, 1.0, 0.8, 2, 0x5d6678, 20);
      break;
    default:
      break;
  }
}

/**
 * The dust monster: a ball of grey fluff that gathers where old boxes pile up.
 * `size` 1..3 grows with the pile; `hurt` 0..1 is how much of it the team has
 * already swept away (it shrinks and looks worried). Drawn round (0, 0), its feet.
 */
export function dustMonster(g: Graphics, size: number, hurt = 0) {
  const s = (0.75 + size * 0.3) * (1 - hurt * 0.35);
  const R = 26 * s;
  const cy = -R * 0.95; // the middle of the body
  g.ellipse(0, 2, R * 1.05, R * 0.42).fill({ color: 0x1b2233, alpha: 0.16 });
  // feet
  for (const fx of [-0.45, 0.45]) g.ellipse(fx * R, -2 * s, 7 * s, 4 * s).fill(0x55515c);
  // the fluff: a jagged ball in three tones, light from the top left
  const ball = (r: number, dx: number, dy: number, spikes: number, colour: number) => {
    const pts: number[] = [];
    for (let i = 0; i < spikes * 2; i++) {
      const a = (i / (spikes * 2)) * Math.PI * 2;
      const rr = r * (i % 2 ? 0.86 : 1.06 + ((i * 37) % 5) * 0.025);
      pts.push(dx + Math.cos(a) * rr, cy + dy + Math.sin(a) * rr * 0.92);
    }
    g.poly(pts).fill(colour);
  };
  ball(R, 0, 0, 13, 0x6f6b76);
  ball(R * 0.86, -R * 0.08, -R * 0.08, 11, 0x8e8a95);
  ball(R * 0.55, -R * 0.26, -R * 0.3, 9, 0xaaa6b0);
  // a few loose tufts on top
  for (const [tx, ty, h] of [[-0.3, -1.0, 9], [0.05, -1.08, 12], [0.35, -0.98, 8]] as const) {
    g.poly([tx * R - 3 * s, cy + ty * R + 6 * s, tx * R + 3 * s, cy + ty * R + 6 * s, tx * R + 1 * s, cy + ty * R - h * s]).fill(0x7c7883);
  }
  // eyes: big and round; brows down when it is strong, up when it is losing
  const ey = cy - R * 0.12;
  for (const side of [-1, 1]) {
    const ex = side * R * 0.33;
    g.ellipse(ex, ey, 7.5 * s, 8.5 * s).fill(0xffffff).stroke({ width: 1, color: 0x3a3742 });
    g.circle(ex + side * -1.2 * s, ey + 1.8 * s, 3.6 * s).fill(0x1f1d24);
    g.circle(ex + side * -2.2 * s, ey + 0.4 * s, 1.2 * s).fill(0xffffff);
    // angry: the inner end lower than the outer; worried: the other way round
    const tilt = (hurt > 0.5 ? -3.5 : 4.5) * s;
    const inner = { x: ex - side * 6 * s, y: ey - 9 * s + tilt };
    const outer = { x: ex + side * 7 * s, y: ey - 9 * s - tilt };
    g.moveTo(inner.x, inner.y).lineTo(outer.x, outer.y).stroke({ width: 2.6 * s, color: 0x2b2830, cap: 'round' });
  }
  // mouth: a jagged grin, or a wobbly worried line
  const my = cy + R * 0.35;
  if (hurt > 0.5) {
    g.moveTo(-7 * s, my).quadraticCurveTo(-3.5 * s, my - 3 * s, 0, my).quadraticCurveTo(3.5 * s, my + 3 * s, 7 * s, my).stroke({ width: 2 * s, color: 0x2b2830, cap: 'round' });
  } else {
    g.poly([-10 * s, my - 2 * s, 10 * s, my - 2 * s, 7 * s, my + 5 * s, -7 * s, my + 5 * s]).fill(0x2b2830);
    for (let i = 0; i < 4; i++) {
      const x = -7.5 * s + i * 5 * s;
      g.poly([x, my - 2 * s, x + 3.2 * s, my - 2 * s, x + 1.6 * s, my + 1.6 * s]).fill(0xf4f1ea);
    }
  }
  // dust in the air around it
  for (const [px, py, r] of [[-1.25, -1.5, 2.2], [1.2, -1.2, 1.8], [-1.05, -0.3, 1.5], [1.35, -0.55, 2.4], [0.2, -2.05, 1.6]] as const) {
    g.rect(px * R - r * s, cy + (py + 1) * R - r * s, r * 2 * s, r * 2 * s).fill({ color: 0x8e8a95, alpha: 0.7 });
  }
}

/**
 * The work room's whiteboard: the week's deployments, a column a day (Monday
 * to Sunday), a dot for each still to go out (three at most; a red top dot
 * means more). Today's column is underlined; the title is written on the heading.
 * (gx, gy) is its left foot; it stands along the x axis, facing the viewer.
 */
export function whiteboard(g: Graphics, gx: number, gy: number, counts: number[], today: number) {
  const W = 2.3;
  shadow(g, gx, gy - 0.05, W, 0.25);
  block(g, gx + 0.05, gy, 0.06, 0.06, 18, 0x8a93a6);
  block(g, gx + W - 0.11, gy, 0.06, 0.06, 18, 0x8a93a6);
  block(g, gx, gy - 0.02, W, 0.1, 40, 0xc9d1de, 16); // frame
  block(g, gx + 0.04, gy - 0.04, W - 0.08, 0.08, 34, 0xffffff, 19); // the board
  block(g, gx + 0.04, gy - 0.04, W - 0.08, 0.08, 10, 0x7048e8, 43); // its heading, where the title is written
  const col = (W - 0.3) / 7;
  for (let i = 0; i < 7; i++) {
    const c = iso(gx + 0.15 + (i + 0.5) * col, gy + 0.04);
    if (i === today) g.moveTo(c.x - 6, c.y - 19).lineTo(c.x + 6, c.y - 19 + 3).stroke({ width: 2, color: 0x7048e8 });
    for (let k = 0; k < Math.min(3, counts[i] ?? 0); k++) g.circle(c.x, c.y - 24 - k * 5.5, 2.3).fill(k === 2 && counts[i] > 3 ? 0xe5484d : i >= 5 ? 0x9aa3b5 : 0x4c8df6);
  }
}
