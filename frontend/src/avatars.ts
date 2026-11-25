// The looks an avatar can have. A teammate picks one; until they do, one is
// given to them from their account id, so it is the same on every computer.

import { h } from './ui';

export type Hair = 'short' | 'tall' | 'side' | 'cap';

export interface Look {
  body: number; // colour of the clothes
  hair: number;
  style: Hair;
}

export const LOOKS: Look[] = [
  { body: 0x4f6fd6, hair: 0x2b3550, style: 'short' },
  { body: 0xe0704f, hair: 0x5a3825, style: 'tall' },
  { body: 0x3f9c63, hair: 0x1f2a44, style: 'side' },
  { body: 0xa85fc4, hair: 0x3a2a4a, style: 'short' },
  { body: 0xc79a2a, hair: 0x6b4a2a, style: 'cap' },
  { body: 0x2f9a9a, hair: 0x22313a, style: 'tall' },
  { body: 0xd9629a, hair: 0x4a2a35, style: 'side' },
  { body: 0x5d6b7e, hair: 0xb9a27a, style: 'short' },
  { body: 0xf08c3a, hair: 0x2b2b2b, style: 'cap' },
  { body: 0x34477f, hair: 0xc9b38a, style: 'tall' },
  { body: 0x8ab04a, hair: 0x4a3a2a, style: 'side' },
  { body: 0xc7352f, hair: 0x1f1f2a, style: 'cap' },
];

/** The look of an account: the one chosen, or one that follows from the id. */
export function lookOf(id: string, chosen: Record<string, number>): Look {
  const pick = chosen[id];
  if (pick !== undefined && LOOKS[pick]) return LOOKS[pick];
  let sum = 0;
  for (const ch of id) sum = (sum * 31 + ch.charCodeAt(0)) >>> 0;
  return LOOKS[sum % LOOKS.length];
}

const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** A small picture of a look, for menus and the HUD: head and shoulders. */
export function avatarIcon(look: Look, size = 28) {
  const icon = h('span', { class: `avatar hair-${look.style}`, style: `--body:${css(look.body)};--hair:${css(look.hair)};--size:${size}px`, 'aria-hidden': 'true' });
  icon.append(h('i', { class: 'a-hair' }), h('i', { class: 'a-face' }), h('i', { class: 'a-body' }));
  return icon;
}
