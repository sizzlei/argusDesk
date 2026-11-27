// The front yard: what the centre has grown, standing along the front of the
// building on the ground floor. Each thing is drawn round its middle (gx, gy)
// and fits in about two tiles by one and a half.

import { Graphics } from 'pixi.js';
import { iso } from './grid';
import { block, shadow } from './props';
import { shade } from './palette';

const POST = 0x5d6678;

/** A signboard on two posts; its words are put on by the scene (text is not drawn here). */
function board(g: Graphics, gx: number, gy: number, face: number, rim: number) {
  shadow(g, gx - 0.8, gy - 0.1, 1.6, 0.3);
  block(g, gx - 0.75, gy, 0.1, 0.1, 30, POST);
  block(g, gx + 0.65, gy, 0.1, 0.1, 30, POST);
  block(g, gx - 0.9, gy - 0.02, 1.8, 0.14, 22, rim, 26);
  block(g, gx - 0.84, gy - 0.04, 1.68, 0.1, 18, face, 29);
}

function planters(g: Graphics, gx: number, gy: number) {
  const flowers = [0xe5484d, 0xf5c542, 0xf29bb5, 0xffffff, 0xa86fe0];
  for (const [ox, oy] of [[-0.95, -0.4], [-0.95, 0.25]] as const) {
    shadow(g, gx + ox, gy + oy, 1.9, 0.45);
    block(g, gx + ox, gy + oy, 1.9, 0.45, 9, 0xb08a63);
    block(g, gx + ox + 0.05, gy + oy + 0.05, 1.8, 0.35, 2, 0x5b8f4a, 9);
    for (let i = 0; i < 7; i++) {
      const p = iso(gx + ox + 0.15 + i * 0.26, gy + oy + 0.22);
      g.circle(p.x, p.y - 13 - (i % 2) * 3, 3.2).fill(flowers[(i + (oy > 0 ? 2 : 0)) % flowers.length]);
      g.circle(p.x, p.y - 13 - (i % 2) * 3, 1.2).fill(0xf8e08a);
    }
  }
}

function coffee(g: Graphics, gx: number, gy: number) {
  shadow(g, gx - 0.7, gy - 0.35, 1.4, 0.8);
  block(g, gx - 0.7, gy - 0.35, 1.4, 0.75, 22, 0x8a5a3a, 6);
  block(g, gx - 0.72, gy - 0.37, 1.44, 0.79, 3, 0xf3ead9, 28);
  // wheels
  for (const wx of [-0.45, 0.45]) {
    const p = iso(gx + wx, gy + 0.42);
    g.ellipse(p.x, p.y - 5, 5, 5.5).fill(0x2b3550);
  }
  // the awning, striped
  for (let i = 0; i < 5; i++) block(g, gx - 0.75 + i * 0.3, gy - 0.45, 0.3, 0.95, 3, i % 2 ? 0xffffff : 0xd9534f, 52);
  block(g, gx - 0.68, gy - 0.3, 0.06, 0.06, 22, POST, 30);
  block(g, gx + 0.6, gy - 0.3, 0.06, 0.06, 22, POST, 30);
  // cups on the counter, with steam
  for (const cx of [-0.3, 0.05, 0.35]) {
    const p = iso(gx + cx, gy);
    g.rect(p.x - 2.5, p.y - 38, 5, 6).fill(0xffffff);
    g.moveTo(p.x, p.y - 41).quadraticCurveTo(p.x + 3, p.y - 46, p.x, p.y - 51).stroke({ width: 1.2, color: 0xffffff, alpha: 0.8 });
  }
}

function fountain(g: Graphics, gx: number, gy: number) {
  const c = iso(gx, gy);
  g.ellipse(c.x + 3, c.y + 3, 40, 19).fill({ color: 0x1b2233, alpha: 0.1 });
  g.ellipse(c.x, c.y, 38, 18).fill(0xcfc6b8);
  g.ellipse(c.x, c.y - 6, 38, 18).fill(0xe5ded2);
  g.ellipse(c.x, c.y - 6, 31, 14).fill(0x7fc3ea);
  g.ellipse(c.x, c.y - 6, 22, 9).fill({ color: 0xbfe6fb, alpha: 0.6 });
  g.rect(c.x - 4, c.y - 26, 8, 20).fill(0xe5ded2);
  g.ellipse(c.x, c.y - 26, 11, 5).fill(0xcfc6b8);
  // the jet and its fall
  g.moveTo(c.x - 2, c.y - 28).lineTo(c.x, c.y - 52).lineTo(c.x + 2, c.y - 28).fill({ color: 0xbfe6fb, alpha: 0.9 });
  for (const s of [-1, 1]) g.moveTo(c.x, c.y - 50).quadraticCurveTo(c.x + s * 16, c.y - 50, c.x + s * 20, c.y - 12).stroke({ width: 2, color: 0x9fd6f5, alpha: 0.85 });
}

