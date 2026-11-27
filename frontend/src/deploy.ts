// Production deployments set for today, read from the field the settings
// name (deploy_field). A date counts for that whole day; a date-time is shown
// with its hour.

import type { Box, Snapshot } from './types';

const dayOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** When a box goes out today: "14:00", "" for a date without an hour, null when not today. */
export function deployToday(b: Box, now = new Date()): string | null {
  const v = b.deploy?.trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v === dayOf(now) ? '' : null;
  const t = new Date(v.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  if (Number.isNaN(t.getTime()) || dayOf(t) !== dayOf(now)) return null;
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
}

/**
 * Today's deployments still to be done, earliest first (those without an hour
 * last). `mine`: only those I hold.
 */
export function deploysToday(snap: Snapshot | null, mine = false): { box: Box; at: string }[] {
  if (!snap) return [];
  // what is already done (or sent back) has nothing left to deploy
  const closed = new Set(snap.spaces.flatMap((sp) => sp.zones.filter((z) => z.kind === 'done' || z.kind === 'returned').map((z) => `${sp.id}/${z.id}`)));
  return snap.boxes
    .filter((box) => !closed.has(`${box.space}/${box.zone}`) && (!mine || box.mine))
    .map((box) => ({ box, at: deployToday(box) }))
    .filter((d): d is { box: Box; at: string } => d.at !== null)
    .sort((a, b) => (a.at || '99') .localeCompare(b.at || '99'));
}

const SHOWN = 'argusdesk.deployDay';
/** True once a day: the first time it is asked on a day with deployments of mine. */
export function deployPopupDue(snap: Snapshot | null): boolean {
  if (!deploysToday(snap, true).length) return false; // only mine bring the card up
  const today = dayOf(new Date());
  try {
    if (localStorage.getItem(SHOWN) === today) return false;
    localStorage.setItem(SHOWN, today);
  } catch {
    return false;
  }
  return true;
}
