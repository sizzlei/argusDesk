// The building itself: slab, walls, partitions and the conveyor.

import { Container, Graphics } from 'pixi.js';
import type { Scene } from '../scene';
import { ZW, COL_GAP, ATRIUM_GAP, grid, PAD, WALL_H, STOREY, iso, rowY } from './grid';
import { INK, GROUND_SLAB, WALL, PARTITION, shade, tint } from './palette';
import { label, block, floorPoly, tree, hedge, bench } from './props';
import { BELT_UP } from './parts';

/** The floor slab, the two back walls, the room partitions and the conveyor. */
export function drawBuilding(s: Scene, width: number, depth: number, rows: number, cols: number, floor: number, name: string, floors: number) {
  const SLAB = floor > 0 ? 0xe7e1d6 : floor < 0 ? 0xe2dccf : GROUND_SLAB; // a warmer floor away from the warehouse
  const g = new Graphics();
  const x0 = -PAD;
  const y0 = -PAD;
  const x1 = width + PAD;
  const y1 = depth + PAD;
  // ground shadow and slab
  g.poly(floorPoly(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0)).fill({ color: 0x1b2233, alpha: 0.08 });
  const fl = iso(x0, y1);
  const fr = iso(x1, y1);
  const rr = iso(x1, y0);
  // The floors under this one show as the building's outer walls below the slab.
  for (let k = floor; k >= 1; k--) {
    const top = 12 + (k - 1) * STOREY;
    g.poly([fl.x, fl.y + top, fr.x, fr.y + top, fr.x, fr.y + top + STOREY, fl.x, fl.y + top + STOREY]).fill(shade(WALL, 0.16));
    g.poly([fr.x, fr.y + top, rr.x, rr.y + top, rr.x, rr.y + top + STOREY, fr.x, fr.y + top + STOREY]).fill(shade(WALL, 0.3));
    // a band of windows and the slab line of the floor below
    for (const [p, q] of [[fl, fr], [fr, rr]] as const) {
      const at = (t: number, dy: number) => [p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t + top + dy];
      for (let t = 0.06; t < 0.9; t += 0.115) g.poly([...at(t, 8), ...at(t + 0.07, 8), ...at(t + 0.07, STOREY - 12), ...at(t, STOREY - 12)]).fill({ color: 0xcfe1f7, alpha: 0.75 });
      g.poly([...at(0, STOREY - 5), ...at(1, STOREY - 5), ...at(1, STOREY), ...at(0, STOREY)]).fill(shade(SLAB, 0.3));
    }
  }
  g.poly([fl.x, fl.y, fr.x, fr.y, fr.x, fr.y + 12, fl.x, fl.y + 12]).fill(shade(SLAB, 0.14));
  g.poly([fr.x, fr.y, rr.x, rr.y, rr.x, rr.y + 12, fr.x, fr.y + 12]).fill(shade(SLAB, 0.28));
  g.poly(floorPoly(x0, y0, x1 - x0, y1 - y0)).fill(SLAB);

  // back walls: we look at their inner faces
  const back = iso(x0, y0);
  const left = iso(x0, y1);
  g.poly([back.x, back.y, rr.x, rr.y, rr.x, rr.y - WALL_H, back.x, back.y - WALL_H]).fill(WALL);
  g.poly([back.x, back.y, left.x, left.y, left.x, left.y - WALL_H, back.x, back.y - WALL_H]).fill(shade(WALL, 0.08));
  // windows along both walls
  const win = (ax: number, ay: number, bx: number, by: number) => {
    const p = iso(ax, ay);
    const q = iso(bx, by);
    g.poly([p.x, p.y - 20, q.x, q.y - 20, q.x, q.y - 46, p.x, p.y - 46]).fill(0xcfe1f7);
  };
  for (let x = 1; x + 1.6 < x1; x += 2.7) win(x, y0, x + 1.6, y0);
  for (let y = 1; y + 1.6 < y1; y += 2.7) win(x0, y, x0, y + 1.6);
  // wall tops
  const t = 0.18;
  g.poly([...Object.values(iso(x0, y0)), ...Object.values(iso(x1, y0)), ...Object.values(iso(x1, y0 + t)), ...Object.values(iso(x0 + t, y0 + t)), ...Object.values(iso(x0 + t, y1)), ...Object.values(iso(x0, y1))].map((v, i) => (i % 2 ? v - WALL_H : v))).fill(tint(WALL, 0.5));
  s.ground.addChild(g);
  if (floors > 1) {
    // which floor this is, on the front corner of the slab
    const t = label(`${floor < 0 ? "B1" : `${floor + 1}F`}  ${name}`, 13, INK, '700');
    const pill = new Graphics().roundRect(0, 0, t.width + 20, 26, 13).fill(0xffffff).stroke({ width: 1, color: 0xcfd6e2 });
    t.position.set(10, (26 - t.height) / 2);
    const tagBox = new Container();
    tagBox.addChild(pill, t);
    tagBox.position.set(fl.x + 26, fl.y - 4);
    s.signs.addChild(tagBox);
  }

  // Partitions and the conveyor sit among the furniture so boxes sort around them.
  const piece = (gx: number, gy: number, draw: (pg: Graphics) => void) => {
    const pg = new Graphics();
    draw(pg);
    pg.label = 'prop';
    pg.zIndex = (gx + gy) * 100 - 40;
    s.things.addChild(pg);
  };
  for (let r = 0; r < rows; r++) {
    const gy0 = rowY(r);
    const d = grid.rowDepths[r];
    // between rooms of a row, with a doorway in the middle
    for (let c = 1; c < cols; c++) {
      const gx = c * (ZW + COL_GAP) - COL_GAP / 2 - 0.09;
      for (let j = 0; j < d; j++) {
        if (j === Math.floor(d / 2)) continue;
        piece(gx, gy0 + j + 0.5, (pg) => block(pg, gx, gy0 + j, 0.18, 1, 13, PARTITION));
      }
    }
    // along the corridor, with a doorway per room
    if (r < rows - 1) {
      for (const gy of [gy0 + d + 0.05, gy0 + d + grid.rowGap - 0.23]) {
        for (let i = 0; i < Math.ceil(width); i++) {
          const inRoom = i % (ZW + COL_GAP);
          if (inRoom >= 3 && inRoom < 5) continue; // doorway
          piece(i + 0.5, gy, (pg) => block(pg, i, gy, Math.min(1, width - i), 0.18, 13, PARTITION));
        }
      }
      if (r > 0) continue; // one conveyor, between the first two rows
      // The conveyor is a U on its side: lane A carries boxes along the first
      // row, turns at the far end, and lane B brings them back along the second.
      const a = gy0 + d + 0.95;
      const b = gy0 + d + grid.rowGap - 0.95;
      const end = width - 0.7;
      const atrium = grid.rowGap === ATRIUM_GAP;
      const from = atrium ? 0.3 : -1; // where the lanes begin
      s.belt = { a, b, end, entry: atrium ? 0.7 : -0.6 };
      const tile = (gx: number, gy: number, w: number, axis: 'x' | 'y', dir: 1 | -1) => {
        const [bw, bd] = axis === 'x' ? [w, 0.8] : [0.8, w];
        const [bx, by] = axis === 'x' ? [gx, gy - 0.4] : [gx - 0.4, gy];
        piece(bx + bw / 2, by + bd / 2, (pg) => block(pg, bx, by, bw, bd, BELT_UP, 0x596379));
        // the belt's moving slats, redrawn every frame
        const marks = new Graphics();
        marks.label = 'prop';
        marks.zIndex = (bx + bw / 2 + by + bd / 2) * 100 - 39;
        s.things.addChild(marks);
        s.belts.push({ g: marks, gx, gy, w, axis, dir });
      };
      for (let i = from; i < end - 0.4; i++) {
        const w = Math.min(1, end - 0.4 - i);
        tile(i, a, w, 'x', 1);
        tile(i, b, w, 'x', -1);
      }
      // the turn: one stretch across, from lane A to lane B
      for (let y = a - 0.4; y < b + 0.4 - 0.01; y += 1) tile(end, y, Math.min(1, b + 0.4 - y), 'y', 1);
      if (atrium) {
        // Upstairs the belt closes into a ring around a garden.
        for (let y = a + 0.4; y < b - 0.4 - 0.01; y += 1) tile(0.7, y, Math.min(1, b - 0.4 - y), 'y', -1);
        const gx0 = 1.9;
        const gy1 = a + 1.0;
        const gw = end - 1.2 - gx0;
        const gd = b - 1.0 - gy1;
        const lawn = new Graphics();
        lawn.poly(floorPoly(gx0, gy1, gw, gd)).fill(0xcfe6cc);
        lawn.poly(floorPoly(gx0 + 0.25, gy1 + 0.25, gw - 0.5, gd - 0.5)).fill(0xdcefd8);
        // a stone path through the middle
        for (let x = gx0 + 0.8; x < gx0 + gw - 0.8; x += 1.1) lawn.poly(floorPoly(x, gy1 + gd / 2 - 0.3, 0.7, 0.6)).fill(0xeee9df);
        // a pond
        const pond = iso(gx0 + gw / 2, gy1 + gd / 2 - 1.3);
        lawn.ellipse(pond.x, pond.y, 46, 23).fill(0xe9e2d6);
        lawn.ellipse(pond.x, pond.y, 40, 20).fill(0xa9d8f2);
        lawn.ellipse(pond.x - 8, pond.y - 4, 14, 6).fill({ color: 0xffffff, alpha: 0.5 });
        s.ground.addChild(lawn);
        const deco = (gx: number, gy: number, draw: (pg: Graphics) => void) => {
          const pg = new Graphics();
          draw(pg);
          pg.label = 'prop';
          pg.zIndex = (gx + gy) * 100;
          s.things.addChild(pg);
        };
        for (let x = gx0 + 0.5; x < gx0 + gw - 0.6; x += 3.4) {
          deco(x + 0.25, gy1 + 0.55, (pg) => tree(pg, x, gy1 + 0.3));
          deco(x + 1.95, gy1 + gd - 0.55, (pg) => tree(pg, x + 1.7, gy1 + gd - 0.8));
        }
        deco(gx0 + gw / 2 - 3.2, gy1 + gd / 2 + 0.75, (pg) => bench(pg, gx0 + gw / 2 - 4.0, gy1 + gd / 2 + 0.5, 'x', 1.6));
        deco(gx0 + gw / 2 + 3.2, gy1 + gd / 2 + 0.75, (pg) => bench(pg, gx0 + gw / 2 + 2.4, gy1 + gd / 2 + 0.5, 'x', 1.6));
        deco(gx0 + gw / 2 - 0.2, gy1 + gd - 0.5, (pg) => hedge(pg, gx0 + gw / 2 - 1.6, gy1 + gd - 0.65, 'x', 3.2));
        s.plate('중앙 정원', gx0 + gw / 2, gy1 + gd / 2 + 0.6);
      }
      // where boxes come in (lane A) and the arrows that show the way round
      const arrow = (gx: number, gy: number, dx: number, dy: number) => {
        piece(gx + 0.6, gy + 0.6, (pg) => {
          const tip = iso(gx + dx * 0.28, gy + dy * 0.28);
          const l = iso(gx - dx * 0.2 - dy * 0.22, gy - dy * 0.2 + dx * 0.22);
          const rgt = iso(gx - dx * 0.2 + dy * 0.22, gy - dy * 0.2 - dx * 0.22);
          pg.poly([tip.x, tip.y - BELT_UP, l.x, l.y - BELT_UP, rgt.x, rgt.y - BELT_UP]).fill({ color: 0xffd166, alpha: 0.95 });
        });
      };
      for (let x = 2; x < end - 1; x += 4.25) {
        arrow(x, a, 1, 0);
        arrow(x, b, -1, 0);
      }
    }
  }
}

/** One stretch of conveyor with its moving slats. */
export function beltTile(s: Scene, gx: number, gy: number, w: number, axis: 'x' | 'y', dir: 1 | -1) {
  const [bw, bd] = axis === 'x' ? [w, 0.8] : [0.8, w];
  const [bx, by] = axis === 'x' ? [gx, gy - 0.4] : [gx - 0.4, gy];
  const body = new Graphics();
  block(body, bx, by, bw, bd, BELT_UP, 0x6b7590);
  body.label = 'prop';
  body.zIndex = (bx + bw / 2 + by + bd / 2) * 100 - 40;
  const marks = new Graphics();
  marks.label = 'prop';
  marks.zIndex = body.zIndex + 1;
  s.things.addChild(body, marks);
  s.belts.push({ g: marks, gx, gy, w, axis, dir });
}
