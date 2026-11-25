// The centre, drawn with PixiJS in an isometric view: one building whose
// rooms are the zones. Everything is built from flat-shaded blocks (a
// low-poly look) drawn in code, so there are no image files to load.

// Lets PixiJS run where the page may not build code from strings (a strict
// content security policy); it has no effect elsewhere.
import 'pixi.js/unsafe-eval';
import { Application, Container, Graphics, Polygon, Text } from 'pixi.js';
import type { Box, Change, Member, Snapshot, SpaceView, ZoneKind, ZoneView } from './types';

// ---- isometric grid ---------------------------------------------------------

const TW = 64; // tile width on screen
const TH = 32; // tile height on screen
const ZW = 8; // room size in tiles
const ZH = 7;
const COL_GAP = 0.5; // partition between rooms of a row
const ROW_GAP = 2.4; // corridor between rows (holds the conveyor)
const COLS = 3; // rooms per row
const PAD = 0.7; // floor slab around the rooms
const WALL_H = 58; // outer wall height on screen
const STOREY = 34; // height of a floor below the one shown, on screen

const iso = (gx: number, gy: number) => ({ x: ((gx - gy) * TW) / 2, y: ((gx + gy) * TH) / 2 });

/** Rooms snake through the building: left to right, then back. */
function roomOrigin(index: number) {
  const row = Math.floor(index / COLS);
  const col = row % 2 === 0 ? index % COLS : COLS - 1 - (index % COLS);
  return { gx: col * (ZW + COL_GAP), gy: row * (ZH + ROW_GAP), col, row };
}

// ---- colours ----------------------------------------------------------------

