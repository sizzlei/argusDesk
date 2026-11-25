// Which boxes the room shows. The filter narrows the snapshot before it is
// drawn, so the rooms, the signs and the counters all agree.

import type { Box, Snapshot } from './types';

export type Scope = 'all' | 'mine' | 'unassigned';

export interface Filter {
  scope: Scope; // whose boxes
  staleOnly: boolean; // only boxes past their limit
  types: string[]; // request types to keep; none = every type
}

export const NO_FILTER: Filter = { scope: 'all', staleOnly: false, types: [] };

const KEY = 'argusdesk.filter';

/** The filter kept from last time, or none. */
export function loadFilter(): Filter {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Filter> | null;
    if (!raw) return { ...NO_FILTER };
    return {
      scope: raw.scope === 'mine' || raw.scope === 'unassigned' ? raw.scope : 'all',
      staleOnly: raw.staleOnly === true,
      types: Array.isArray(raw.types) ? raw.types.filter((t) => typeof t === 'string') : [],
    };
  } catch {
    return { ...NO_FILTER };
  }
}

export function saveFilter(f: Filter) {
  try {
    localStorage.setItem(KEY, JSON.stringify(f));
  } catch {
    // no storage: the filter lasts until the app closes
  }
}

/** Mine: I hold it, or it waits for my approval. */
export const isMine = (b: Box) => b.mine || !!b.myApproval;

/** How many conditions beyond the scope are on (shown on the filter button). */
export const extraCount = (f: Filter) => Number(f.staleOnly) + f.types.length;

export const filtering = (f: Filter) => f.scope !== 'all' || extraCount(f) > 0;

/** The request types found in one space, in name order. */
export function typesIn(snap: Snapshot, space: string): { name: string; tag: string }[] {
  const seen = new Map<string, string>();
  for (const b of snap.boxes) if (b.space === space) seen.set(b.type, b.tag);
  return [...seen].sort(([a], [b]) => a.localeCompare(b, 'ko')).map(([name, tag]) => ({ name, tag }));
}

/**
 * The snapshot as the filter shows it, and the keys it hides. Zone counts are
 * counted again from what is left. A type filter only applies on floors that
 * have one of the chosen types: the other floors do not go empty because of it.
 */
export function applyFilter(snap: Snapshot, f: Filter): { snap: Snapshot; hidden: Set<string> } {
  const hidden = new Set<string>();
  if (!filtering(f)) return { snap, hidden };
  const chosen = new Set(f.types);
  const typed = new Set(snap.boxes.filter((b) => chosen.has(b.type)).map((b) => b.space)); // floors the type filter applies to
  const keep = (b: Box) =>
    (f.scope === 'all' || (f.scope === 'mine' ? isMine(b) : !b.assigneeId)) &&
    (!f.staleOnly || b.stale) &&
    (!typed.has(b.space) || chosen.has(b.type));
  const boxes = snap.boxes.filter((b) => keep(b) || (hidden.add(b.key), false));
  const spaces = snap.spaces.map((sp) => ({
    ...sp,
    zones: sp.zones.map((z) => {
      const here = boxes.filter((b) => b.space === sp.id && b.zone === z.id);
      return { ...z, count: here.length, staleCount: here.filter((b) => b.stale).length };
    }),
  }));
  return { snap: { ...snap, spaces, boxes }, hidden };
}