function streetLamps(g: Graphics, gx: number, gy: number) {
  for (const ox of [-0.8, 0.8]) {
    shadow(g, gx + ox - 0.1, gy - 0.1, 0.25, 0.25);
    block(g, gx + ox - 0.05, gy - 0.05, 0.1, 0.1, 50, POST);
    const p = iso(gx + ox, gy);
    g.circle(p.x, p.y - 54, 7).fill({ color: 0xffe9a8, alpha: 0.35 });
    g.circle(p.x, p.y - 54, 4).fill(0xfff4cf);
  }
  shadow(g, gx - 0.55, gy + 0.05, 1.1, 0.4);
  block(g, gx - 0.55, gy + 0.05, 1.1, 0.4, 4, 0x9a7650, 7);
  block(g, gx - 0.55, gy + 0.4, 1.1, 0.06, 10, 0x9a7650, 11);
}

function arch(g: Graphics, gx: number, gy: number) {
  shadow(g, gx - 0.9, gy - 0.1, 1.8, 0.3);
  block(g, gx - 0.85, gy - 0.05, 0.16, 0.16, 46, 0xf2efe8);
  block(g, gx + 0.7, gy - 0.05, 0.16, 0.16, 46, 0xf2efe8);
  const a = iso(gx - 0.78, gy);
  const b = iso(gx + 0.78, gy);
  g.moveTo(a.x, a.y - 46).bezierCurveTo(a.x, a.y - 80, b.x, b.y - 80, b.x, b.y - 46).stroke({ width: 6, color: 0x5cb37a });
  const flowers = [0xf29bb5, 0xffffff, 0xe5484d, 0xf5c542];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const x = (1 - t) ** 3 * a.x + 3 * (1 - t) ** 2 * t * a.x + 3 * (1 - t) * t ** 2 * b.x + t ** 3 * b.x;
    const y = (1 - t) ** 3 * (a.y - 46) + 3 * (1 - t) ** 2 * t * (a.y - 80) + 3 * (1 - t) * t ** 2 * (b.y - 80) + t ** 3 * (b.y - 46);
    g.circle(x, y, 3.4).fill(flowers[i % flowers.length]);
  }
}

function vending(g: Graphics, gx: number, gy: number) {
  shadow(g, gx - 0.4, gy - 0.3, 0.8, 0.6);
  block(g, gx - 0.4, gy - 0.3, 0.8, 0.55, 52, 0xd9534f);
  const p = iso(gx - 0.4, gy + 0.25);
  const q = iso(gx + 0.2, gy + 0.25);
  // the window of cans, on the front face
  g.poly([p.x + 3, p.y - 44, q.x, q.y - 44, q.x, q.y - 20, p.x + 3, p.y - 20]).fill(0xe9f2fb);
  for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) {
    const x = p.x + 6 + k * ((q.x - p.x - 6) / 3);
    const y = p.y - 40 + r * 7 + ((q.y - p.y) * k) / 3;
    g.rect(x, y, 4, 5).fill([0x4c8df6, 0xf5c542, 0x3f9c63][(r + k) % 3]);
  }
}

function bikes(g: Graphics, gx: number, gy: number) {
  shadow(g, gx - 0.9, gy - 0.1, 1.8, 0.4);
  block(g, gx - 0.9, gy, 1.8, 0.08, 8, POST);
  const frames = [0x4c8df6, 0x3f9c63, 0xd9534f];
  for (let i = 0; i < 3; i++) {
    const p = iso(gx - 0.6 + i * 0.6, gy + 0.15);
    for (const w of [-7, 7]) g.circle(p.x + w, p.y - 8, 6).stroke({ width: 1.8, color: 0x2b3550 });
    g.moveTo(p.x - 7, p.y - 8).lineTo(p.x, p.y - 16).lineTo(p.x + 7, p.y - 8).lineTo(p.x - 2, p.y - 8).lineTo(p.x, p.y - 16).stroke({ width: 2, color: frames[i] });
    g.rect(p.x - 3, p.y - 19, 5, 2).fill(0x2b3550);
  }
}

function pond(g: Graphics, gx: number, gy: number) {
  const c = iso(gx, gy);
  g.ellipse(c.x, c.y, 44, 19).fill(0xb9b2a5);
  g.ellipse(c.x, c.y - 1, 40, 16).fill(0x6fb6dc);
  g.ellipse(c.x - 6, c.y - 3, 26, 9).fill({ color: 0xbfe6fb, alpha: 0.45 });
  for (const [dx, dy] of [[-18, 2], [12, -5], [22, 4]]) {
    g.ellipse(c.x + dx, c.y + dy, 6, 3).fill(0x4f9a5c);
    g.circle(c.x + dx + 2, c.y + dy - 1, 1.6).fill(0xf29bb5);
  }
  for (const [dx, dy] of [[-40, -2], [36, -6], [-30, 10], [30, 10]]) g.ellipse(c.x + dx, c.y + dy, 5, 3).fill(0x8f897e);
}

