// The basement, where teammates on holiday rest.

import { Graphics } from 'pixi.js';
import { lookOf } from '../avatars';
import type { Scene } from '../scene';
import { ZW, ROW_GAP, grid, PAD, WALL_H, iso } from './grid';
import { shortName } from './palette';
import { floorPoly, tree, hedge, purifier, bench, bed, lamp } from './props';
import { drawBuilding } from './building';

/** The lodge in the basement: teammates on holiday sleep here. */
export function drawLodge(s: Scene) {
  s.ground.removeChildren().forEach((c) => c.destroy({ children: true }));
  s.signs.removeChildren().forEach((c) => c.destroy({ children: true }));
  s.things.children.filter((c) => c.label === 'prop').forEach((c) => c.destroy({ children: true }));
  s.truck = null;
  s.people = [];
  s.belts = [];
  s.belt = null;
  s.lamps = [];
  s.lampLayer.clear();
  const here = s.away.filter((a) => a.active);
  const beds = Math.max(4, here.length);
  const width = Math.max(ZW, 1.2 + beds * 1.7);
  const depth = 6;
  grid.rowDepths = [depth];
  grid.rowGap = ROW_GAP;
  drawBuilding(s, width, depth, 1, 1, -1, '숙소', 2);
  const floor = new Graphics();
  floor.poly(floorPoly(0, 0, width, depth)).fill(0xeadfce);
  for (let i = 1; i < width; i++) {
    const a = iso(i, 0);
    const b = iso(i, depth);
    floor.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1, color: 0x8a6a4a, alpha: 0.12 });
  }
  floor.poly(floorPoly(1.2, 3.3, width - 2.4, 1.8)).fill(0xd9c7b0);
  floor.poly(floorPoly(1.4, 3.5, width - 2.8, 1.4)).fill(0xe6d8c5);
  s.ground.addChild(floor);
  const prop = (gx: number, gy: number, draw: (g: Graphics) => void) => {
    const g = new Graphics();
    draw(g);
    g.label = 'prop';
    g.zIndex = (gx + gy) * 100;
    s.things.addChild(g);
  };
  for (let i = 0; i < beds; i++) {
    const who = here[i];
    const gx = 0.7 + i * 1.7;
    prop(gx + 0.5, 1.2, (g) => bed(g, gx, 0.5, who ? lookOf(who.id, s.looks).body : null));
    if (who) {
      const [, mo, dd] = who.to.split('-').map(Number);
      s.tag(`${shortName(who.name)} · ~${mo}/${dd}`, gx + 0.5, 0.9, 56, who.me);
      s.tag('z Z', gx + 0.85, 0.7, 76, false);
    }
  }
  prop(0.4, 3.0, (g) => tree(g, 0.2, 2.8));
  prop(width - 0.5, 3.0, (g) => lamp(g, width - 0.6, 2.9));
  prop(width - 0.5, depth - 0.5, (g) => purifier(g, width - 0.75, depth - 0.75));
  prop(width / 2, depth - 0.3, (g) => hedge(g, width / 2 - 1.4, depth - 0.5, 'x', 2.8));
  prop(1.6, depth - 0.75, (g) => bench(g, 0.8, depth - 1.0, 'x', 1.6));
  const coming = s.away.filter((a) => !a.active);
  s.plate(here.length ? `숙소 · 쉬는 중 ${here.length}명` : '숙소 · 비어 있음', width / 2, 0.15);
  coming.slice(0, 3).forEach((a, i) => {
    const [, mo, dd] = a.from.split('-').map(Number);
    s.tag(`${shortName(a.name)} ${mo}/${dd}부터 휴가`, width / 2, depth - 1.6 + i * 0.6, 0, a.me);
  });
  const corners = [iso(-PAD, -PAD), iso(width + PAD, -PAD), iso(width + PAD, depth + PAD), iso(-PAD, depth + PAD)];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  s.bounds = { x: Math.min(...xs), y: Math.min(...ys) - WALL_H - 46, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) + WALL_H + 60 };
  s.refit();
}
