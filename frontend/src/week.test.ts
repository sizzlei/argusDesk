import { describe, expect, it } from 'vitest';
import type { Box, Snapshot } from './types';
import { monday, weekDeploys } from './week';

const box = (key: string, zone: string, deploy: string, extra: Partial<Box> = {}) => ({ key, zone, space: 'dt', deploy, summary: key, mine: false, ...extra }) as Box;
const snap = (boxes: Box[]) =>
  ({
    boxes,
    spaces: [{ id: 'dt', zones: [{ id: 'work', kind: 'desk' }, { id: 'dock', kind: 'done' }, { id: 'back', kind: 'returned' }] }],
  }) as unknown as Snapshot;

describe('week board', () => {
  const now = new Date(2026, 10, 27, 9); // Friday 27 November 2026

  it('starts the week on Monday', () => {
    expect(monday(now).getDate()).toBe(23);
    expect(monday(now, 1).getDate()).toBe(30);
  });

  it('puts deployments on their days, by hour, whole-day ones last', () => {
    const days = weekDeploys(
      snap([
        box('A', 'work', '2026-11-27'),
        box('B', 'work', new Date(2026, 10, 27, 14).toISOString()),
        box('C', 'dock', new Date(2026, 10, 24, 10).toISOString()),
        box('D', 'back', '2026-11-25'),
        box('E', 'work', '2026-12-01'),
      ]),
      0,
      now,
    );
    expect(days[4].slots.map((s) => [s.box.key, s.time])).toEqual([['B', '14:00'], ['A', '']]);
    expect(days[4].today).toBe(true);
    expect(days[1].slots[0].done).toBe(true); // finished, still on the board
    expect(days[2].slots).toEqual([]); // cancelled: off the board
    expect(days.flatMap((d) => d.slots).some((s) => s.box.key === 'E')).toBe(false); // next week
  });

  it('marks two open ones in the same hour, and unsettled dates', () => {
    const days = weekDeploys(
      snap([
        box('A', 'work', new Date(2026, 10, 26, 14).toISOString()),
        box('B', 'work', new Date(2026, 10, 26, 14, 30).toISOString(), { note: '일정 미정' }),
        box('C', 'dock', new Date(2026, 10, 26, 14).toISOString()),
      ]),
      0,
      now,
    );
    expect(days[3].slots.map((s) => [s.box.key, s.clash, s.unsure])).toEqual([['A', true, false], ['C', false, false], ['B', true, true]]);
  });

  it('shows only mine when asked', () => {
    const days = weekDeploys(snap([box('A', 'work', '2026-11-27', { mine: true }), box('B', 'work', '2026-11-27')]), 0, now, true);
    expect(days[4].slots.map((s) => s.box.key)).toEqual(['A']);
  });
});
