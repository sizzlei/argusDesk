// The moving parts of the scene: boxes on their way and the conveyor.

import { Container, Graphics, Text } from 'pixi.js';
import type { Box } from '../types';

export interface Sprite {
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
  // movement: a box travels in legs (a hop, a ride on the belt, a hop) instead of sliding
  legs: Leg[];
  exit: '' | 'truck' | 'fly'; // how a leaving box goes
  gone: number; // ms since it started leaving
  squash: number; // ms left of the landing squash
  phase: number; // offsets idle motion so boxes do not move in step
}

/** One stretch of a box's way: through the air in an arc, or flat along the belt. */
export interface Leg {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  z0: number; // depth at each end, for boxes riding the belt
  z1: number;
  arc: number; // height of the hop; 0 = flat
  air: boolean; // in the air: drawn above the walls
  dur: number;
  t: number;
}

export interface BeltTile {
  g: Graphics;
  gx: number;
  gy: number;
  w: number; // length along its direction, in tiles
  axis: 'x' | 'y';
  dir: 1 | -1;
}

/** The conveyor: lane A runs along the first row, turns, and lane B runs back along the second. */
export interface Belt {
  a: number; // gy of lane A
  b: number; // gy of lane B
  end: number; // gx of the turn
  entry: number; // where a new box comes onto lane A
}
export const BELT_SPEED = 7; // tiles a second
export const BELT_UP = 7; // the belt's surface above the floor, on screen

// People who would rather not see motion get the changes without the show.
export const CALM = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const SQUASH = 260;