const INK = 0x1f2a44;
const QUIET = 0x667085;
const ACCENT = 0x3b5bdb;
const SLAB = 0xdde3ec;
const WALL = 0xf6f8fb;
const PARTITION = 0xc8d0dc;
const FLOOR: Record<ZoneKind, number> = {
  wait: 0xf2e6cc,
  work: 0xd6e7f7,
  desk: 0xd3eedd,
  done: 0xfbe2b4,
  returned: 0xf5d7d3,
  unsorted: 0xe4dcf5,
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
const CARDBOARD = 0xd9a866;
/** Box colour by how old it is: fresh, nearing the limit, then three steps past it. */
export const AGE = [CARDBOARD, 0xe9a23b, 0xe56b3c, 0xc7352f, 0x8a1c2c];
const UNSCHEDULED = 0xcfd5de;
const AVATARS = [0x4f6fd6, 0xe0704f, 0x3f9c63, 0xa85fc4, 0xc79a2a, 0x2f9a9a];
const SKIN = 0xf3d2b3;

function mix(a: number, b: number, t: number) {
  const ch = (s: number) => {
    const x = (a >> s) & 255;
    const y = (b >> s) & 255;
    return Math.round(x + (y - x) * t) << s;
  };
  return ch(16) | ch(8) | ch(0);
}
const shade = (c: number, t: number) => mix(c, 0x1b2233, t);
const tint = (c: number, t: number) => mix(c, 0xffffff, t);

/** 0 fresh · 1 past half the limit · 2 past the limit · 3 past 3x · 4 past 10x. */
export function ageStep(b: Box) {
  if (b.note || !b.staleRatio) return 0;
  const r = b.staleRatio;
  return r < 0.5 ? 0 : r < 1 ? 1 : r < 3 ? 2 : r < 10 ? 3 : 4;
}

/** "5시간", "3일", "2달": how long past its starting point a box is. */
function shortAge(ms: number) {
  const h = ms / 3600_000;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}분`;
  if (h < 48) return `${Math.round(h)}시간`;
  const d = h / 24;
  return d < 60 ? `${Math.round(d)}일` : `${Math.round(d / 30)}달`;
}

/** Jira display names may carry a department after the name: keep the name. */
export const shortName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

// ---- drawing blocks ---------------------------------------------------------

function label(text: string, size: number, colour: number, weight: '400' | '600' | '700' = '400') {
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
function block(g: Graphics, gx: number, gy: number, w: number, d: number, h: number, colour: number, base = 0) {
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
function shadow(g: Graphics, gx: number, gy: number, w: number, d: number) {
  const p = [iso(gx + 0.12, gy + 0.12), iso(gx + w + 0.12, gy + 0.12), iso(gx + w + 0.12, gy + d + 0.12), iso(gx + 0.12, gy + d + 0.12)];
  g.poly(p.flatMap((q) => [q.x, q.y])).fill({ color: 0x1b2233, alpha: 0.1 });
}

const BOX = 0.4; // half-size of a box in tiles
const BOX_H = 27; // box height on screen

/** A cardboard box whose base centre sits at (0, 0). */
function drawBox(g: Graphics, b: Box, lit: boolean) {
  const step = ageStep(b);
  const c = b.note ? UNSCHEDULED : AGE[step];
  g.clear();
  shadow(g, -BOX, -BOX, BOX * 2, BOX * 2);
  block(g, -BOX, -BOX, BOX * 2, BOX * 2, BOX_H, lit ? tint(c, 0.18) : c);
  // tape across the top: accent colour marks my boxes
  const m1 = iso(0, -BOX);
  const m2 = iso(0, BOX);
  g.moveTo(m1.x, m1.y - BOX_H)
    .lineTo(m2.x, m2.y - BOX_H)
    .stroke({ width: b.mine ? 5 : 3, color: b.mine ? ACCENT : shade(c, 0.16), alpha: b.mine ? 1 : 0.6 });
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

function floorPoly(gx: number, gy: number, w: number, d: number) {
  return [iso(gx, gy), iso(gx + w, gy), iso(gx + w, gy + d), iso(gx, gy + d)].flatMap((q) => [q.x, q.y]);
}

/** A potted plant, for corners. */
function plant(g: Graphics, gx: number, gy: number) {
  shadow(g, gx, gy, 0.4, 0.4);
  block(g, gx, gy, 0.4, 0.4, 9, 0xb7795a);
  const c = iso(gx + 0.2, gy + 0.2);
  g.poly([c.x - 13, c.y - 9, c.x, c.y - 2, c.x, c.y - 44]).fill(0x4fa86b);
  g.poly([c.x + 13, c.y - 9, c.x, c.y - 2, c.x, c.y - 44]).fill(0x3b8a55);
}

/** A desk with a monitor, seen from its side; the shelf variant is a low rack. */
function desk(g: Graphics, gx: number, gy: number, kind: 'desk' | 'shelf' | 'mine') {
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
function person(g: Graphics, colour: number, me: boolean) {
  g.ellipse(0, 1, 11, 5.5).fill({ color: 0x1b2233, alpha: 0.14 });
  block(g, -0.17, -0.17, 0.34, 0.34, 20, colour);
  block(g, -0.14, -0.14, 0.28, 0.28, 12, SKIN, 20);
  block(g, -0.15, -0.15, 0.3, 0.3, 4, shade(colour, 0.55), 32);
  if (me) g.poly([0, -52, 6, -46, 0, -40, -6, -46]).fill(ACCENT); // marker above my head
}

/** A delivery truck parked outside the dock. */
function truck(g: Graphics, gx: number, gy: number) {
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
function furnish(g: Graphics, kind: ZoneKind, gx: number, gy: number) {
  switch (kind) {
    case 'wait': // reception counter
      shadow(g, gx + 2.6, gy + 0.5, 2.8, 0.6);
      block(g, gx + 2.6, gy + 0.5, 2.8, 0.6, 15, 0xc9a77a);
      block(g, gx + 2.6, gy + 0.5, 2.8, 0.6, 3, 0xf3ead9, 15);
      plant(g, gx + 0.4, gy + 0.4);
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

// ---- layout -----------------------------------------------------------------

interface Slot {
  gx: number; // grid position relative to the room
  gy: number;
  level: number;
}

const LANE_TOP = 1.2; // first row of a desk room
const LANE_LEN = 5; // boxes side by side before they stack
const lanePitch = (lanes: number) => Math.min(1.4, (ZH - LANE_TOP - 0.45) / Math.max(1, lanes - 1 || 1));

/** Where each box of a room stands, relative to the room's origin. */
function slots(zone: ZoneView, boxes: Box[], lanes: string[]): Map<string, Slot> {
  const out = new Map<string, Slot>();
  if (zone.kind === 'desk') {
    // One row per assignee: the desk on the left, that person's boxes lined up
    // beside it. The last row is the shared shelf for unassigned boxes.
    const pitch = lanePitch(lanes.length);
    const perLane = new Map<string, number>();
    for (const b of boxes) {
      const lane = Math.max(0, lanes.indexOf(b.assigneeId));
      const n = perLane.get(b.assigneeId) ?? 0;
      perLane.set(b.assigneeId, n + 1);
      out.set(b.key, { gx: 2.35 + (n % LANE_LEN) * 1.12, gy: LANE_TOP + lane * pitch, level: Math.floor(n / LANE_LEN) });
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

// ---- the scene --------------------------------------------------------------

interface Sprite {
  root: Container;
  body: Container; // lifts when hovered or selected
  g: Graphics;
  num: Text;
  badge: Container | null;
  box: Box;
  tx: number; // target position
  ty: number;
  depth: number;
  hover: boolean;
  leaving: boolean;
}

export interface SceneHooks {
  onSelect(box: Box | null): void;
  onHover(box: Box | null, x: number, y: number): void;
}

export class Scene {
  private app = new Application();
  private lift = new Container(); // slides when the floor changes
  private world = new Container();
  private ground = new Container(); // slab, walls, room floors
  private things = new Container(); // furniture, boxes and people, depth-sorted
  private signs = new Container(); // room signs and name tags, always on top
  private sprites = new Map<string, Sprite>();
  private space = 0;
  private snap: Snapshot | null = null;
  private bounds = { x: 0, y: 0, w: 1, h: 1 };
  private selected = '';
  private inset = 0; // screen width kept free on the right (the ticket panel)
  private drag: { x: number; y: number; moved: boolean } | null = null;

  constructor(
    private host: HTMLElement,
    private hooks: SceneHooks,
  ) {}

  async init() {
    await this.app.init({
      resizeTo: this.host,
      background: 0xedf0f4,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
    });
    this.host.appendChild(this.app.canvas);
    this.world.addChild(this.ground, this.things, this.signs);
    this.things.sortableChildren = true;
    this.lift.addChild(this.world);
    this.app.stage.addChild(this.lift);
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on('pointertap', (e) => {
      if (e.target === this.app.stage && !this.drag?.moved) this.select('');
      this.drag = null;
    });
    // Drag the empty floor to move around, scroll to zoom, double-click to reset.
    this.app.stage.on('pointerdown', (e) => {
      if (e.target === this.app.stage) this.drag = { x: e.global.x, y: e.global.y, moved: false };
    });
    this.app.stage.on('pointermove', (e) => {
      if (!this.drag || !(e.buttons & 1)) return;
      const dx = e.global.x - this.drag.x;
      const dy = e.global.y - this.drag.y;
      if (!this.drag.moved && Math.hypot(dx, dy) < 4) return;
      this.world.position.set(this.world.x + dx, this.world.y + dy);
      this.drag = { x: e.global.x, y: e.global.y, moved: true };
    });
    this.app.stage.on('pointerupoutside', () => (this.drag = null));
    this.app.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const old = this.world.scale.x;
        const next = Math.min(2.5, Math.max(0.35, old * Math.exp(-e.deltaY * 0.0015)));
        const r = this.app.canvas.getBoundingClientRect();
        const cx = e.clientX - r.left;
        const cy = e.clientY - r.top;
        // keep the point under the cursor where it is
        this.world.position.set(cx - ((cx - this.world.x) * next) / old, cy - ((cy - this.world.y) * next) / old);
        this.world.scale.set(next);
      },
      { passive: false },
    );
    this.app.canvas.addEventListener('dblclick', () => this.fit());
    this.app.ticker.add((t) => this.animate(t.deltaMS));
    this.app.renderer.on('resize', () => this.fit());
  }

  /** Spaces are floors of one building: the first space is the ground floor. */
  setSpace(index: number) {
    if (index !== this.space) {
      // Going up, the new floor comes down into view; going down, it rises.
      this.lift.y = index > this.space ? -70 : 70;
      this.lift.alpha = 0;
    }
    this.space = index;
    this.sprites.forEach((s) => s.root.destroy({ children: true }));
    this.sprites.clear();
    if (this.snap) this.update(this.snap, []);
  }

  /** Keeps the room clear of a panel covering the right side of the window. */
  setInset(px: number) {
    if (px === this.inset) return;
    this.inset = px;
    this.fit();
  }

  select(key: string) {
    this.selected = key;
    this.sprites.forEach((s) => this.paint(s));
    this.hooks.onSelect(this.sprites.get(key)?.box ?? null);
  }

  /** Redraws the building for a new snapshot; changes drive the animations. */
  update(snap: Snapshot, changes: Change[]) {
    this.snap = snap;
    const space: SpaceView | undefined = snap.spaces[this.space] ?? snap.spaces[0];
    if (!space) return;
    const boxes = snap.boxes.filter((b) => b.space === space.id);
    const members = snap.members.filter((m) => m.space === space.id);
    const added = new Set(changes.filter((c) => c.kind === 'added').map((c) => c.key));
    const now = Date.parse(snap.fetchedAt);

    this.ground.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.signs.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.things.children.filter((c) => c.label === 'prop').forEach((c) => c.destroy({ children: true }));

    const rows = Math.ceil(space.zones.length / COLS);
    const cols = Math.min(COLS, space.zones.length);
    const width = cols * ZW + (cols - 1) * COL_GAP;
    const depth = rows * ZH + (rows - 1) * ROW_GAP;
    this.drawBuilding(width, depth, rows, cols, snap.spaces.indexOf(space), space.name, snap.spaces.length);

    const prop = (gx: number, gy: number, draw: (g: Graphics) => void, bias = 0) => {
      const g = new Graphics();
      draw(g);
      g.label = 'prop';
      g.zIndex = (gx + gy) * 100 + bias;
      this.things.addChild(g);
      return g;
    };

    const alive = new Set<string>();
    space.zones.forEach((zone, zi) => {
      const o = roomOrigin(zi);

      const floor = new Graphics();
      floor.poly(floorPoly(o.gx, o.gy, ZW, ZH)).fill(FLOOR[zone.kind]);
      for (let i = 1; i < ZW; i++) {
        const s = iso(o.gx + i, o.gy);
        const e = iso(o.gx + i, o.gy + ZH);
        floor.moveTo(s.x, s.y).lineTo(e.x, e.y).stroke({ width: 1, color: shade(FLOOR[zone.kind], 0.5), alpha: 0.1 });
      }
      for (let j = 1; j < ZH; j++) {
        const s = iso(o.gx, o.gy + j);
        const e = iso(o.gx + ZW, o.gy + j);
        floor.moveTo(s.x, s.y).lineTo(e.x, e.y).stroke({ width: 1, color: shade(FLOOR[zone.kind], 0.5), alpha: 0.1 });
      }
      this.ground.addChild(floor);

      if (zone.kind !== 'desk') prop(o.gx + 3, o.gy + 0.8, (g) => furnish(g, zone.kind, o.gx, o.gy), -50);
      // The truck waits outside the building when the dock is in the front row.
      if (zone.kind === 'done' && o.row === rows - 1 && snap.spaces.indexOf(space) === 0) prop(o.gx + 4, o.gy + ZH + 2, (g) => truck(g, o.gx + 3.2, o.gy + ZH + PAD + 0.5));

      this.sign(zone, o.gx, o.gy);

      const inZone = boxes.filter((b) => b.zone === zone.id);
      // Desk lanes: me first, then teammates by name, then the shared shelf.
      const lanes: string[] = [];
      const here = members.filter((m) => m.zone === zone.id || inZone.some((b) => b.assigneeId === m.id));
      if (zone.kind === 'desk') {
        here.sort((a, b) => Number(b.me) - Number(a.me) || a.name.localeCompare(b.name, 'ko'));
        here.forEach((m) => lanes.push(m.id));
        lanes.push(''); // shelf
        const pitch = lanePitch(lanes.length);
        lanes.forEach((id, li) => {
          const gx = o.gx + 1.3;
          const gy = o.gy + LANE_TOP + li * pitch;
          const who = here.find((m) => m.id === id);
          prop(gx, gy, (g) => desk(g, gx, gy, id === '' ? 'shelf' : who?.me ? 'mine' : 'desk'));
          if (id === '') this.tag('공용 선반', gx, gy, 38, false);
        });
      }

      const where = slots(zone, inZone, lanes);
      for (const b of inZone) {
        alive.add(b.key);
        const s = where.get(b.key)!;
        const p = iso(o.gx + s.gx, o.gy + s.gy);
        const x = p.x;
        const y = p.y - s.level * BOX_H;
        let sp = this.sprites.get(b.key);
        if (!sp) {
          sp = this.spawn(b);
          // A new arrival drops in from above; everything else simply appears.
          sp.root.position.set(x, added.has(b.key) ? y - 110 : y);
          sp.root.alpha = added.has(b.key) ? 0 : 1;
        }
        sp.box = b;
        sp.tx = x;
        sp.ty = y;
        sp.depth = (o.gx + s.gx + o.gy + s.gy) * 100 + s.level;
        sp.leaving = false;
        this.paint(sp, now);
      }

      // people: behind their desk in a desk room, otherwise along the room's right side
      members
        .filter((m) => m.zone === zone.id)
        .forEach((m, mi) => {
          const lane = lanes.indexOf(m.id);
          const atDesk = zone.kind === 'desk' && lane >= 0;
          const gx = atDesk ? o.gx + 0.55 : o.gx + ZW - 0.8;
          const gy = atDesk ? o.gy + LANE_TOP + lane * lanePitch(lanes.length) : o.gy + 2.2 + mi * 1.1;
          const p = iso(gx, gy);
          const g = prop(gx, gy, (pg) => person(pg, AVATARS[snap.members.indexOf(m) % AVATARS.length], m.me), 1);
          g.position.set(p.x, p.y);
          this.tag(m.count ? `${shortName(m.name)} ${m.count}` : shortName(m.name), gx, gy, m.me ? 74 : 60, m.me);
        });
    });

    // Boxes that left the building fade out.
    this.sprites.forEach((s, key) => {
      if (!alive.has(key)) s.leaving = true;
    });
    if (this.selected && !alive.has(this.selected)) this.select('');
    else if (this.selected) this.hooks.onSelect(this.sprites.get(this.selected)!.box);

    const corners = [iso(-PAD, -PAD), iso(width + PAD, -PAD), iso(width + PAD, depth + PAD + 2.4), iso(-PAD, depth + PAD + 2.4)];
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    this.bounds = { x: Math.min(...xs), y: Math.min(...ys) - WALL_H - 46, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) + WALL_H + 60 + snap.spaces.indexOf(space) * STOREY };
    this.fit();
  }

  /** The floor slab, the two back walls, the room partitions and the conveyor. */
  private drawBuilding(width: number, depth: number, rows: number, cols: number, floor: number, name: string, floors: number) {
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
    this.ground.addChild(g);
    if (floors > 1) {
      // which floor this is, on the front corner of the slab
      const t = label(`${floor + 1}F  ${name}`, 13, INK, '700');
      const pill = new Graphics().roundRect(0, 0, t.width + 20, 26, 13).fill(0xffffff).stroke({ width: 1, color: 0xcfd6e2 });
      t.position.set(10, (26 - t.height) / 2);
      const tagBox = new Container();
      tagBox.addChild(pill, t);
      tagBox.position.set(fl.x + 26, fl.y - 4);
      this.signs.addChild(tagBox);
    }

    // Partitions and the conveyor sit among the furniture so boxes sort around them.
    const piece = (gx: number, gy: number, draw: (pg: Graphics) => void) => {
      const pg = new Graphics();
      draw(pg);
      pg.label = 'prop';
      pg.zIndex = (gx + gy) * 100 - 40;
      this.things.addChild(pg);
    };
    for (let r = 0; r < rows; r++) {
      const gy0 = r * (ZH + ROW_GAP);
      // between rooms of a row, with a doorway in the middle
      for (let c = 1; c < cols; c++) {
        const gx = c * (ZW + COL_GAP) - COL_GAP / 2 - 0.09;
        for (let j = 0; j < ZH; j++) {
          if (j === 3) continue;
          piece(gx, gy0 + j + 0.5, (pg) => block(pg, gx, gy0 + j, 0.18, 1, 13, PARTITION));
        }
      }
      // along the corridor, with a doorway per room
      if (r < rows - 1) {
        const mid = gy0 + ZH + ROW_GAP / 2;
        for (const gy of [gy0 + ZH + 0.05, gy0 + ZH + ROW_GAP - 0.23]) {
          for (let i = 0; i < Math.ceil(width); i++) {
            const inRoom = i % (ZW + COL_GAP);
            if (inRoom >= 3 && inRoom < 5) continue; // doorway
            piece(i + 0.5, gy, (pg) => block(pg, i, gy, Math.min(1, width - i), 0.18, 13, PARTITION));
          }
        }
        // conveyor belt down the corridor
        for (let i = 0; i < Math.ceil(width); i++) {
          piece(i + 0.5, mid, (pg) => {
            block(pg, i, mid - 0.4, Math.min(1, width - i), 0.8, 7, 0x596379);
            for (const dx of [0.25, 0.75]) {
              const p = iso(i + dx, mid - 0.4);
              const q = iso(i + dx, mid + 0.4);
              pg.moveTo(p.x, p.y - 7).lineTo(q.x, q.y - 7).stroke({ width: 1.5, color: 0x8a93a6, alpha: 0.8 });
            }
          });
        }
      }
    }
  }

  /** The room's sign: its name, how many boxes it holds and how many are old. */
  private sign(zone: ZoneView, gx: number, gy: number) {
    const p = iso(gx + ZW / 2, gy + 0.15);
    const box = new Container();
    const name = label(zone.name, 14, 0xffffff, '700');
    const count = label(String(zone.count), 13, INK, '700');
    const old = zone.staleCount ? label(`묵음 ${zone.staleCount}`, 12, 0xffffff, '700') : null;
    const padX = 10;
    const pillW = count.width + 14;
    const oldW = old ? old.width + 14 : 0;
    const w = padX + name.width + 8 + pillW + (old ? 5 + oldW : 0) + 6;
    const h = 28;
    const g = new Graphics();
    g.roundRect(0, 0, w, h, 8).fill(INK);
    g.roundRect(padX + name.width + 8, 5, pillW, h - 10, 9).fill(0xffffff);
    if (old) g.roundRect(padX + name.width + 8 + pillW + 5, 5, oldW, h - 10, 9).fill(AGE[3]);
    // a short post, so the sign reads as standing in the room
    g.rect(w / 2 - 1.5, h, 3, 14).fill(INK);
    name.position.set(padX, (h - name.height) / 2);
    count.position.set(padX + name.width + 8 + (pillW - count.width) / 2, (h - count.height) / 2);
    box.addChild(g, name, count);
    if (old) {
      old.position.set(padX + name.width + 8 + pillW + 5 + (oldW - old.width) / 2, (h - old.height) / 2);
      box.addChild(old);
    }
    box.position.set(p.x - w / 2, p.y - h - 14 - 26);
    this.signs.addChild(box);
  }

  /** A small name tag floating above something at a grid position. */
  private tag(text: string, gx: number, gy: number, up: number, strong: boolean) {
    const p = iso(gx, gy);
    const t = label(text, 11, strong ? 0xffffff : INK, '600');
    const g = new Graphics();
    g.roundRect(0, 0, t.width + 12, 18, 9).fill(strong ? ACCENT : 0xffffff).stroke({ width: 1, color: strong ? ACCENT : 0xcfd6e2 });
    t.position.set(6, (18 - t.height) / 2);
    const box = new Container();
    box.addChild(g, t);
    box.position.set(p.x - (t.width + 12) / 2, p.y - up);
    this.signs.addChild(box);
  }

  /** Redraws one box for its current state. */
  private paint(sp: Sprite, now = this.snap ? Date.parse(this.snap.fetchedAt) : Date.now()) {
    const b = sp.box;
    const chosen = b.key === this.selected;
    drawBox(sp.g, b, sp.hover || chosen);
    if (chosen) sp.g.ellipse(0, 2, 36, 18).stroke({ width: 2.5, color: ACCENT });
    sp.body.y = chosen ? -8 : sp.hover ? -4 : 0;
    sp.num.text = b.key.split('-').pop() ?? b.key;

    sp.badge?.destroy({ children: true });
    sp.badge = null;
    // Old boxes say how old: the colour gives the step, the badge the time.
    const text = b.note ? '미정' : ageStep(b) >= 2 && b.staleFrom ? shortAge(now - Date.parse(b.staleFrom)) : '';
    if (text) {
      const t = label(text, 10, 0xffffff, '700');
      const g = new Graphics();
      g.roundRect(0, 0, t.width + 10, 16, 8).fill(b.note ? QUIET : shade(AGE[ageStep(b)], 0.15));
      t.position.set(5, (16 - t.height) / 2);
      const badge = new Container();
      badge.addChild(g, t);
      badge.position.set(-(t.width + 10) / 2, -BOX_H - 34);
      sp.body.addChild(badge);
      sp.badge = badge;
    }
  }

  private spawn(b: Box): Sprite {
    const root = new Container();
    const body = new Container();
    const g = new Graphics();
    // The ticket number is printed on the waybill, slanted along the box's left face.
    const num = label('', 11.5, INK, '700');
    const l = iso(-BOX, BOX);
    const d = iso(BOX, BOX);
    num.anchor.set(0.5);
    num.position.set(l.x + (d.x - l.x) * 0.59, l.y + (d.y - l.y) * 0.59 - 13.5);
    num.skew.set(0, Math.atan(TH / TW));
    body.addChild(g, num);
    root.addChild(body);
    root.eventMode = 'static';
    root.cursor = 'pointer';
    const a = iso(BOX, -BOX);
    const k = iso(-BOX, -BOX);
    root.hitArea = new Polygon([l.x, l.y, d.x, d.y, a.x, a.y, a.x, a.y - BOX_H, k.x, k.y - BOX_H, l.x, l.y - BOX_H]);
    const sp: Sprite = { root, body, g, num, badge: null, box: b, tx: 0, ty: 0, depth: 0, hover: false, leaving: false };
    root.on('pointertap', (e) => {
      e.stopPropagation();
      this.select(sp.box.key);
    });
    root.on('pointerover', (e) => {
      sp.hover = true;
      this.paint(sp);
      this.hooks.onHover(sp.box, e.clientX, e.clientY);
    });
    root.on('pointermove', (e) => this.hooks.onHover(sp.box, e.clientX, e.clientY));
    root.on('pointerout', () => {
      sp.hover = false;
      this.paint(sp);
      this.hooks.onHover(null, 0, 0);
    });
    this.things.addChild(root);
    this.sprites.set(b.key, sp);
    return sp;
  }

  /** Scales and centres the building in the part of the canvas the panel leaves free. */
  private fit() {
    const { width, height } = this.app.screen;
    const free = Math.max(320, width - this.inset);
    const s = Math.min((free - 32) / this.bounds.w, (height - 24) / this.bounds.h, 1.5);
    this.world.scale.set(s);
    this.world.position.set((free - this.bounds.w * s) / 2 - this.bounds.x * s, (height - this.bounds.h * s) / 2 - this.bounds.y * s);
    this.app.stage.hitArea = this.app.screen;
  }

  private animate(ms: number) {
    const k = 1 - Math.pow(0.002, ms / 1000); // frame-rate independent easing
    this.lift.y += (0 - this.lift.y) * k;
    if (Math.abs(this.lift.y) < 0.3) this.lift.y = 0;
    if (this.lift.alpha < 1) this.lift.alpha = Math.min(1, this.lift.alpha + ms / 260);
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

/** Members shown in a space (used by the legend). */
export function membersOf(snap: Snapshot, space: string): Member[] {
  return snap.members.filter((m) => m.space === space);
}
