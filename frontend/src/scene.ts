// The centre, drawn with PixiJS in an isometric view. Everything here is
// placeholder art made of flat polygons; real artwork replaces the draw*
// functions later without touching the layout.

// Lets PixiJS run where the page may not build code from strings (a strict
// content security policy); it has no effect elsewhere.
import 'pixi.js/unsafe-eval';
import { Application, Container, Graphics, Polygon, Text } from 'pixi.js';
import type { Box, Change, Snapshot, SpaceView, ZoneKind, ZoneView } from './types';

// ---- isometric grid ---------------------------------------------------------

const TW = 56; // tile width on screen
const TH = 28; // tile height on screen
const ZW = 8; // zone size in tiles
const ZH = 7;
const GAP = 1.6; // tiles between zones
const COLS = 3; // zones per row

const iso = (gx: number, gy: number) => ({ x: ((gx - gy) * TW) / 2, y: ((gx + gy) * TH) / 2 });

/** Zones snake through the room: left to right, then back. */
function zoneOrigin(index: number) {
  const row = Math.floor(index / COLS);
  const col = row % 2 === 0 ? index % COLS : COLS - 1 - (index % COLS);
  return { gx: col * (ZW + GAP), gy: row * (ZH + GAP) };
}

// ---- colours ----------------------------------------------------------------

const INK = 0x2b2a27;
const QUIET = 0x7a766c;
const FLOOR: Record<ZoneKind, number> = {
  wait: 0xe4e0d6,
  work: 0xdbe6ee,
  desk: 0xdcebdd,
  done: 0xf0e9d2,
  returned: 0xeadcd8,
  unsorted: 0xe6dcef,
};
const EDGE: Record<ZoneKind, number> = {
  wait: 0xbdb7a8,
  work: 0x8fa9bd,
  desk: 0x8fb393,
  done: 0xc9b98a,
  returned: 0xc4a39b,
  unsorted: 0xa893c0,
};
const TAGS: Record<string, number> = {
  orange: 0xe8853a,
  purple: 0x8b63c9,
  blue: 0x3d85c6,
  green: 0x3f9c63,
  teal: 0x2f9a9a,
  pink: 0xd9629a,
  yellow: 0xd9b02f,
  navy: 0x34477f,
  gray: 0x8a8a84,
};
const CARDBOARD = 0xc9a56c;
const OLD = 0xcf4f3a;
const UNSCHEDULED = 0xd8d2c4;
const AVATARS = [0x4f6fd6, 0xd6694f, 0x3f9c63, 0xb05fc4, 0xc79a2a, 0x2f9a9a];

function mix(a: number, b: number, t: number) {
  const ch = (s: number) => {
    const x = (a >> s) & 255;
    const y = (b >> s) & 255;
    return Math.round(x + (y - x) * t) << s;
  };
  return ch(16) | ch(8) | ch(0);
}
const shade = (c: number, t: number) => mix(c, 0x000000, t);
const tint = (c: number, t: number) => mix(c, 0xffffff, t);

/** A box starts turning red at half its limit and is fully red at the limit. */
function boxColour(b: Box) {
  if (b.note) return UNSCHEDULED;
  const t = Math.min(1, Math.max(0, (b.staleRatio - 0.5) / 0.5));
  return mix(CARDBOARD, OLD, t);
}

// ---- drawing ----------------------------------------------------------------

const BOX = 0.34; // half-size of a box in tiles
const BOX_H = 20; // box height on screen

