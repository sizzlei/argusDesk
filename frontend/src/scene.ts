// The centre, drawn with PixiJS in an isometric view: one building whose
// rooms are the zones. Everything is built from flat-shaded blocks (a
// low-poly look) drawn in code, so there are no image files to load.

// Lets PixiJS run where the page may not build code from strings (a strict
// content security policy); it has no effect elsewhere.
import 'pixi.js/unsafe-eval';
import { Application, Container, Graphics, Polygon, Sprite as PixiSprite, type Texture } from 'pixi.js';
import { lookOf } from './avatars';
import type { Away, Box, Change, Member, Snapshot, SpaceView, ZoneView } from './types';
import type { Dust } from './dust';
import type { Weather } from './weather';
import { TW, TH, ZW, ZH, COL_GAP, ROW_GAP, ATRIUM_GAP, grid, COLS, PAD, WALL_H, STOREY, iso, DESK_EXTRA, rowY, roomOrigin } from './scene/grid';
import { INK, QUIET, ACCENT, FLOOR, AGE, shade, ageStep, shortAge, shortName } from './scene/palette';
import { hatch, label, block, BOX, BOX_H, drawBox, floorPoly, tree, hedge, purifier, cooler, bench, sofa, dbTank, Lamp, rack, chiller, desk, person, truck, decorate, furnish, packing, dustMonster } from './scene/props';
import { LANE_LEN, LANE_TOP, lanePitch, pallet, palletCols, slots } from './scene/layout';
import { Sprite, Leg, BeltTile, Belt, BELT_SPEED, BELT_UP, CALM, easeInOut, SQUASH } from './scene/parts';
import { drawBuilding, beltTile } from './scene/building';
import { drawLodge } from './scene/lodge';

export { AGE, TAGS, ageStep, shortName } from './scene/palette';

type Light = 'day' | 'dusk' | 'night' | 'sleep';
/** The tint of the room and the colour behind it, for each light. */
const LIGHTS: Record<Light, [number, number]> = {
  day: [0xffffff, 0xedf0f4],
  dusk: [0xffe9d6, 0xefe6e2],
  night: [0xb9c3e6, 0x2a3350],
  sleep: [0x4f5d8f, 0x131929],
};
/** Which light an hour of the day calls for. */
export function hourLight(now: Date): Light {
  const h = now.getHours() + now.getMinutes() / 60;
  if (h >= 19.5 || h < 6.5) return 'night';
  if (h >= 17.5 || h < 7.5) return 'dusk';
  return 'day';
}

export interface SceneHooks {
  onSelect(box: Box | null): void;
  onHover(box: Box | null, x: number, y: number): void;
  /** The zoom changed: 1 = drawn at its own size. */
  onZoom?(scale: number): void;
  /** The packing bench was clicked: a ticket is to be written on this floor. */
  onWrite?(): void;
  /**
   * A box was dragged into a room, or onto a teammate's desk lane (`to`:
   * their account id, "" = the shared shelf). The box goes back to its place;
   * what follows is up to the app.
   */
  onDrop?(box: Box, zone: string, to: string | undefined): void;
}

/** Where a box can be dropped: a room, and in a desk room each lane. */
interface DropRoom {
  zone: string;
  name: string;
  gx: number;
  gy: number;
  d: number;
  lanes: { id: string; gy: number; h: number }[];
  standing: number; // people standing along the right side (not at a desk), me left out
}

