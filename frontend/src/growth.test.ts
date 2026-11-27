import { describe, expect, it } from 'vitest';
import { arrived, nextItem, seasonItems, seasonYear, unlocked, yardSlot } from './growth';

describe('growth', () => {
  it('gives each season its own things', () => {
    expect(seasonItems(2026).map((i) => i.id)).not.toEqual(seasonItems(2027).map((i) => i.id));
  });

  it('unlocks by the centre level', () => {
    expect(unlocked(1, 2026)).toEqual([]);
    expect(unlocked(7, 2026).map((i) => i.id)).toEqual(['sign', 'planters', 'coffee', 'led', 'fountain', 'lamps']);
  });

  it('says what a level-up brought', () => {
    expect(arrived(7, 8, 2026).map((i) => i.id)).toEqual(['floor']);
    expect(arrived(8, 9, 2026)).toEqual([]);
    expect(nextItem(8, 2026)?.id).toBe('cat');
    expect(nextItem(12, 2026)).toBeNull();
  });

  it('keeps a yard thing in its place', () => {
    expect(yardSlot('sign', 2026)).toBe(0);
    expect(yardSlot('arch', 2026)).toBe(5);
    expect(yardSlot('led', 2026)).toBe(-1);
  });

  it('takes the season from its start', () => {
    expect(seasonYear('2026-01-01T00:00:00+09:00')).toBe(2026);
    expect(seasonYear(undefined, new Date(2027, 2, 1))).toBe(2027);
  });
});
