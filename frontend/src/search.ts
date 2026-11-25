// Finding a box among the open ones: by key, title, people or type.

import type { Box } from './types';

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** How well a box answers the words: 0 = not at all, higher = better. */
function score(b: Box, words: string[]): number {
  const key = b.key.toLowerCase();
  const num = key.split('-').pop() ?? '';
  const title = norm(b.summary);
  const rest = norm(`${b.reporter} ${b.assignee} ${b.type} ${b.status}`);
  let total = 0;
  for (const w of words) {
    let s = 0;
    if (key === w || num === w) s = 100;
    else if (key.startsWith(w) || num.startsWith(w)) s = 60;
    else if (key.includes(w)) s = 40;
    else if (title.includes(w)) s = title.startsWith(w) ? 30 : 20;
    else if (rest.includes(w)) s = 10;
    if (!s) return 0; // every word has to be found somewhere
    total += s;
  }
  return total;
}

/** The boxes that match the query, best first; ties go to the most recently updated. */
export function search(boxes: Box[], query: string, limit = 12): Box[] {
  const words = norm(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  return boxes
    .map((b) => ({ b, s: score(b, words) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s || y.b.updated.localeCompare(x.b.updated))
    .slice(0, limit)
    .map((x) => x.b);
}