function parasol(g: Graphics, gx: number, gy: number) {
  shadow(g, gx - 0.45, gy - 0.35, 0.9, 0.7);
  block(g, gx - 0.35, gy - 0.3, 0.7, 0.6, 3, 0xffffff, 14);
  block(g, gx - 0.04, gy - 0.04, 0.08, 0.08, 14, POST);
  block(g, gx - 0.03, gy - 0.03, 0.06, 0.06, 34, POST, 17);
  const c = iso(gx, gy);
  const cols = [0xf5c542, 0xffffff];
  for (let i = 0; i < 8; i++) {
    const a0 = (i / 8) * Math.PI * 2;
    const a1 = ((i + 1) / 8) * Math.PI * 2;
    g.poly([c.x, c.y - 60, c.x + Math.cos(a0) * 34, c.y - 46 + Math.sin(a0) * 15, c.x + Math.cos(a1) * 34, c.y - 46 + Math.sin(a1) * 15]).fill(cols[i % 2]);
  }
  for (const ox of [-0.7, 0.55]) {
    shadow(g, gx + ox, gy - 0.1, 0.25, 0.25);
    block(g, gx + ox, gy - 0.1, 0.22, 0.22, 8, 0x9a7650);
  }
}

function telescope(g: Graphics, gx: number, gy: number) {
  const c = iso(gx, gy);
  g.ellipse(c.x, c.y, 16, 7).fill({ color: 0x1b2233, alpha: 0.1 });
  for (const s of [-1, 0, 1]) g.moveTo(c.x, c.y - 26).lineTo(c.x + s * 11, c.y + (s === 0 ? 5 : 0)).stroke({ width: 2.4, color: POST });
  g.poly([c.x - 16, c.y - 22, c.x + 18, c.y - 40, c.x + 21, c.y - 34, c.x - 13, c.y - 17]).fill(0xf2efe8);
  g.poly([c.x + 18, c.y - 40, c.x + 24, c.y - 43, c.x + 27, c.y - 37, c.x + 21, c.y - 34]).fill(0x4c8df6);
}

/** Draws a thing of the yard. Returns the words for its signboard, if it has one. */
export function yardThing(g: Graphics, id: string, gx: number, gy: number): { text: string; colour: number; neon?: boolean } | null {
  switch (id) {
    case 'sign':
      board(g, gx, gy, 0xffffff, 0x34477f);
      return { text: 'ARGUS DESK', colour: 0x34477f };
    case 'neon':
      board(g, gx, gy, 0x2a2340, 0x7048e8);
      return { text: 'ARGUS DESK', colour: 0xff7ad9, neon: true };
    case 'planters':
      planters(g, gx, gy);
      break;
    case 'coffee':
      coffee(g, gx, gy);
      break;
    case 'fountain':
      fountain(g, gx, gy);
      break;
    case 'lamps':
      streetLamps(g, gx, gy);
      break;
    case 'arch':
      arch(g, gx, gy);
      break;
    case 'vending':
      vending(g, gx, gy);
      break;
    case 'bikes':
      bikes(g, gx, gy);
      break;
    case 'pond':
      pond(g, gx, gy);
      break;
    case 'parasol':
      parasol(g, gx, gy);
      break;
    case 'telescope':
      telescope(g, gx, gy);
      break;
  }
  return null;
}

/** The yard's paving: a strip along the front of the building. */
export function paving(g: Graphics, x0: number, y0: number, w: number, d: number) {
  const a = iso(x0, y0);
  const b = iso(x0 + w, y0);
  const c = iso(x0 + w, y0 + d);
  const e = iso(x0, y0 + d);
  g.poly([a.x, a.y, b.x, b.y, c.x, c.y, e.x, e.y]).fill({ color: 0xe9e3d8, alpha: 0.9 });
  for (let k = 1; k < w; k += 1) {
    const p = iso(x0 + k, y0);
    const q = iso(x0 + k, y0 + d);
    g.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ width: 1, color: shade(0xe9e3d8, 0.4), alpha: 0.25 });
  }
}

/** A small animal of the yard, drawn round its feet at (0, 0), facing right. */
export function pet(g: Graphics, kind: 'cat' | 'dog') {
  const fur = kind === 'cat' ? 0xf0a54a : 0xc9a27a;
  const dark = shade(fur, 0.25);
  g.ellipse(0, 1, 11, 4).fill({ color: 0x1b2233, alpha: 0.14 });
  for (const lx of [-6, -2, 3, 7]) g.rect(lx, -6, 2.4, 6).fill(dark);
  g.roundRect(-9, -14, 18, 9, 4.5).fill(fur);
  // the head, at the front
  g.circle(10, -15, 5.5).fill(fur);
  if (kind === 'cat') {
    g.poly([6.5, -19, 8, -24, 10, -19.5]).fill(fur);
    g.poly([10.5, -19.5, 13, -24, 14, -18.5]).fill(fur);
    g.moveTo(-9, -11).quadraticCurveTo(-17, -14, -14, -24).stroke({ width: 2.6, color: fur }); // tail up
  } else {
    g.ellipse(7, -15, 2.4, 4.5).fill(dark); // a floppy ear
    g.circle(15, -14, 1.6).fill(0x2b2b2b); // the nose
    g.moveTo(-9, -11).lineTo(-14, -15).stroke({ width: 2.6, color: fur });
  }
  g.circle(11.5, -16, 1).fill(0x1f2a44);
}
