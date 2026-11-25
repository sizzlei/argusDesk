import { describe, expect, it } from 'vitest';
import { box } from '../testing';
import type { ZoneView } from '../types';
import { LANE_LEN, LANE_TOP, pallet, palletCols, slots } from './layout';
import { ageStep, shortAge, shortName } from './palette';

const zone = (kind: ZoneView['kind']): ZoneView => ({ id: 'z', name: 'z', kind, count: 0, staleCount: 0 });

describe('slots', () => {
  it('fills a waiting room in a 5 x 3 grid, then stacks', () => {
    const boxes = Array.from({ length: 16 }, (_, i) => box({ key: `K-${i}` }));
    const at = slots(zone('wait'), boxes, [], 7);
    expect(at.get('K-0')).toMatchObject({ level: 0 });
    expect(at.get('K-5')!.gy).toBeGreaterThan(at.get('K-0')!.gy); // second row
    expect(at.get('K-5')!.gx).toBe(at.get('K-0')!.gx);
    expect(at.get('K-15')).toEqual({ ...at.get('K-0')!, level: 1 }); // on top of the first
  });

  it('stands boxes nobody holds on the pallet, the rest beside it', () => {
    const boxes = [
      ...Array.from({ length: 10 }, (_, i) => box({ key: `A-${i}`, assigneeId: 'a' })),
      ...Array.from({ length: 7 }, (_, i) => box({ key: `U-${i}` })),
    ];
    expect(palletCols(7, 17)).toBe(2);
    const P = pallet(2);
    const at = slots(zone('wait'), boxes, [], 7, true);
    const onPallet = (key: string) => {
      const s = at.get(key)!;
      return s.gx > P.gx && s.gx < P.gx + P.w && s.gy > P.gy && s.gy < P.gy + P.d;
    };
    expect(boxes.filter((b) => !b.assigneeId).every((b) => onPallet(b.key))).toBe(true);
    expect(boxes.filter((b) => b.assigneeId).some((b) => onPallet(b.key))).toBe(false);
    expect(at.get('A-9')!.level).toBe(1); // nine fit beside the pallet
    expect(at.get('U-6')!.level).toBe(1); // six fit on it
    // without unassigned boxes the room keeps its whole grid
    expect(slots(zone('wait'), boxes.slice(0, 10), [], 7, true).get('A-9')!.level).toBe(0);
  });

  it('sizes the pallet by the share of boxes nobody holds', () => {
    expect([palletCols(0, 9), palletCols(1, 30), palletCols(5, 10), palletCols(29, 30), palletCols(4, 4)]).toEqual([0, 1, 3, 4, 5]);
    // a room where nobody holds anything keeps its whole grid, as a pallet
    const all = Array.from({ length: 6 }, (_, i) => box({ key: `U-${i}` }));
    expect(slots(zone('wait'), all, [], 7, true)).toEqual(slots(zone('wait'), all, [], 7));
  });

  it('gives each assignee a row in a desk room', () => {
    const boxes = [
      ...Array.from({ length: LANE_LEN + 1 }, (_, i) => box({ key: `A-${i}`, assigneeId: 'a' })),
      box({ key: 'B-0', assigneeId: 'b' }),
    ];
    const at = slots(zone('desk'), boxes, ['a', 'b'], 10);
    expect(at.get('A-0')!.gy).toBe(LANE_TOP);
    expect(at.get('B-0')!.gy).toBeGreaterThan(LANE_TOP);
    expect(at.get('B-0')!.gx).toBe(at.get('A-0')!.gx);
    expect(at.get(`A-${LANE_LEN}`)).toEqual({ ...at.get('A-0')!, level: 1 }); // a full row stacks
  });
});

describe('age and names', () => {
  it('turns how far past the limit a box is into a step', () => {
    const step = (staleRatio: number, note?: string) => ageStep(box({ key: 'K', staleRatio, note }));
    expect([0, 0.4, 0.5, 1, 3, 10].map((r) => step(r))).toEqual([0, 0, 1, 2, 3, 4]);
    expect(step(5, '일정 미정')).toBe(0); // a box with a note is not aged
  });

  it('writes ages short', () => {
    const h = 3600_000;
    expect([0.5 * h, 5 * h, 72 * h, 90 * 24 * h].map(shortAge)).toEqual(['30분', '5시간', '3일', '3달']);
  });

  it('keeps the name before a department', () => {
    expect(shortName('김하늘 데이터플랫폼')).toBe('김하늘');
  });
});