export class Scene {
  private app = new Application();
  private lift = new Container(); // slides when the floor changes
  private world = new Container();
  ground = new Container(); // slab, walls, room floors
  things = new Container(); // furniture, boxes and people, depth-sorted
  signs = new Container(); // room signs and name tags, always on top
  private sprites = new Map<string, Sprite>();
  private rooms: DropRoom[] = []; // where boxes can be dropped on this floor
  private dust = new Map<string, Dust>(); // dust monsters by "space/zone"
  private sky = new Container(); // rain, snow, leaves, in window space: sprites that only move
  private weather: Weather = 'clear';
  private flakes: { x: number; y: number; v: number; s: number; ph: number; sp: PixiSprite }[] = [];
  private veil: Graphics | null = null;
  private skyTextures = new Map<string, Texture>();
  private dustAt = new Map<string, { x: number; y: number; g: Graphics; tag: Container }>(); // where each monster of this floor stands
  private carry: { sp: Sprite; x: number; y: number; on: boolean } | null = null; // a box being dragged
  private dropMark = new Graphics(); // the room or lane a dragged box would land in
  private space = 0;
  private snap: Snapshot | null = null;
  private spot = ''; // the teammate whose boxes are lit
  private hidden: ReadonlySet<string> = new Set(); // boxes the view filter hides
  bounds = { x: 0, y: 0, w: 1, h: 1 };
  private selected = '';
  private inset = 0; // screen width kept free on the right (the ticket panel)
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private clock = 0; // ms since the scene started, for idle motion
  truck: { g: Graphics; x: number; y: number } | null = null;
  private truckRun = -1; // ms into the truck's round trip; -1 = parked
  people: { g: Graphics; x: number; y: number; phase: number; slow?: boolean; walk?: { fx: number; fy: number; t: number; tag: Container | null } }[] = [];
  // I go where I look: my avatar stands on the floor I open, and walks to the
  // room of a box I pick. Only on this screen: teammates see me where my work is.
  me = { id: '', name: '' };
  private myRoom: { space: string; zone: string } | null = null;
  private myLast: { space: string; x: number; y: number } | null = null; // where my avatar stood, to walk from
  // my avatar as drawn now: moved on its own when I pick a box in another room
  private mine: { who: Scene['people'][number]; tag: Container; zone: string; gx: number; gy: number } | null = null;
  lamps: Lamp[] = [];
  lampLayer = new Container(); // one small shape per server lamp
  belts: BeltTile[] = [];
  belt: Belt | null = null;
  private fx = new Container(); // confetti, in window coordinates, above everything
  private bits: { g: Graphics; vx: number; vy: number; spin: number; life: number }[] = [];
  fatigue: Record<string, number> = {};
  away: Away[] = [];
  looks: Record<string, number> = {};
  private held = false; // the user zoomed or moved the view: leave it alone
  private push = 0; // how far the view has slid aside for the panel
  private pushTo = 0;
  private bench: { sign: Container; y: number; gx: number; gy: number } | null = null; // the packing bench and its sign, which bobs
  private shows = new Container(); // short shows over the room: a box being packed
  private acts: { g: Container; ms: number; life: number; step(t: number, g: Container): void }[] = [];
  /** How the team server says it is doing: the server room's lamps show it. */
  system: '' | 'ok' | 'warn' | 'fail' = '';
  /** The room follows the hour: dim in the evening and at night. Off: always day. */
  hours = true;

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
    this.world.addChild(this.ground, this.dropMark, this.things, this.lampLayer, this.shows, this.signs);
    // The building is drawn as one render group: moving, panning and blinking (transforms, tint,
    // alpha) then cost no rebuild of what is drawn; only a shape drawn anew does.
    this.world.enableRenderGroup();
    this.things.sortableChildren = true;
    this.lift.addChild(this.world);
    this.app.stage.addChild(this.lift);
    this.sky.eventMode = 'none';
    this.app.stage.addChild(this.sky); // the weather: over the building, under celebrations
    this.app.stage.addChild(this.fx);
    this.fx.eventMode = 'none';
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on('pointertap', (e) => {
      if (e.target === this.app.stage && !this.drag?.moved) this.mark('');
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
      this.held = true;
    });
    this.app.stage.on('pointerupoutside', () => (this.drag = null));
    // Dragging a box: it follows the pointer, the room or lane under it lights up.
    this.app.stage.on('globalpointermove', (e) => {
      this.seeThrough(e.global);
      const c = this.carry;
      if (!c) return;
      if (!(e.buttons & 1)) return void this.letGo(null);
      if (!c.on && Math.hypot(e.global.x - c.x, e.global.y - c.y) < 6) return;
      if (!c.on) {
        c.on = true;
        this.hooks.onHover(null, 0, 0);
        this.app.canvas.style.cursor = 'grabbing';
      }
      const p = this.world.toLocal(e.global);
      c.sp.held = { x: p.x, y: p.y + 12 };
      this.showDrop(this.dropAt(p.x, p.y), c.sp.box);
    });
    this.app.stage.on('pointerup', (e) => this.carry && this.letGo(this.world.toLocal(e.global)));
    this.app.stage.on('pointerupoutside', () => this.carry && this.letGo(null));
    this.app.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = this.app.canvas.getBoundingClientRect();
        this.zoomAt(e.clientX - r.left, e.clientY - r.top, this.world.scale.x * Math.exp(-e.deltaY * 0.0015));
      },
      { passive: false },
    );
    this.app.canvas.addEventListener('dblclick', () => {
      this.held = false;
      this.fit();
    });
    this.app.ticker.add((t) => this.animate(t.deltaMS));
    // The centre is left open all day: it draws at a modest pace, slower when
    // another window has the focus, and not at all while it cannot be seen.
    const pace = () => {
      if (document.hidden) return void this.app.ticker.stop();
      this.app.ticker.maxFPS = document.hasFocus() ? 30 : 15;
      this.app.ticker.start();
    };
    document.addEventListener('visibilitychange', pace);
    window.addEventListener('focus', pace);
    window.addEventListener('blur', pace);
    pace();
    this.app.renderer.on('resize', () => this.refit());
  }

  /** Spaces are floors of one building: the first space is the ground floor. */
  setSpace(index: number) {
    if (index !== this.space) {
      // Going up, the new floor comes down into view; going down, it rises.
      this.lift.y = index > this.space ? -70 : 70;
      this.lift.alpha = 0;
      this.held = false; // another floor: start from the whole view
    }
    this.space = index;
    this.myRoom = null; // a new floor: I stand where my work on it is, or at its first room
    this.sprites.forEach((s) => s.root.destroy({ children: true }));
    this.sprites.clear();
    this.acts.forEach((a) => a.g.destroy({ children: true }));
    this.acts = [];
    if (this.snap) this.update(this.snap, []);
  }

  /**
   * The people on a floor, with me moved to where I am looking: the room of
   * the box I picked, else where my work on this floor is, else the desk
   * room (or the first room). On holiday I stay down in the lodge.
   */
  private placeMe(snap: Snapshot, space: SpaceView, rooms: ZoneView[]): Member[] {
    const others = snap.members.filter((m) => m.space === space.id && !m.me);
    const real = snap.members.find((m) => m.me);
    const id = real?.id || this.me.id;
    if (!id || this.away.some((a) => a.active && a.id === id)) return snap.members.filter((m) => m.space === space.id);
    const isRoom = (zone: string) => rooms.some((z) => z.id === zone);
    const zone =
      (this.myRoom?.space === space.id && isRoom(this.myRoom.zone) && this.myRoom.zone) ||
      (real?.space === space.id && isRoom(real.zone) && real.zone) ||
      rooms.find((z) => z.kind === 'desk')?.id ||
      rooms.find((z) => z.kind === 'work')?.id ||
      rooms[0]?.id;
    if (!zone) return others;
    const mine = snap.boxes.filter((b) => b.space === space.id && b.assigneeId === id);
    const open = new Set(space.zones.filter((z) => z.kind === 'work' || z.kind === 'desk').map((z) => z.id));
    return [...others, { id, name: real?.name || this.me.name, space: space.id, zone, count: mine.filter((b) => open.has(b.zone)).length, me: true }];
  }

  /** Sets the weather outside (none in the lodge, underground). */
  setWeather(w: Weather) {
    if (w === this.weather) return;
    this.weather = w;
    this.sky.removeChildren().forEach((c) => c.destroy());
    this.flakes = [];
    this.veil = null;
    if (w === 'clear') return;
    // a veil over the day: grey for rain and cloud, cool for snow
    const veil = { cloudy: [0x56647a, 0.08], rain: [0x4a5a72, 0.11], snow: [0x8796ad, 0.1], wind: [0x8090a8, 0.04], leaves: [0xe8a04a, 0.03], blossom: [0xf7c6d6, 0.04] }[w] as [number, number];
    this.veil = new Graphics().rect(0, 0, 1, 1).fill(veil[0]);
    this.veil.alpha = veil[1];
    this.sky.addChild(this.veil);
    const n = { clear: 0, cloudy: 0, snow: 230, rain: 280, wind: 80, leaves: 70, blossom: 80 }[w];
    const { width, height } = this.app.screen;
    for (let i = 0; i < n; i++) {
      const f = { x: Math.random() * width, y: Math.random() * height, v: 0.6 + Math.random() * 0.8, s: 0.6 + Math.random() * 0.9, ph: Math.random() * 6.3, sp: new PixiSprite(this.flakeTexture(w, i)) };
      f.sp.anchor.set(0.5);
      if (w === 'snow') f.sp.scale.set((1.6 + f.s * 1.8) / 3.4);
      if (w === 'leaves' || w === 'blossom') {
        f.sp.tint = w === 'leaves' ? [0xe07b39, 0xc9472f, 0xe8b23a][Math.floor(f.ph) % 3] : [0xf7b6c8, 0xfbd3df, 0xf29bb5][Math.floor(f.ph) % 3];
        f.sp.scale.set(f.s);
      }
      if (w === 'rain') f.sp.scale.set(1, (16 + f.s * 8) / 22);
      this.sky.addChild(f.sp);
      this.flakes.push(f);
    }
    this.drawSky(0);
  }

  /** The shape of one drop, flake or leaf: drawn once per kind, then reused by every sprite. */
  private flakeTexture(w: Weather, i: number): Texture {
    const key = w === 'wind' ? (i % 6 === 0 ? 'bit' : 'gust') : w === 'blossom' ? 'leaves' : w;
    let t = this.skyTextures.get(key);
    if (t) return t;
    const g = new Graphics();
    switch (key) {
      case 'snow':
        g.circle(0.6, 0.8, 3.4).fill({ color: 0x5a6a85, alpha: 0.18 }).circle(0, 0, 3.4).fill(0xffffff);
        break;
      case 'rain':
        g.moveTo(0, 0).lineTo(5, -22).stroke({ width: 1.5, color: 0x6f8fbf, alpha: 0.7 });
        break;
      case 'gust':
        g.moveTo(0, 0).quadraticCurveTo(-30, -4, -60, 2).stroke({ width: 1.8, color: 0x9fb0c8, alpha: 0.6 });
        break;
      case 'bit':
        g.rect(0, 0, 4, 3).fill({ color: 0x8a7f70, alpha: 0.85 });
        break;
      default: // a leaf or a petal: white, coloured by tint
        g.poly([-6, 0, 0, -2.7, 6, 0, 0, 2.7]).fill(0xffffff);
    }
    t = this.app.renderer.generateTexture({ target: g, resolution: 2 });
    g.destroy();
    this.skyTextures.set(key, t);
    return t;
  }

  /** Moves the weather on by one frame: positions, turns and sizes only. */
  private drawSky(ms: number) {
    const w = this.weather;
    this.sky.visible = w !== 'clear' && this.space >= 0;
    if (!this.sky.visible) return;
    const { width, height } = this.app.screen;
    if (this.veil) this.veil.scale.set(width, height);
    if (CALM) {
      this.flakes.forEach((f) => (f.sp.visible = false));
      return;
    }
    const T = this.clock / 1000;
    const dt = ms / 1000;
    for (const f of this.flakes) {
      switch (w) {
        case 'snow':
          f.y += (24 + f.v * 30) * dt;
          f.x += Math.sin(T * 1.2 + f.ph) * 14 * dt;
          break;
        case 'rain':
          f.y += (520 + f.v * 260) * dt;
          f.x -= (90 + f.v * 40) * dt;
          break;
        case 'wind':
          f.x += (480 + f.v * 380) * dt;
          f.y += Math.sin(T * 2 + f.ph) * 10 * dt;
          f.sp.scale.x = (30 + f.s * 50) / 60;
          break;
        case 'leaves':
        case 'blossom': {
          f.y += (30 + f.v * 26) * dt;
          f.x += (Math.sin(T * 1.5 + f.ph) * 30 + 14) * dt;
          const a = T * 2 * f.v + f.ph;
          f.sp.rotation = a * 0.5;
          f.sp.scale.y = f.s * Math.max(0.15, Math.abs(Math.sin(a))); // turning over as it falls
          break;
        }
      }
      // round again from the other side
      if (f.y > height + 20) [f.y, f.x] = [-20, Math.random() * width];
      if (f.x < -90) f.x = width + 20;
      if (f.x > width + 90) [f.x, f.y] = [-40, Math.random() * height];
      f.sp.position.set(f.x, f.y);
    }
  }

  /** Takes the dust monsters of the whole centre. */
  setDust(dust: Map<string, Dust>) {
    this.dust = dust;
  }

  /** A monster under the pointer turns see-through, so the boxes behind it can be seen and picked. */
  private seeThrough(at: { x: number; y: number }) {
    if (!this.dustAt.size) return;
    const p = this.world.toLocal(at);
    this.dustAt.forEach((d) => {
      const near = Math.abs(p.x - d.x) < 48 && p.y < d.y + 14 && p.y > d.y - 110;
      d.g.alpha = d.tag.alpha = near ? 0.18 : 1;
    });
  }

  /** A monster was swept away: a puff of dust where it stood (if it was on this floor). */
  sweep(key: string) {
    const at = this.dustAt.get(key);
    if (!at || CALM) return;
    const p = this.world.toGlobal(at);
    for (let i = 0; i < 26; i++) {
      const g = new Graphics().rect(-3, -3, 6, 6).fill([0x8e8a95, 0xaaa6b0, 0x6f6b76][i % 3]);
      g.position.set(p.x, p.y - 30);
      const a = Math.random() * Math.PI * 2;
      const v = 0.15 + Math.random() * 0.35;
      this.fx.addChild(g);
      this.bits.push({ g, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.25, spin: (Math.random() - 0.5) * 0.03, life: 700 + Math.random() * 500 });
    }
  }

  /** Who I am, so my avatar can follow me. */
  setMe(id: string, name: string) {
    this.me = { id, name };
  }

  /** Takes how tired each teammate is and who is on holiday. */
  setTeam(fatigue: Record<string, number>, away: Away[], looks: Record<string, number>) {
    const same = JSON.stringify([fatigue, away, looks]) === JSON.stringify([this.fatigue, this.away, this.looks]);
    this.fatigue = fatigue;
    this.away = away;
    this.looks = looks;
    if (!same && this.snap) this.update(this.snap, []);
  }

  /** Lights up one teammate's boxes and fades the rest ("" = everyone's). */
  setSpot(id: string) {
    this.spot = id;
    this.sprites.forEach((sp) => this.paint(sp));
  }

  /** Sets the zoom, keeping the point (cx, cy) of the window where it is. */
  private zoomAt(cx: number, cy: number, to: number) {
    const old = this.world.scale.x;
    const next = Math.min(2.5, Math.max(0.35, to));
    this.world.position.set(cx - ((cx - this.world.x) * next) / old, cy - ((cy - this.world.y) * next) / old);
    this.world.scale.set(next);
    this.held = true;
    this.hooks.onZoom?.(next);
  }

  /** Zooms in or out a step around the middle of the window (for the zoom buttons). */
  zoom(factor: number) {
    this.zoomAt(this.app.screen.width / 2, this.app.screen.height / 2, this.world.scale.x * factor);
  }

  /** Back to the whole building, fitted to the window. */
  resetView() {
    this.held = false;
    this.fit();
  }

  /** Tells the scene how much of the right side the open panel covers. */
  setInset(px: number) {
    this.inset = px;
    this.reveal();
  }

  /**
   * The panel lies over the right side of the room. The view keeps its zoom
   * and place; it only slides aside when the chosen box would be hidden under
   * the panel, and slides back when the panel closes.
   */
  private reveal() {
    const sp = this.sprites.get(this.selected);
    if (!this.inset || !sp) {
      this.pushTo = 0;
      return;
    }
    const x = this.world.x + sp.tx * this.world.scale.x; // where the box is on screen now
    const limit = this.app.screen.width - this.inset - 70;
    const rest = x - this.push; // where it would be with no slide at all
    this.pushTo = rest > limit ? limit - rest : 0;
  }

  private dropped = ''; // the box a drag just ended on: its click is not a click

  /** The room, and lane, under a point of the floor (world space). */
  private dropAt(x: number, y: number): { room: DropRoom; lane?: DropRoom['lanes'][number] } | null {
    const a = (2 * x) / TW;
    const b = (2 * y) / TH;
    const gx = (a + b) / 2;
    const gy = (b - a) / 2;
    const room = this.rooms.find((r) => gx >= r.gx && gx <= r.gx + ZW && gy >= r.gy && gy <= r.gy + r.d);
    if (!room) return null;
    const lane = room.lanes.find((l) => gy >= l.gy && gy < l.gy + l.h);
    return { room, lane };
  }

  /** Lights up where a dragged box would land: green where it can go, nothing over its own place. */
  private showDrop(at: ReturnType<Scene['dropAt']>, box: Box) {
    const g = this.dropMark;
    g.clear();
    if (!at) return;
    const same = at.room.zone === box.zone && (!at.lane || at.lane.id === box.assigneeId);
    if (same) return;
    const [x0, y0, w, d] = at.lane ? [at.room.gx + 0.3, at.lane.gy, ZW - 0.6, at.lane.h] : [at.room.gx, at.room.gy, ZW, at.room.d];
    const pts = [iso(x0, y0), iso(x0 + w, y0), iso(x0 + w, y0 + d), iso(x0, y0 + d)].flatMap((p) => [p.x, p.y]);
    g.poly(pts).fill({ color: ACCENT, alpha: 0.12 }).stroke({ width: 3, color: ACCENT, alpha: 0.8 });
  }

  /** Ends a drag. `at`: where it was let go (world space), or null to call it off. */
  private letGo(at: { x: number; y: number } | null) {
    const c = this.carry;
    this.carry = null;
    this.dropMark.clear();
    this.app.canvas.style.cursor = '';
    if (!c?.on) return; // a press without a drag: a click
    c.sp.held = undefined;
    this.hop(c.sp, 260, 10); // back to its place, until Jira says otherwise
    this.dropped = c.sp.box.key;
    window.setTimeout(() => this.dropped === c.sp.box.key && (this.dropped = ''), 0);
    const spot = at && this.dropAt(at.x, at.y);
    if (!spot) return;
    const b = c.sp.box;
    const to = spot.lane ? spot.lane.id : undefined;
    if (spot.room.zone === b.zone && (to === undefined || to === b.assigneeId)) return;
    this.hooks.onDrop?.(b, spot.room.zone, to);
  }

  select(key: string) {
    this.mark(key);
    this.walkTo(key);
    this.hooks.onSelect(this.sprites.get(key)?.box ?? null);
  }

  /** I walk over to the room a box of this floor is in. */
  walkTo(key: string) {
    const b = this.sprites.get(key)?.box;
    const space = this.snap?.spaces[this.space];
    if (b && space && b.space === space.id && (this.myRoom?.zone !== b.zone || this.myRoom.space !== space.id)) {
      this.myRoom = { space: space.id, zone: b.zone };
      // only my avatar moves; the floor is redrawn only when that cannot be done
      if (!this.moveMe(b.zone) && this.snap) this.update(this.snap, []);
    }
  }

  /** Walks my avatar to another room of this floor without redrawing the floor. False when it cannot. */
  private moveMe(zone: string): boolean {
    const me = this.mine;
    const room = this.rooms.find((r) => r.zone === zone);
    const space = this.snap?.spaces[this.space];
    if (!me || !room || !space || me.zone === zone || me.who.g.destroyed) return false;
    const myId = this.snap?.members.find((m) => m.me)?.id || this.me.id;
    const lane = room.lanes.find((l) => l.id === myId);
    const gx = lane ? room.gx + 0.55 : room.gx + ZW - 0.8;
    const gy = lane ? lane.gy + 0.5 : room.gy + 2.2 + room.standing * 1.1;
    const p = iso(gx, gy);
    const was = iso(me.gx, me.gy);
    const who = me.who;
    if (!CALM) who.walk = { fx: who.g.x, fy: who.g.y, t: 0, tag: me.tag };
    who.x = p.x;
    who.y = p.y;
    who.g.zIndex = (gx + gy) * 100 + 1;
    if (CALM) who.g.position.set(p.x, p.y);
    me.tag.position.set(me.tag.x + p.x - was.x, me.tag.y + p.y - was.y);
    me.tag.alpha = CALM ? 1 : 0;
    this.mine = { ...me, zone, gx, gy };
    this.myLast = { space: space.id, x: p.x, y: p.y };
    return true;
  }

  /**
   * Brings a box into view: if it stands outside the middle of the window
   * (the user had zoomed in elsewhere), the view moves to it, keeping the zoom.
   */
  focus(key: string) {
    const sp = this.sprites.get(key);
    if (!sp) return;
    const { width, height } = this.app.screen;
    const x = this.world.x + sp.tx * this.world.scale.x;
    const y = this.world.y + sp.ty * this.world.scale.y;
    if (x > 120 && x < width - 120 && y > 140 && y < height - 100) return;
    this.world.x += width / 2 - x;
    this.world.y += height / 2 - y;
    this.held = true;
  }

  /**
   * The light in the room. "sleep" is the lodge with the lights out; "dusk"
   * and "night" follow the hour and stay bright enough to read a box's
   * colour. Signs and name tags are never dimmed.
   */
  light(mode: Light) {
    const [dim, back] = LIGHTS[mode];
    this.ground.tint = dim;
    this.things.tint = dim;
    this.app.renderer.background.color = back;
  }

  /** Plays a short show: `step` draws it from 0 to 1, then it is gone. */
  private show(g: Container, life: number, step: (t: number, g: Container) => void, host: Container = this.shows) {
    if (CALM) return void g.destroy({ children: true });
    host.addChild(g);
    step(0, g);
    this.acts.push({ g, ms: 0, life, step });
  }

  /**
   * A ticket was written: at the packing bench a waybill drops onto a box,
   * which hops down to the floor. The real box follows when Jira has it.
   */
  pack(tag: number) {
    const at = this.bench;
    if (!at) return;
    const g = new Graphics();
    this.show(g, 1500, (t) => {
      g.clear();
      // on the bench until the waybill lands, then an arc down to the floor in front
      const go = easeInOut(Math.min(1, Math.max(0, (t - 0.38) / 0.42)));
      const gx = at.gx + 4.8 + go * -0.6;
      const gy = at.gy + 0.8 + go * 1.5;
      const up = 18 * (1 - go) + Math.sin(go * Math.PI) * 26;
      const squash = t > 0.3 && t < 0.4 ? 3 : 0; // the thump of the waybill
      block(g, gx - 0.36, gy - 0.25, 0.72, 0.5, 13 - squash, 0xd9a866, up);
      block(g, gx - 0.36, gy - 0.25, 0.72, 0.5, 1, 0xe7bd82, up + 13 - squash);
      // the waybill: falls from above, then rides on the lid
      const fall = Math.min(1, t / 0.32);
      const p = iso(gx, gy);
      const wy = p.y - up - 14 + squash - (1 - fall) * 46;
      g.poly([p.x - 9, wy, p.x + 3, wy - 6, p.x + 12, wy - 1.5, p.x, wy + 4.5]).fill({ color: 0xffffff, alpha: Math.min(1, t / 0.12) });
      g.poly([p.x - 9, wy, p.x - 6, wy - 1.5, p.x + 3, wy + 3, p.x, wy + 4.5]).fill({ color: tag, alpha: Math.min(1, t / 0.12) });
      g.alpha = t > 0.86 ? (1 - t) / 0.14 : 1;
    });
    if (!CALM) {
      const p = iso(at.gx + 4.8, at.gy + 0.8);
      const w = this.world.toGlobal({ x: p.x, y: p.y - 40 });
      this.burst(w.x, w.y, 10, 0.7);
    }
  }

  /**
   * Where something of the room is in the window, for the tour to point at:
   * a box (one of mine when I hold any) or the packing bench.
   */
  rectOf(what: 'box' | 'bench') {
    let thing: Container | null = null;
    if (what === 'bench') thing = this.bench?.sign ?? null;
    else {
      const all = [...this.sprites.values()].filter((s) => !s.leaving && !this.hidden.has(s.box.key));
      thing = (all.find((s) => s.box.mine) ?? all[0])?.root ?? null;
    }
    if (!thing || thing.destroyed) return null;
    const b = thing.getBounds();
    const c = this.app.canvas.getBoundingClientRect();
    const r = { x: c.left + b.minX, y: c.top + b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY };
    // off the window: nothing to point at
    return r.w > 0 && r.x + r.w > 0 && r.y + r.h > 0 && r.x < window.innerWidth && r.y < window.innerHeight ? r : null;
  }

  /** My answer to an approval lands on the box as a stamp, and travels with it. */
  stamp(key: string, approve: boolean) {
    const sp = this.sprites.get(key);
    if (!sp) return;
    const colour = approve ? 0x2f9e63 : 0xc7352f;
    const mark = new Container();
    const ring = new Graphics();
    ring.roundRect(-25, -13, 50, 26, 6).fill({ color: 0xffffff, alpha: 0.92 }).stroke({ width: 3, color: colour });
    ring.roundRect(-21, -9, 42, 18, 3).stroke({ width: 1, color: colour });
    const word = label(approve ? '승인' : '반려', 13, colour, '700');
    word.position.set(-word.width / 2, -word.height / 2);
    mark.addChild(ring, word);
    mark.position.set(0, -BOX_H - 22);
    mark.rotation = -0.2;
    this.show(
      mark,
      1700,
      (t) => {
        // comes down hard, sits, then fades
        const down = Math.min(1, t / 0.14);
        mark.scale.set(2.4 - 1.4 * down + (t > 0.14 && t < 0.2 ? 0.08 : 0));
        mark.alpha = t < 0.14 ? down : t > 0.75 ? (1 - t) / 0.25 : 1;
      },
      sp.root,
    );
    if (approve && !CALM) {
      const w = sp.root.toGlobal({ x: 0, y: -BOX_H - 22 });
      this.burst(w.x, w.y, 14, 0.8);
    }
  }

  /** Marks a box as the chosen one without telling anyone (its window did). */
  mark(key: string) {
    if (key === this.selected) return;
    this.selected = key;
    this.sprites.forEach((s) => this.paint(s));
  }

  /** Redraws the building for a new snapshot; changes drive the animations. */
  update(snap: Snapshot, changes: Change[], hidden: ReadonlySet<string> = this.hidden) {
    this.snap = snap;
    this.hidden = hidden;
    if (this.space < 0) {
      this.light('sleep');
      drawLodge(this);
      return;
    }
    this.light(this.hours ? hourLight(new Date()) : 'day');
    const space: SpaceView | undefined = snap.spaces[this.space] ?? snap.spaces[0];
    if (!space) return;
    // Returned boxes leave the building: their zones are not rooms.
    // Zones that wait on another team are sidings off the conveyor, where
    // there is one; on a floor too small for a conveyor they are plain rooms.
    const inside = space.zones.filter((z) => z.kind !== 'returned');
    const withBelt = inside.filter((z) => z.kind !== 'siding').length > COLS;
    const rooms = withBelt ? inside.filter((z) => z.kind !== 'siding') : inside;
    const sidings = withBelt ? inside.filter((z) => z.kind === 'siding') : [];
    const resting = new Set(this.away.filter((a) => a.active).map((a) => a.id));
    const boxes = snap.boxes.filter((b) => b.space === space.id);
    const members = this.placeMe(snap, space, rooms);
    const added = new Set(changes.filter((c) => c.kind === 'added').map((c) => c.key));
    // An urgent box arriving on this floor, or a box made urgent here, sounds the alarm.
    if (changes.some((c) => (c.kind === 'added' || c.kind === 'urgent') && boxes.some((b) => b.key === c.key && b.urgent))) this.alarm();
    const now = Date.parse(snap.fetchedAt);

    this.ground.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.signs.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.things.children.filter((c) => c.label === 'prop').forEach((c) => c.destroy({ children: true }));

    const rows = Math.ceil(rooms.length / COLS);
    // The ground floor is a tight warehouse; the floors above open around a garden.
    grid.rowGap = snap.spaces.indexOf(space) > 0 && rows > 1 ? ATRIUM_GAP : ROW_GAP;
    const cols = Math.min(COLS, rooms.length);
    const width = cols * ZW + (cols - 1) * COL_GAP;
    grid.rowDepths = Array.from({ length: rows }, (_, r) =>
      rooms.some((z, i) => Math.floor(i / COLS) === r && z.kind === 'desk') ? ZH + DESK_EXTRA : ZH,
    );
    const depth = rowY(rows - 1) + grid.rowDepths[rows - 1];
    this.truck = null;
    this.people = [];
    this.rooms = [];
    this.mine = null;
    this.dustAt.clear();
    this.belts = [];
    this.belt = null;
    this.lamps = [];
    this.bench = null;
    drawBuilding(this, width, depth, rows, cols, snap.spaces.indexOf(space), space.name, snap.spaces.length);

    const prop = (gx: number, gy: number, draw: (g: Graphics) => void, bias = 0) => {
      const g = new Graphics();
      draw(g);
      g.label = 'prop';
      g.zIndex = (gx + gy) * 100 + bias;
      this.things.addChild(g);
      return g;
    };

    const alive = new Set<string>();
    const roomOf = (zoneId: string) => rooms.findIndex((z) => z.id === zoneId);
    // sidings: short spurs between the two lanes, each branching off lane A
    const spur = new Map<string, { x: number; mid: number }>();
    const belt = this.belt as Belt | null;
    if (belt) {
      const mid = (belt.a + belt.b) / 2;
      sidings.forEach((z, k) => spur.set(z.id, { x: Math.min(1.4 + k * 6.2, belt.end - 5), mid }));
    }
    const stationOf = (zoneId: string) => {
      const sd = spur.get(zoneId);
      return sd ? { s: sd.x } : this.station(roomOf(zoneId));
    };
    /** Puts a box at its place, sending it there by belt or by hop when it moved. */
    const settle = (b: Box, x: number, y: number, depth: number, zoneId: string) => {
      alive.add(b.key);
      let sp = this.sprites.get(b.key);
      if (!sp) {
        sp = this.spawn(b);
        sp.tx = x;
        sp.ty = y;
        const to = stationOf(zoneId);
        if (!added.has(b.key)) {
          sp.root.position.set(x, y); // already here when the app opened
        } else if (to && !CALM) {
          // A new box comes in on the belt and rides to its room.
          const start = this.beltAt(belt!.entry);
          sp.root.position.set(start.x, start.y);
          sp.root.alpha = 0;
          this.ride(sp, belt!.entry, to.s, x, y);
        } else {
          sp.root.position.set(x, y - 170); // no belt on this floor: it drops in
          sp.root.alpha = 0;
          this.hop(sp, 520 + Math.random() * 160, 0);
        }
      } else if (Math.hypot(x - sp.tx, y - sp.ty) > 1) {
        const from = stationOf(sp.box.zone);
        const to = stationOf(zoneId);
        const far = Math.hypot(x - sp.root.x, y - sp.root.y);
        sp.tx = x;
        sp.ty = y;
        if (from && to && sp.box.zone !== b.zone && !CALM) {
          // To another place: out of the door, along the belt, off at the other end.
          this.ride(sp, from.s, to.s, x, y);
        } else {
          this.hop(sp, Math.min(1200, 420 + far * 1.1), Math.min(90, 14 + far * 0.3));
        }
      }
      sp.box = b;
      sp.depth = depth;
      sp.leaving = false;
      this.paint(sp, now);
    };
    // draw the sidings and stand their boxes on them
    spur.forEach((sd, id) => {
      const zone = sidings.find((z) => z.id === id)!;
      beltTile(this, sd.x, belt!.a + 0.4, sd.mid - 0.4 - (belt!.a + 0.4), 'y', 1);
      for (let i = 0; i < 4; i++) beltTile(this, sd.x - 0.4 + i, sd.mid, i === 3 ? 0.6 : 1, 'x', 1);
      prop(sd.x + 3.4, sd.mid, (g) => block(g, sd.x + 3.2, sd.mid - 0.45, 0.16, 0.9, 12, 0x8a93a6)); // buffer stop
      const waiting = boxes.filter((b) => b.zone === id);
      this.tag(zone.staleCount ? `${zone.name} ${zone.count} · 묵음 ${zone.staleCount}` : `${zone.name} ${zone.count}`, sd.x + 1.4, sd.mid, 62, false);
      waiting.forEach((b, i) => {
        const gx = sd.x + 0.35 + (i % 3) * 0.95;
        const level = Math.floor(i / 3);
        const p = iso(gx, sd.mid);
        settle(b, p.x, p.y - BELT_UP - level * BOX_H, (gx + sd.mid) * 100 + 60 + level, id);
      });
    });
    rooms.forEach((zone, zi) => {
      const o = roomOrigin(zi);

      const floor = new Graphics();
      floor.poly(floorPoly(o.gx, o.gy, ZW, o.d)).fill(FLOOR[zone.kind]);
      for (let i = 1; i < ZW; i++) {
        const s = iso(o.gx + i, o.gy);
        const e = iso(o.gx + i, o.gy + o.d);
        floor.moveTo(s.x, s.y).lineTo(e.x, e.y).stroke({ width: 1, color: shade(FLOOR[zone.kind], 0.5), alpha: 0.1 });
      }
      for (let j = 1; j < o.d; j++) {
        const s = iso(o.gx, o.gy + j);
        const e = iso(o.gx + ZW, o.gy + j);
        floor.moveTo(s.x, s.y).lineTo(e.x, e.y).stroke({ width: 1, color: shade(FLOOR[zone.kind], 0.5), alpha: 0.1 });
      }
      this.ground.addChild(floor);

      // Where the team writes its own tickets, the first waiting room's counter is the packing bench.
      if (space.create && zone.kind === 'wait' && !this.bench) this.packingBench(o.gx, o.gy);
      else if (zone.kind !== 'desk') prop(o.gx + 3, o.gy + 0.8, (g) => furnish(g, zone.kind, o.gx, o.gy), -50);
      decorate((px, py, draw) => prop(px, py, draw), zone.kind, rooms.slice(0, zi).filter((z) => z.kind === zone.kind).length, o.gx, o.gy, o.d);
      // The truck waits outside the building when the dock is in the front row.
      if (zone.kind === 'done' && o.row === rows - 1 && snap.spaces.indexOf(space) === 0) {
        const tg = prop(o.gx + 4, o.gy + o.d + 2, (g) => truck(g, o.gx + 3.2, o.gy + o.d + PAD + 0.5));
        const c = iso(o.gx + 3.2 + 0.95, o.gy + o.d + PAD + 0.5 + 0.55); // middle of the cargo box
        this.truck = { g: tg, x: c.x, y: c.y };
      }

      this.sign(zone, o.gx, o.gy);

      const inZone = boxes.filter((b) => b.zone === zone.id);
      // Desk lanes: me first, then teammates by name, then the shared shelf.
      const lanes: string[] = [];
      const here = members.filter((m) => m.zone === zone.id || inZone.some((b) => b.assigneeId === m.id));
      if (zone.kind === 'desk') {
        here.sort((a, b) => Number(b.me) - Number(a.me) || a.name.localeCompare(b.name, 'ko'));
        here.forEach((m) => lanes.push(m.id));
        lanes.push(''); // shelf
        const pitch = lanePitch(lanes.length, o.d);
        lanes.forEach((id, li) => {
          const gx = o.gx + 1.3;
          const gy = o.gy + LANE_TOP + li * pitch;
          const who = here.find((m) => m.id === id);
          prop(gx, gy, (g) => desk(g, gx, gy, id === '' ? 'shelf' : who?.me ? 'mine' : 'desk'));
          if (id === '') {
            const n = inZone.filter((b) => !b.assigneeId).length;
            this.tag(n ? `미배정 ${n}` : '미배정', gx, gy, 38, false);
            const mark = new Graphics();
            hatch(mark, o.gx + 1.75, gy - 0.5, Math.min(LANE_LEN, Math.max(1, n)) + 0.1, 1);
            this.ground.addChild(mark);
          }
        });
      }

      this.rooms.push({
        zone: zone.id,
        name: zone.name,
        gx: o.gx,
        gy: o.gy,
        d: o.d,
        lanes: zone.kind === 'desk' ? lanes.map((id, li) => ({ id, gy: o.gy + LANE_TOP + li * lanePitch(lanes.length, o.d) - 0.5, h: lanePitch(lanes.length, o.d) })) : [],
        standing: 0,
      });
      const dropRoom = this.rooms[this.rooms.length - 1];

      // A dust monster where old boxes pile up, at the front of the room.
      const dust = this.dust.get(`${space.id}/${zone.id}`);
      if (dust) {
        // on the free strip along the front, between the bench (left) and the pallet's sign (right)
        const gx = o.gx + 4.1;
        const gy = o.gy + o.d - 0.45;
        const p = iso(gx, gy);
        const g = prop(gx, gy, (pg) => dustMonster(pg, dust.size, dust.hurt), 250); // in front of the planters along the wall
        g.position.set(p.x, p.y);
        g.eventMode = 'none'; // never in the way of a click on a box behind it
        this.people.push({ g, x: p.x, y: p.y, phase: zi * 2.3, slow: dust.hurt > 0.5 });
        const tag = this.tag(`먼지 괴물 · 묵은 상자 ${dust.count}`, gx, gy, 34 + dust.size * 20, false);
        tag.eventMode = 'none';
        this.dustAt.set(`${space.id}/${zone.id}`, { x: p.x, y: p.y, g, tag });
      }

      // Boxes nobody holds stand apart on a marked pallet. Not in the first
      // room, where everything has just arrived and nothing is held yet.
      const loose = zone.kind !== 'desk' && zone.kind !== 'done' && zi > 0 ? inZone.filter((b) => !b.assigneeId).length : 0;
      if (loose) {
        const at = pallet(palletCols(loose, inZone.length));
        const mark = new Graphics();
        hatch(mark, o.gx + at.gx, o.gy + at.gy, at.w, at.d);
        this.ground.addChild(mark);
        this.tag(`미배정 ${loose}`, o.gx + at.gx + at.w / 2, o.gy + at.gy + at.d + 0.35, 9, false); // on the floor before the pallet
      }

      const where = slots(zone, inZone, lanes, o.d, loose > 0);
      for (const b of inZone) {
        const s = where.get(b.key)!;
        const p = iso(o.gx + s.gx, o.gy + s.gy);
        const x = p.x;
        const y = p.y - s.level * BOX_H;
        const depth = (o.gx + s.gx + o.gy + s.gy) * 100 + s.level;
        settle(b, x, y, depth, zone.id);
      }

      // people: behind their desk in a desk room, otherwise along the room's right side
      let seated = 0;
      members
        .filter((m) => m.zone === zone.id && !resting.has(m.id)) // on holiday: down in the lodge
        .forEach((m, mi) => {
          const lane = lanes.indexOf(m.id);
          const atDesk = zone.kind === 'desk' && lane >= 0;
          const tired = this.fatigue[m.id] ?? 0;
          // Worn out: off to the room's bench to rest (rooms without one: stay put, looking tired).
          const benchAt =
            zone.kind === 'work' || zone.kind === 'desk'
              ? { gx: o.gx + 1.35 + seated * 0.6, gy: o.gy + o.d - 0.75 }
              : zone.kind === 'wait'
                ? { gx: o.gx + 0.45, gy: o.gy + o.d - 2.0 + seated * 0.6 }
                : null;
          const rest = tired >= 2 && benchAt && seated < 2 ? benchAt : null;
          if (rest) seated++;
          const gx = rest ? rest.gx : atDesk ? o.gx + 0.55 : o.gx + ZW - 0.8;
          const gy = rest ? rest.gy : atDesk ? o.gy + LANE_TOP + lane * lanePitch(lanes.length, o.d) : o.gy + 2.2 + mi * 1.1;
          const p = iso(gx, gy);
          // Someone resting sits on top of the bench: drawn after it, and raised to the seat.
          const g = prop(gx, gy, (pg) => person(pg, lookOf(m.id, this.looks), m.me, rest ? 2 : tired ? 1 : 0), rest ? 120 : 1);
          const py = rest ? p.y - 4 : p.y;
          g.position.set(p.x, py);
          const name = m.count ? `${shortName(m.name)} ${m.count}` : shortName(m.name);
          const tag = this.tag(name, gx, gy, (m.me ? 78 : 62) + (rest ? 4 : 0), m.me);
          const who: Scene['people'][number] = { g, x: p.x, y: py, phase: mi * 1.7 + zi, slow: tired > 0 };
          if (!m.me && !atDesk && !rest) dropRoom.standing++;
          if (m.me) {
            this.mine = { who, tag, zone: zone.id, gx, gy };
            // From where I stood on this floor, I walk; on arriving at a floor, I am simply there.
            const from = this.myLast?.space === space.id ? this.myLast : null;
            if (from && Math.hypot(from.x - p.x, from.y - py) > 4 && !CALM) {
              who.walk = { fx: from.x, fy: from.y, t: 0, tag };
              g.position.set(from.x, from.y);
              tag.alpha = 0;
            }
            this.myLast = { space: space.id, x: p.x, y: py };
          }
          this.people.push(who);
        });
    });

    // Cells of the grid that hold no room are not left bare: the first becomes
    // the server room, any others a lounge.
    for (let i = rooms.length; i < rows * COLS && rows > 1; i++) {
      const o = roomOrigin(i);
      const first = i === rooms.length;
      const floor = new Graphics();
      const colour = first ? 0xd5dae6 : 0xefe6da;
      floor.poly(floorPoly(o.gx, o.gy, ZW, o.d)).fill(colour);
      for (let k = 1; k < ZW; k++) {
        const a = iso(o.gx + k, o.gy);
        const b = iso(o.gx + k, o.gy + o.d);
        floor.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1, color: shade(colour, 0.5), alpha: first ? 0.2 : 0.08 });
      }
      for (let k = 1; k < o.d; k++) {
        const a = iso(o.gx, o.gy + k);
        const b = iso(o.gx + ZW, o.gy + k);
        floor.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1, color: shade(colour, 0.5), alpha: first ? 0.2 : 0.08 });
      }
      this.ground.addChild(floor);
      if (first) {
        for (const ry of [1.0, 3.4]) for (const rx of [0.9, 2.3, 3.7, 5.1]) prop(o.gx + rx + 0.5, o.gy + ry + 0.4, (g) => rack(g, o.gx + rx, o.gy + ry, this.lamps));
        prop(o.gx + 7.1, o.gy + 1.6, (g) => chiller(g, o.gx + 6.7, o.gy + 1.0));
        prop(o.gx + 6.9, o.gy + 4.4, (g) => dbTank(g, o.gx + 6.9, o.gy + 4.4));
        prop(o.gx + 1.6, o.gy + o.d - 0.9, (g) => desk(g, o.gx + 1.6, o.gy + o.d - 0.9, 'desk'));
        prop(o.gx + 0.45, o.gy + o.d - 0.45, (g) => purifier(g, o.gx + 0.2, o.gy + o.d - 0.7));
        prop(o.gx + 4.6, o.gy + o.d - 0.3, (g) => hedge(g, o.gx + 3.4, o.gy + o.d - 0.5, 'x', 2.4));
        this.plate(this.system === 'fail' ? '서버실 · Argus 장애' : this.system === 'warn' ? '서버실 · Argus 주의' : '서버실', o.gx + ZW / 2, o.gy + 0.15);
      } else {
        const rug = new Graphics();
        rug.poly(floorPoly(o.gx + 2.2, o.gy + 1.6, 3.6, 3.0)).fill(0xd9c7b0);
        rug.poly(floorPoly(o.gx + 2.45, o.gy + 1.85, 3.1, 2.5)).fill(0xe6d8c5);
        this.ground.addChild(rug);
        prop(o.gx + 4.0, o.gy + 2.4, (g) => sofa(g, o.gx + 2.9, o.gy + 1.9));
        prop(o.gx + 0.5, o.gy + 0.5, (g) => tree(g, o.gx + 0.25, o.gy + 0.25));
        prop(o.gx + 7.3, o.gy + 0.5, (g) => tree(g, o.gx + 7.05, o.gy + 0.25));
        prop(o.gx + 7.4, o.gy + 3.2, (g) => cooler(g, o.gx + 7.2, o.gy + 3.0));
        prop(o.gx + 0.45, o.gy + 3.4, (g) => bench(g, o.gx + 0.2, o.gy + 2.6, 'y', 1.8));
        prop(o.gx + 4.2, o.gy + o.d - 0.3, (g) => hedge(g, o.gx + 2.6, o.gy + o.d - 0.5, 'x', 3.2));
        prop(o.gx + 0.45, o.gy + o.d - 0.45, (g) => purifier(g, o.gx + 0.2, o.gy + o.d - 0.7));
        this.plate('휴게실', o.gx + ZW / 2, o.gy + 0.15);
      }
    }
    // lamps blink on their own layer, above everything in the rooms: each drawn once, then only tinted
    this.lampLayer.removeChildren().forEach((c) => c.destroy());
    for (const l of this.lamps) {
      l.g = new Graphics().rect(l.x - 1.3, l.y - 1.3, 2.6, 2.6).fill(0xffffff);
      this.lampLayer.addChild(l.g);
    }

    // Boxes that left the building: finished ones are loaded on the truck,
    // which then drives off; returned and cancelled ones fly away.
    let loaded = false;
    const latest = new Map(boxes.map((b) => [b.key, b]));
    this.sprites.forEach((s, key) => {
      if (alive.has(key) || s.leaving) return;
      s.leaving = true;
      s.gone = 0;
      s.legs = [];
      if (hidden.has(key)) return; // filtered out of view, not gone: it just fades
      const nowIn = latest.get(key); // still open, but in a zone without a room
      const kind = space.zones.find((z) => z.id === (nowIn ?? s.box).zone)?.kind;
      if (CALM) return;
      if (kind === 'returned') {
        s.exit = 'fly';
      } else if (this.truck && kind === 'done') {
        s.exit = 'truck';
        s.tx = this.truck.x + (Math.random() - 0.5) * 14;
        s.ty = this.truck.y - 30;
        this.hop(s, 620, 60);
        loaded = true;
      }
    });
    if (loaded && this.truckRun < 0) this.truckRun = 0;
    const parked = this.truck as { x: number; y: number } | null; // set while the rooms were drawn
    if (loaded && parked) {
      // a small cheer as the box lands on the truck
      const at = { x: this.world.x + parked.x * this.world.scale.x, y: this.world.y + (parked.y - 30) * this.world.scale.y };
      setTimeout(() => this.burst(at.x, at.y, 16), 600);
    }
    if (this.selected && !alive.has(this.selected)) this.mark('');

    const corners = [iso(-PAD, -PAD), iso(width + PAD, -PAD), iso(width + PAD, depth + PAD + 2.4), iso(-PAD, depth + PAD + 2.4)];
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    this.bounds = { x: Math.min(...xs), y: Math.min(...ys) - WALL_H - 46, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) + WALL_H + 60 + snap.spaces.indexOf(space) * STOREY };
    this.refit();
  }

  /** The point on the conveyor a distance s along it (0 = where lane A starts), in screen coordinates. */
  private beltAt(s: number) {
    const { a, b, end } = this.belt!;
    const cross = b - a;
    const g = s <= end ? { gx: s, gy: a } : s <= end + cross ? { gx: end, gy: a + (s - end) } : { gx: end - (s - end - cross), gy: b };
    const p = iso(g.gx, g.gy);
    return { x: p.x, y: p.y - BELT_UP, z: (g.gx + g.gy) * 100 + 60 };
  }

  /** Where the room at this index meets the conveyor, or null if it does not. */
  private station(index: number) {
    if (!this.belt || index < 0) return null;
    const o = roomOrigin(index);
    if (o.row > 1) return null;
    const door = o.gx + 4; // the doorway in the corridor wall
    return { s: o.row === 0 ? door : this.belt.end + (this.belt.b - this.belt.a) + (this.belt.end - door) };
  }

  /** Sends a box from where it stands onto the belt at `from`, along it to `to`, and off to (x, y). */
  private ride(sp: Sprite, from: number, to: number, x: number, y: number) {
    const { a, b, end } = this.belt!;
    const corners = [end, end + (b - a)];
    const stops = [from, ...corners.filter((c) => c > Math.min(from, to) && c < Math.max(from, to)), to];
    if (to < from) stops.sort((p, q) => q - p);
    const legs: Leg[] = [];
    const on = this.beltAt(from);
    const r = sp.root;
    if (Math.hypot(on.x - r.x, on.y - r.y) > 2) legs.push({ x0: r.x, y0: r.y, x1: on.x, y1: on.y, z0: 0, z1: 0, arc: 26, air: true, dur: 340, t: 0 });
    for (let i = 1; i < stops.length; i++) {
      const p = this.beltAt(stops[i - 1]);
      const q = this.beltAt(stops[i]);
      legs.push({ x0: p.x, y0: p.y, x1: q.x, y1: q.y, z0: p.z, z1: q.z, arc: 0, air: false, dur: Math.max(90, (Math.abs(stops[i] - stops[i - 1]) / BELT_SPEED) * 1000), t: 0 });
    }
    const off = this.beltAt(to);
    legs.push({ x0: off.x, y0: off.y, x1: x, y1: y, z0: 0, z1: 0, arc: 30, air: true, dur: 380, t: 0 });
    sp.legs = legs;
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

  /**
   * The packing bench and the sign above it. Both are clicked to write a
   * ticket; under the pointer the bench lights up and the sign fills in.
   */
  private packingBench(gx: number, gy: number) {
    const g = new Graphics();
    g.label = 'prop';
    g.zIndex = (gx + 3 + gy + 0.8) * 100 - 50;
    this.things.addChild(g);
    const sign = new Container();
    const pill = new Graphics();
    const plus = label('+', 15, ACCENT, '700');
    const text = label('송장 쓰기', 12, ACCENT, '700');
    const w = 12 + plus.width + 5 + text.width + 12;
    plus.position.set(12, (26 - plus.height) / 2 - 1);
    text.position.set(12 + plus.width + 5, (26 - text.height) / 2);
    sign.addChild(pill, plus, text);
    const p = iso(gx + 6.2, gy + 0.7); // beside the bench: the room's own sign stands above it
    const y = p.y - 26 - 30;
    sign.position.set(p.x - w / 2, y);
    this.signs.addChild(sign);
    this.bench = { sign, y, gx, gy };
    const draw = (lit: boolean) => {
      g.clear();
      packing(g, gx, gy, lit);
      pill.clear();
      pill.roundRect(0, 0, w, 26, 13).fill(lit ? ACCENT : 0xffffff).stroke({ width: 1.5, color: ACCENT });
      pill.poly([w / 2 - 5, 26, w / 2 + 5, 26, w / 2, 32]).fill(lit ? ACCENT : 0xffffff).stroke({ width: 1.5, color: ACCENT });
      pill.rect(w / 2 - 4, 24, 8, 2.5).fill(lit ? ACCENT : 0xffffff); // the tail joins the pill
      plus.style.fill = text.style.fill = lit ? 0xffffff : ACCENT;
    };
    draw(false);
    for (const part of [g, sign] as Container[]) {
      part.eventMode = 'static';
      part.cursor = 'pointer';
      part.on('pointerover', () => draw(true));
      part.on('pointerout', () => draw(false));
      part.on('pointertap', (e) => {
        e.stopPropagation();
        if (!this.drag?.moved) this.hooks.onWrite?.();
        this.drag = null;
      });
    }
  }

  /** The name plate of a room that holds no tickets: lighter than a room's sign. */
  plate(text: string, gx: number, gy: number) {
    const p = iso(gx, gy);
    const t = label(text, 13, INK, '700');
    const w = t.width + 20;
    const g = new Graphics();
    g.roundRect(0, 0, w, 26, 8).fill(0xffffff).stroke({ width: 1, color: 0xcfd6e2 });
    g.rect(w / 2 - 1.5, 26, 3, 14).fill(0xcfd6e2);
    t.position.set(10, (26 - t.height) / 2);
    const box = new Container();
    box.addChild(g, t);
    box.position.set(p.x - w / 2, p.y - 26 - 14 - 26);
    this.signs.addChild(box);
  }

  /** A small name tag floating above something at a grid position. */
  tag(text: string, gx: number, gy: number, up: number, strong: boolean) {
    const p = iso(gx, gy);
    const t = label(text, 11, strong ? 0xffffff : INK, '600');
    const g = new Graphics();
    g.roundRect(0, 0, t.width + 12, 18, 9).fill(strong ? ACCENT : 0xffffff).stroke({ width: 1, color: strong ? ACCENT : 0xcfd6e2 });
    t.position.set(6, (18 - t.height) / 2);
    const box = new Container();
    box.addChild(g, t);
    box.position.set(p.x - (t.width + 12) / 2, p.y - up);
    this.signs.addChild(box);
    return box;
  }

  /** Redraws one box for its current state. */
  private paint(sp: Sprite, now = this.snap ? Date.parse(this.snap.fetchedAt) : Date.now()) {
    const b = sp.box;
    const chosen = b.key === this.selected;
    drawBox(sp.g, b, sp.hover || chosen, b.assigneeId ? lookOf(b.assigneeId, this.looks).body : null);
    // With a teammate in the spotlight, everyone else's boxes fade back.
    sp.body.alpha = this.spot && b.assigneeId !== this.spot && !chosen ? 0.22 : 1;
    if (chosen) sp.g.ellipse(0, 2, 36, 18).stroke({ width: 2.5, color: ACCENT });
    sp.body.y = chosen ? -8 : sp.hover ? -4 : 0;
    sp.num.text = b.key.split('-').pop() ?? b.key;

    sp.badge?.destroy({ children: true });
    sp.badge = null;
    // Old boxes say how old: the colour gives the step, the badge the time.
    // A box that waits for my approval says so, before anything else.
    // Then a requester who wrote last: a speech bubble, until someone answers.
    const reply = !b.myApproval && !!b.reply;
    const text = b.myApproval ? '승인 요청' : reply ? '요청자 답변' : b.note ? '미정' : ageStep(b) >= 2 && b.staleFrom ? shortAge(now - Date.parse(b.staleFrom)) : '';
    if (text) {
      const t = label(text, 10, reply ? REPLY : 0xffffff, '700');
      const g = new Graphics();
      if (reply) {
        g.roundRect(0, 0, t.width + 10, 16, 8).fill(0xffffff).stroke({ width: 1.5, color: REPLY });
        g.poly([t.width / 2 - 1, 15, t.width / 2 + 7, 15, t.width / 2 + 1, 22]).fill(0xffffff).stroke({ width: 1.5, color: REPLY });
        g.rect(t.width / 2 - 0.5, 13.5, 7, 2.5).fill(0xffffff); // the tail joins the bubble without a seam
      } else g.roundRect(0, 0, t.width + 10, 16, 8).fill(b.myApproval ? ACCENT : b.note ? QUIET : shade(AGE[ageStep(b)], 0.15));
      if (b.myApproval) g.poly([t.width / 2 + 1, 16, t.width / 2 + 9, 16, t.width / 2 + 5, 21]).fill(ACCENT); // points at the box
      t.position.set(5, (16 - t.height) / 2);
      const badge = new Container();
      badge.addChild(g, t);
      badge.position.set(-(t.width + 10) / 2, -BOX_H - 34);
      sp.body.addChild(badge);
      sp.badge = badge;
    }
    // An urgent box carries a turning red light on its lid.
    if (b.urgent && !sp.beacon) {
      sp.beacon = makeBeacon();
      sp.body.addChild(sp.beacon);
    } else if (!b.urgent && sp.beacon) {
      sp.beacon.destroy({ children: true });
      sp.beacon = undefined;
    }
    if (sp.beacon) this.turnBeacon(sp, this.clock / 1000);
  }

  /** Turns an urgent box's light to time T: only the beam's scale and the lamp's glow change. */
  private turnBeacon(sp: Sprite, T: number) {
    const [beam, , glow] = sp.beacon!.children;
    const a = CALM ? 0 : T * 5;
    const front = (Math.sin(a) + 1) / 2; // brighter towards the viewer
    beam.scale.x = Math.cos(a) || 0.001;
    beam.y = (front - 0.5) * 12;
    beam.alpha = 0.16 + front * 0.26;
    glow.alpha = 0.5 + front * 0.45;
  }

  /** An urgent box came in: the edges of the window flash red a few times. */
  alarm() {
    const { width, height } = this.app.screen;
    const g = new Graphics();
    const t = 26;
    g.rect(0, 0, width, t).fill(0xff3b30).rect(0, height - t, width, t).fill(0xff3b30).rect(0, 0, t, height).fill(0xff3b30).rect(width - t, 0, t, height).fill(0xff3b30);
    this.show(g, 1800, (k, c) => (c.alpha = Math.max(0, Math.sin(k * Math.PI * 3)) * 0.35 * (1 - k)), this.fx);
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
    const sp: Sprite = { root, body, g, num, badge: null, box: b, tx: 0, ty: 0, depth: 0, hover: false, leaving: false, legs: [], exit: '', gone: 0, squash: 0, phase: Math.random() * 10 };
    root.on('pointertap', (e) => {
      e.stopPropagation();
      if (this.dropped === sp.box.key) return void (this.dropped = ''); // the end of a drag, not a click
      this.select(sp.box.key);
    });
    root.on('pointerdown', (e) => {
      if (e.button !== 0 || !this.hooks.onDrop) return;
      e.stopPropagation(); // the floor does not pan under a box
      this.carry = { sp, x: e.global.x, y: e.global.y, on: false };
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

  /** Scales and centres the building in the window. */
  /** Throws a handful of confetti from a point in the window. */
  private burst(x: number, y: number, count: number, power = 1) {
    if (CALM) return;
    const colours = [0x3b5bdb, 0xffd166, 0xe56b3c, 0x3f9c63, 0xd9629a, 0xffffff];
    for (let i = 0; i < count; i++) {
      const g = new Graphics().rect(-3, -2, 6, 4).fill(colours[i % colours.length]);
      g.position.set(x, y);
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const v = (0.25 + Math.random() * 0.45) * power;
      this.fx.addChild(g);
      this.bits.push({ g, vx: Math.cos(a) * v, vy: Math.sin(a) * v, spin: (Math.random() - 0.5) * 0.02, life: 900 + Math.random() * 600 });
    }
  }

  /** A celebration across the window: a level gained, a badge earned. */
  celebrate() {
    const { width, height } = this.app.screen;
    for (let i = 1; i <= 5; i++) this.burst((width * i) / 6, height * 0.42, 22, 1.5);
  }

  /** Starts a box on its way to (tx, ty) from where it is now. */
  private hop(sp: Sprite, ms: number, arc: number) {
    if (CALM) {
      sp.legs = [];
      sp.root.position.set(sp.tx, sp.ty);
      return;
    }
    sp.legs = [{ x0: sp.root.x, y0: sp.root.y, x1: sp.tx, y1: sp.ty, z0: 0, z1: 0, arc, air: true, dur: ms, t: 0 }];
  }

  /** Fits again unless the user has set the view themselves. */
  refit() {
    if (!this.held) this.fit();
  }

  private fit() {
    const { width, height } = this.app.screen;
    const free = width;
    this.push = 0;
    const top = 56; // the HUD floats over the top of the window
    const s = Math.min((free - 32) / this.bounds.w, (height - top - 20) / this.bounds.h, 1.5);
    this.world.scale.set(s);
    this.world.position.set((free - this.bounds.w * s) / 2 - this.bounds.x * s, top + (height - top - this.bounds.h * s) / 2 - this.bounds.y * s);
    this.app.stage.hitArea = this.app.screen;
    this.hooks.onZoom?.(s);
    this.reveal();
  }

  private animate(ms: number) {
    this.drawSky(ms);
    const k = 1 - Math.pow(0.002, ms / 1000); // frame-rate independent easing
    const slide = (this.pushTo - this.push) * k;
    this.world.x += slide;
    this.push += slide;
    this.lift.y += (0 - this.lift.y) * k;
    if (Math.abs(this.lift.y) < 0.3) this.lift.y = 0;
    if (this.lift.alpha < 1) this.lift.alpha = Math.min(1, this.lift.alpha + ms / 260);
    this.clock += ms;
    if (this.bench && !CALM) this.bench.sign.y = this.bench.y - Math.abs(Math.sin(this.clock / 520)) * 4;
    for (let i = this.acts.length - 1; i >= 0; i--) {
      const a = this.acts[i];
      a.ms += ms;
      if (a.g.destroyed || a.ms >= a.life) {
        if (!a.g.destroyed) a.g.destroy({ children: true });
        this.acts.splice(i, 1);
      } else a.step(a.ms / a.life, a.g);
    }
    const T = this.clock / 1000;

    this.sprites.forEach((s, key) => {
      const r = s.root;
      const leg = s.legs[0];
      if (leg) {
        // on its way: through the air in an arc, or flat along the belt
        leg.t = Math.min(1, leg.t + ms / leg.dur);
        const e = !leg.air ? leg.t : leg.arc ? easeInOut(leg.t) : leg.t * leg.t; // a drop speeds up as it falls
        r.x = leg.x0 + (leg.x1 - leg.x0) * e;
        r.y = leg.y0 + (leg.y1 - leg.y0) * e - Math.sin(Math.PI * leg.t) * leg.arc;
        r.zIndex = leg.air ? 1e7 : leg.z0 + (leg.z1 - leg.z0) * e;
        if (r.alpha < 1 && !s.leaving) r.alpha = Math.min(1, r.alpha + ms / 200);
        if (s.leaving && s.legs.length === 1 && leg.t > 0.7) r.alpha = Math.max(0, (1 - leg.t) / 0.3);
        if (leg.t >= 1) {
          s.legs.shift();
          if (!s.legs.length && leg.air) s.squash = SQUASH;
        }
        return;
      }
      if (s.leaving) {
        s.gone += ms;
        if (s.exit === 'fly') {
          // sent back: it shoots up and away, spinning
          const v = 0.25 + s.gone * 0.0035;
          r.y -= v * ms;
          r.x += 0.14 * ms;
          s.body.rotation += 0.012 * ms;
          r.zIndex = 1e7;
          r.alpha -= ms / 650;
        } else {
          r.alpha -= ms / 400;
          if (s.exit !== 'truck') r.y -= ms / 20;
        }
        if (r.alpha <= 0) {
          r.destroy({ children: true });
          this.sprites.delete(key);
        }
        return;
      }
      if (s.beacon && !CALM) this.turnBeacon(s, T);
      if (s.held) {
        // carried: above everything, under the pointer
        r.x += (s.held.x - r.x) * Math.min(1, ms / 40);
        r.y += (s.held.y - r.y) * Math.min(1, ms / 40);
        r.zIndex = 1e7;
        r.alpha = 0.9;
        return;
      }
      r.x = s.tx;
      r.y = s.ty;
      if (r.alpha < 1) r.alpha = Math.min(1, r.alpha + ms / 300);
      r.zIndex = s.depth;
      // landing: the box flattens and springs back
      if (s.squash > 0) {
        s.squash = Math.max(0, s.squash - ms);
        const q = Math.sin((s.squash / SQUASH) * Math.PI);
        s.body.scale.set(1 + 0.16 * q, 1 - 0.2 * q);
      } else if (!CALM && s.box.myApproval) {
        // waiting for my approval: it bobs to be noticed
        s.body.rotation = 0;
        s.body.scale.set(1);
        if (!s.hover && s.box.key !== this.selected) s.body.y = -3 - Math.abs(Math.sin(T * 3 + s.phase)) * 5;
      } else if (!CALM && ageStep(s.box) >= 3 && (T + s.phase) % 7 < 0.5) {
        // very old boxes rattle now and then
        s.body.rotation = Math.sin(T * 42) * 0.035;
      } else if (s.body.rotation !== 0 || s.body.scale.x !== 1) {
        s.body.rotation = 0;
        s.body.scale.set(1);
      }
    });

    for (let i = this.bits.length - 1; i >= 0; i--) {
      const b = this.bits[i];
      b.life -= ms;
      b.vy += 0.0011 * ms; // gravity
      b.g.x += b.vx * ms;
      b.g.y += b.vy * ms;
      b.g.rotation += b.spin * ms;
      b.g.alpha = Math.min(1, b.life / 300);
      if (b.life <= 0) {
        b.g.destroy();
        this.bits.splice(i, 1);
      }
    }

    if (CALM) {
      this.belts.forEach((b) => this.drawBelt(b, 0));
      this.belts = []; // drawn once, still
      return;
    }
    // people breathe; the belt runs
    for (const p of this.people) {
      if (p.walk) {
        // a short walk, with a step in it; the name tag comes back on arrival
        const w = p.walk;
        w.t = Math.min(1, w.t + ms / WALK_MS);
        const e = w.t < 0.5 ? 2 * w.t * w.t : 1 - (-2 * w.t + 2) ** 2 / 2;
        p.g.x = w.fx + (p.x - w.fx) * e;
        p.g.y = w.fy + (p.y - w.fy) * e - Math.abs(Math.sin(w.t * Math.PI * 6)) * 3;
        if (w.t >= 1) {
          if (w.tag) w.tag.alpha = 1;
          p.walk = undefined;
        }
        continue;
      }
      p.g.y = p.y + Math.sin(T * (p.slow ? 1.2 : 2.4) + p.phase) * (p.slow ? 2.2 : 1.4);
    }
    // server lamps: each blinks at its own pace. They also say how the team
    // server is doing: all red and in step when it is in trouble, half of
    // them amber when something needs a look.
    this.lamps.forEach((l, i) => {
      if (!l.g) return;
      const fail = this.system === 'fail';
      l.g.tint = fail ? 0xff4d4d : this.system === 'warn' && i % 2 === 0 ? 0xffc145 : l.colour;
      l.g.alpha = (fail ? Math.sin(T * 6) > 0 : Math.sin(T * l.rate + l.phase) > -0.3) ? 1 : 0.25;
    });
    for (const b of this.belts) this.drawBelt(b, T * 1.6);

    // the truck: waits for its load, drives off, comes back empty
    if (this.truck) {
      const g = this.truck.g;
      if (this.truckRun < 0) {
        g.position.set(0, Math.sin(T * 11) * 0.35); // engine idling
        g.alpha = 1;
      } else {
        this.truckRun += ms;
        const t = this.truckRun;
        const away = t < 800 ? 0 : t < 2000 ? Math.pow((t - 800) / 1200, 2) : t < 2700 ? 1 : 1 - easeInOut(Math.min(1, (t - 2700) / 1300));
        const d = away * 15; // tiles along the road
        g.position.set((d * TW) / 2, (d * TH) / 2);
        g.alpha = away > 0.75 ? Math.max(0, 1 - (away - 0.75) * 4) : 1;
        if (t >= 4000) this.truckRun = -1;
      }
    } else {
      this.truckRun = -1;
    }
  }

  /**
   * Slats across one tile of the conveyor, shifted by how far the belt has
   * run. A whole tile's slats are drawn once and slid along (the slide never
   * takes them past the tile's end); a short tile at the end of a lane is
   * drawn afresh, so no slat hangs past the end of the belt.
   */
  private drawBelt(b: BeltTile, run: number) {
    const step = 0.5;
    const shift = (((run * b.dir) % step) + step) % step;
    const whole = Math.abs(b.w / step - Math.round(b.w / step)) < 1e-6;
    if (whole) {
      if (!b.drawn) {
        b.g.clear();
        for (let d = 0; d < b.w - 1e-6; d += step) {
          const [p, q] = b.axis === 'x' ? [iso(b.gx + d, b.gy - 0.4), iso(b.gx + d, b.gy + 0.4)] : [iso(b.gx - 0.4, b.gy + d), iso(b.gx + 0.4, b.gy + d)];
          b.g.moveTo(p.x, p.y - BELT_UP).lineTo(q.x, q.y - BELT_UP).stroke({ width: 1.5, color: 0x9aa3b5, alpha: 0.85 });
        }
        b.drawn = true;
      }
      const o = b.axis === 'x' ? iso(shift, 0) : iso(0, shift);
      b.g.position.set(o.x, o.y);
      return;
    }
    b.g.clear();
    for (let d = shift; d < b.w; d += step) {
      const [p, q] = b.axis === 'x' ? [iso(b.gx + d, b.gy - 0.4), iso(b.gx + d, b.gy + 0.4)] : [iso(b.gx - 0.4, b.gy + d), iso(b.gx + 0.4, b.gy + d)];
      b.g.moveTo(p.x, p.y - BELT_UP).lineTo(q.x, q.y - BELT_UP).stroke({ width: 1.5, color: 0x9aa3b5, alpha: 0.85 });
    }
  }

}

/** An urgent box's light: a beam (turned by scale), the red dome, the glow inside. */
function makeBeacon(): Container {
  const y = -BOX_H - 12;
  const beam = new Graphics().poly([0, y - 4, 39, y - 10, 57, y + 12]).fill(0xff3b30);
  const dome = new Graphics();
  dome.ellipse(0, y + 6, 10, 4.6).fill(0x2f3038);
  dome.roundRect(-7.5, y - 9, 15, 15, 7.5).fill(0xe5383b).stroke({ width: 1, color: 0x9e1f22 });
  const glow = new Graphics().ellipse(-2.5, y - 4.5, 3, 3.8).fill(0xffffff);
  const c = new Container();
  c.addChild(beam, dome, glow);
  return c;
}

/** The colour of a requester's answer waiting on a box. */
const REPLY = 0x0f8a6c;

/** How long my avatar takes to walk to another room. */
const WALK_MS = 900;

/** Members shown in a space (used by the legend). */
export function membersOf(snap: Snapshot, space: string): Member[] {
  return snap.members.filter((m) => m.space === space);
}