function label(text: string, size: number, colour: number, weight: '400' | '600' = '400') {
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

/** An isometric cube whose base centre sits at (0, 0). */
function drawBox(g: Graphics, b: Box, hover = false) {
  const c = boxColour(b);
  const a = iso(BOX, -BOX); // right corner
  const d = iso(BOX, BOX); // front corner
  const l = iso(-BOX, BOX); // left corner
  const k = iso(-BOX, -BOX); // back corner
  const up = -BOX_H;
  g.clear();
  // left and right faces
  g.poly([l.x, l.y, d.x, d.y, d.x, d.y + up, l.x, l.y + up]).fill(shade(c, 0.16));
  g.poly([d.x, d.y, a.x, a.y, a.x, a.y + up, d.x, d.y + up]).fill(shade(c, 0.3));
  // top face
  g.poly([k.x, k.y + up, a.x, a.y + up, d.x, d.y + up, l.x, l.y + up]).fill(tint(c, hover ? 0.35 : 0.18));
  // packing tape across the top
  const m1 = iso(0, -BOX);
  const m2 = iso(0, BOX);
  g.moveTo(m1.x, m1.y + up).lineTo(m2.x, m2.y + up).stroke({ width: 3, color: shade(c, 0.12), alpha: 0.7 });
  // waybill tag on the left face, in the request type's colour
  const tag = TAGS[b.tag] ?? TAGS.gray;
  const t0 = { x: l.x + (d.x - l.x) * 0.18, y: l.y + (d.y - l.y) * 0.18 };
  const t1 = { x: l.x + (d.x - l.x) * 0.82, y: l.y + (d.y - l.y) * 0.82 };
  g.poly([t0.x, t0.y - 5, t1.x, t1.y - 5, t1.x, t1.y - 14, t0.x, t0.y - 14]).fill(0xffffff);
  g.poly([t0.x, t0.y - 5, t1.x, t1.y - 5, t1.x, t1.y - 9, t0.x, t0.y - 9]).fill(tag);
  // outline: heavier for my boxes and for old ones
  const line = b.stale ? shade(OLD, 0.35) : b.mine ? INK : shade(c, 0.45);
  g.poly([l.x, l.y, d.x, d.y, a.x, a.y, a.x, a.y + up, k.x, k.y + up, l.x, l.y + up])
    .stroke({ width: b.mine || b.stale || hover ? 2 : 1, color: line, alpha: 0.9 });
  // urgent flag
  if (/high|highest|critical|긴급|높음/i.test(b.priority)) {
    g.poly([0, up - 4, 0, up - 18, 9, up - 13, 1.5, up - 9]).fill(0xd43c2c);
    g.moveTo(0, up - 2).lineTo(0, up - 18).stroke({ width: 1.5, color: INK });
  }
}

function drawFloor(g: Graphics, kind: ZoneKind) {
  const p = [iso(0, 0), iso(ZW, 0), iso(ZW, ZH), iso(0, ZH)];
  const flat = p.flatMap((q) => [q.x, q.y]);
  // a thin slab under the floor gives the room some depth
  g.poly([p[3].x, p[3].y, p[2].x, p[2].y, p[2].x, p[2].y + 8, p[3].x, p[3].y + 8]).fill(shade(FLOOR[kind], 0.12));
  g.poly([p[2].x, p[2].y, p[1].x, p[1].y, p[1].x, p[1].y + 8, p[2].x, p[2].y + 8]).fill(shade(FLOOR[kind], 0.2));
  g.poly(flat).fill(FLOOR[kind]).stroke({ width: 1.5, color: EDGE[kind] });
  // floor tiles
  for (let i = 1; i < ZW; i++) {
    const s = iso(i, 0);
    const e = iso(i, ZH);
    g.moveTo(s.x, s.y).lineTo(e.x, e.y).stroke({ width: 1, color: EDGE[kind], alpha: 0.18 });
  }
  for (let j = 1; j < ZH; j++) {
    const s = iso(0, j);
    const e = iso(ZW, j);
    g.moveTo(s.x, s.y).lineTo(e.x, e.y).stroke({ width: 1, color: EDGE[kind], alpha: 0.18 });
  }
}

function drawDesk(g: Graphics, shelf: boolean) {
  const w = 0.55;
  const h = 0.32;
  const top = -12;
  const c = shelf ? 0x9a958a : 0xb89b74;
  const p = [iso(-w, -h), iso(w, -h), iso(w, h), iso(-w, h)];
  g.poly([p[3].x, p[3].y, p[2].x, p[2].y, p[2].x, p[2].y + top, p[3].x, p[3].y + top]).fill(shade(c, 0.2));
  g.poly([p[2].x, p[2].y, p[1].x, p[1].y, p[1].x, p[1].y + top, p[2].x, p[2].y + top]).fill(shade(c, 0.34));
  g.poly(p.flatMap((q) => [q.x, q.y + top])).fill(tint(c, 0.15)).stroke({ width: 1, color: shade(c, 0.45) });
}

function drawAvatar(g: Graphics, colour: number, me: boolean) {
  g.ellipse(0, 0, 9, 4.5).fill({ color: 0x000000, alpha: 0.15 });
  g.roundRect(-6, -20, 12, 20, 5).fill(colour).stroke({ width: 1, color: shade(colour, 0.4) });
  g.circle(0, -27, 7).fill(0xf2d3b4).stroke({ width: 1, color: shade(0xf2d3b4, 0.35) });
  if (me) g.circle(0, -27, 10.5).stroke({ width: 2, color: INK });
}

// ---- layout -----------------------------------------------------------------

interface Slot {
  x: number;
  y: number;
  depth: number;
}

/** Where each box of a zone stands, relative to the zone's origin. */
function slots(zone: ZoneView, boxes: Box[], lanes: string[]): Map<string, Slot> {
  const out = new Map<string, Slot>();
  const put = (key: string, gx: number, gy: number, level: number) => {
    const p = iso(gx, gy);
    out.set(key, { x: p.x, y: p.y - level * BOX_H, depth: gx + gy + level * 0.01 });
  };
  if (zone.kind === 'desk') {
    // One lane per assignee; the last lane is the shared shelf for unassigned boxes.
    const width = Math.min(1.5, (ZW - 1) / Math.max(1, lanes.length));
    const perLane = new Map<string, number>();
    for (const b of boxes) {
      const lane = Math.max(0, lanes.indexOf(b.assigneeId));
      const n = perLane.get(b.assigneeId) ?? 0;
      perLane.set(b.assigneeId, n + 1);
      put(b.key, 0.9 + lane * width, 2.9 + (n % 3) * 1.0, Math.floor(n / 3));
    }
    return out;
  }
  const cols = 5;
  const rows = 4;
  boxes.forEach((b, i) => {
    const at = i % (cols * rows);
    put(b.key, 1.3 + (at % cols) * 1.3, 1.2 + Math.floor(at / cols) * 1.1, Math.floor(i / (cols * rows)));
  });
  return out;
}

// ---- the scene --------------------------------------------------------------

interface Sprite {
  root: Container;
  g: Graphics;
  box: Box;
  tx: number; // target position
  ty: number;
  depth: number;
  leaving: boolean;
}

export interface SceneHooks {
  onSelect(box: Box | null): void;
  onHover(box: Box | null, x: number, y: number): void;
}

export class Scene {
  private app = new Application();
  private world = new Container();
  private floors = new Container();
  private things = new Container(); // desks, boxes and avatars, depth-sorted
  private labels = new Container();
  private sprites = new Map<string, Sprite>();
  private space = 0;
  private snap: Snapshot | null = null;
  private bounds = { x: 0, y: 0, w: 1, h: 1 };
  private selected = '';

  constructor(
    private host: HTMLElement,
    private hooks: SceneHooks,
  ) {}

  async init() {
    await this.app.init({
      resizeTo: this.host,
      background: 0xf4f1ea,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
    });
    this.host.appendChild(this.app.canvas);
    this.world.addChild(this.floors, this.things, this.labels);
    this.things.sortableChildren = true;
    this.app.stage.addChild(this.world);
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on('pointertap', (e) => {
      if (e.target === this.app.stage) this.select('');
    });
    this.app.ticker.add((t) => this.animate(t.deltaMS));
    this.app.renderer.on('resize', () => this.fit());
  }

  setSpace(index: number) {
    this.space = index;
    this.sprites.forEach((s) => s.root.destroy({ children: true }));
    this.sprites.clear();
    if (this.snap) this.update(this.snap, []);
  }

  select(key: string) {
    this.selected = key;
    this.sprites.forEach((s) => drawBox(s.g, s.box, s.box.key === key));
    this.hooks.onSelect(this.sprites.get(key)?.box ?? null);
  }

  /** Redraws the room for a new snapshot; changes drive the animations. */
  update(snap: Snapshot, changes: Change[]) {
    this.snap = snap;
    const space: SpaceView | undefined = snap.spaces[this.space] ?? snap.spaces[0];
    if (!space) return;
    const boxes = snap.boxes.filter((b) => b.space === space.id);
    const members = snap.members.filter((m) => m.space === space.id);
    const added = new Set(changes.filter((c) => c.kind === 'added').map((c) => c.key));

    this.floors.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.labels.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.things.children.filter((c) => c.label === 'prop').forEach((c) => c.destroy({ children: true }));

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const alive = new Set<string>();

    space.zones.forEach((zone, zi) => {
      const o = zoneOrigin(zi);
      const base = iso(o.gx, o.gy);
      const floor = new Graphics();
      drawFloor(floor, zone.kind);
      floor.position.set(base.x, base.y);
      this.floors.addChild(floor);
      for (const c of [iso(0, 0), iso(ZW, 0), iso(ZW, ZH), iso(0, ZH)]) {
        minX = Math.min(minX, base.x + c.x);
        maxX = Math.max(maxX, base.x + c.x);
        minY = Math.min(minY, base.y + c.y - 70);
        maxY = Math.max(maxY, base.y + c.y + 14);
      }

      // name and load, written on the strip of floor kept free along the front edge
      const at = iso(o.gx + ZW / 2, o.gy + ZH - 0.95);
      const name = label(zone.name, 15, INK, '600');
      name.anchor.set(0.5, 0.5);
      name.position.set(at.x, at.y);
      const load = zone.staleCount > 0 ? `${zone.count}건 · 묵은 상자 ${zone.staleCount}` : `${zone.count}건`;
      const count = label(load, 12, zone.staleCount > 0 ? shade(OLD, 0.2) : QUIET, zone.staleCount > 0 ? '600' : '400');
      count.anchor.set(0.5, 0.5);
      count.position.set(at.x, at.y + 18);
      this.labels.addChild(name, count);

      const inZone = boxes.filter((b) => b.zone === zone.id);
      // Desk lanes: me first, then teammates by name, then the shared shelf.
      const lanes: string[] = [];
      if (zone.kind === 'desk') {
        const here = members.filter((m) => m.zone === zone.id || inZone.some((b) => b.assigneeId === m.id));
        here.sort((a, b) => Number(b.me) - Number(a.me) || a.name.localeCompare(b.name, 'ko'));
        here.forEach((m) => lanes.push(m.id));
        lanes.push(''); // shelf
        const width = Math.min(1.5, (ZW - 1) / lanes.length);
        lanes.forEach((id, li) => {
          const p = iso(o.gx + 0.9 + li * width, o.gy + 1.5);
          const desk = new Graphics();
          drawDesk(desk, id === '');
          desk.label = 'prop';
          desk.position.set(p.x, p.y);
          desk.zIndex = (o.gx + 0.9 + li * width + o.gy + 1.5) * 100;
          this.things.addChild(desk);
          const who = id === '' ? '공용 선반' : (here.find((m) => m.id === id)?.name ?? '');
          const tagText = label(who, 11, id === '' ? QUIET : INK, id === '' ? '400' : '600');
          tagText.anchor.set(0.5, 1);
          tagText.position.set(p.x, p.y - (id === '' ? 16 : 60));
          this.labels.addChild(tagText);
        });
      }

      const where = slots(zone, inZone, lanes);
      for (const b of inZone) {
        alive.add(b.key);
        const s = where.get(b.key)!;
        const x = base.x + s.x;
        const y = base.y + s.y;
        let sp = this.sprites.get(b.key);
        if (!sp) {
          sp = this.spawn(b);
          // A new arrival drops in from above; everything else simply appears.
          sp.root.position.set(x, added.has(b.key) ? y - 90 : y);
          sp.root.alpha = added.has(b.key) ? 0 : 1;
        }
        sp.box = b;
        sp.tx = x;
        sp.ty = y;
        sp.depth = (o.gx + o.gy) * 100 + s.depth * 100;
        sp.leaving = false;
        drawBox(sp.g, b, b.key === this.selected);
      }

      // avatars: at their desk in a desk zone, otherwise along the zone's right edge
      members
        .filter((m) => m.zone === zone.id)
        .forEach((m, mi) => {
          const lane = lanes.indexOf(m.id);
          const width = Math.min(1.5, (ZW - 1) / Math.max(1, lanes.length));
          const gx = zone.kind === 'desk' && lane >= 0 ? o.gx + 0.9 + lane * width : o.gx + ZW - 0.7;
          const gy = zone.kind === 'desk' && lane >= 0 ? o.gy + 0.7 : o.gy + 1.4 + mi * 1.0;
          const p = iso(gx, gy);
          const av = new Graphics();
          drawAvatar(av, AVATARS[snap.members.indexOf(m) % AVATARS.length], m.me);
          av.label = 'prop';
          av.position.set(p.x, p.y);
          av.zIndex = (gx + gy) * 100 + 1;
          this.things.addChild(av);
          if (zone.kind !== 'desk') {
            const n = label(m.name, 11, INK, '600');
            n.anchor.set(0.5, 1);
            n.position.set(p.x, p.y - 40);
            this.labels.addChild(n);
          }
        });
    });

    // Boxes that left the room fade out.
    this.sprites.forEach((s, key) => {
      if (!alive.has(key)) s.leaving = true;
    });
    if (this.selected && !alive.has(this.selected)) this.select('');
    else if (this.selected) this.hooks.onSelect(this.sprites.get(this.selected)!.box);

    this.bounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    this.fit();
  }

  private spawn(b: Box): Sprite {
    const root = new Container();
    const g = new Graphics();
    root.addChild(g);
    root.eventMode = 'static';
    root.cursor = 'pointer';
    const a = iso(BOX, -BOX);
    const d = iso(BOX, BOX);
    const l = iso(-BOX, BOX);
    const k = iso(-BOX, -BOX);
    root.hitArea = new Polygon([l.x, l.y, d.x, d.y, a.x, a.y, a.x, a.y - BOX_H, k.x, k.y - BOX_H, l.x, l.y - BOX_H]);
    const sp: Sprite = { root, g, box: b, tx: 0, ty: 0, depth: 0, leaving: false };
    root.on('pointertap', (e) => {
      e.stopPropagation();
      this.select(sp.box.key);
    });
    root.on('pointerover', (e) => {
      drawBox(sp.g, sp.box, true);
      this.hooks.onHover(sp.box, e.clientX, e.clientY);
    });
    root.on('pointermove', (e) => this.hooks.onHover(sp.box, e.clientX, e.clientY));
    root.on('pointerout', () => {
      drawBox(sp.g, sp.box, sp.box.key === this.selected);
      this.hooks.onHover(null, 0, 0);
    });
    this.things.addChild(root);
    this.sprites.set(b.key, sp);
    return sp;
  }

  /** Scales and centres the room in the canvas. */
  private fit() {
    const { width, height } = this.app.screen;
    const s = Math.min((width - 40) / this.bounds.w, (height - 30) / this.bounds.h, 1.6);
    this.world.scale.set(s);
    this.world.position.set((width - this.bounds.w * s) / 2 - this.bounds.x * s, (height - this.bounds.h * s) / 2 - this.bounds.y * s);
    this.app.stage.hitArea = this.app.screen;
  }

  private animate(ms: number) {
    const k = 1 - Math.pow(0.002, ms / 1000); // frame-rate independent easing
    this.sprites.forEach((s, key) => {
      const r = s.root;
      if (s.leaving) {
        r.alpha -= ms / 400;
        r.y -= ms / 20;
        if (r.alpha <= 0) {
          r.destroy({ children: true });
          this.sprites.delete(key);
        }
        return;
      }
      r.x += (s.tx - r.x) * k;
      r.y += (s.ty - r.y) * k;
      if (r.alpha < 1) r.alpha = Math.min(1, r.alpha + ms / 300);
      r.zIndex = s.depth;
    });
  }
}
