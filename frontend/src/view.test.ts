import { describe, expect, it } from 'vitest';
import { box, snapshot } from './testing';
import { NO_FILTER, applyFilter, extraCount, filtering, typesIn } from './view';

const snap = snapshot([
  box({ key: 'REQ-1', mine: true, assigneeId: 'me', stale: true }),
  box({ key: 'REQ-2', assigneeId: 'u2', zone: 'work', type: '데이터 추출', tag: 'green' }),
  box({ key: 'REQ-3', myApproval: true, assigneeId: 'u2' }),
  box({ key: 'REQ-4', stale: true }),
  box({ key: 'INT-1', space: 'int', zone: 'wait', type: '[DBA] 점검' }),
]);
const keys = (f: Partial<typeof NO_FILTER>) => applyFilter(snap, { ...NO_FILTER, ...f }).snap.boxes.map((b) => b.key);

describe('applyFilter', () => {
  it('returns the snapshot untouched without a filter', () => {
    const v = applyFilter(snap, NO_FILTER);
    expect(v.snap).toBe(snap);
    expect(v.hidden.size).toBe(0);
  });

  it('keeps what I hold and what waits for my approval', () => {
    expect(keys({ scope: 'mine' })).toEqual(['REQ-1', 'REQ-3']);
  });

  it('keeps boxes nobody holds', () => {
    expect(keys({ scope: 'unassigned' })).toEqual(['REQ-4', 'INT-1']);
  });

  it('combines the conditions', () => {
    expect(keys({ scope: 'unassigned', staleOnly: true })).toEqual(['REQ-4']);
  });

  it('applies a type filter only on floors that have the type', () => {
    expect(keys({ types: ['데이터 추출'] })).toEqual(['REQ-2', 'INT-1']);
  });

  it('counts the zones again and lists what it hides', () => {
    const v = applyFilter(snap, { ...NO_FILTER, staleOnly: true });
    const review = v.snap.spaces[0].zones[0];
    expect([review.count, review.staleCount]).toEqual([2, 2]);
    expect(v.snap.spaces[0].zones[1].count).toBe(0);
    expect([...v.hidden].sort()).toEqual(['INT-1', 'REQ-2', 'REQ-3']);
  });
});

describe('filter helpers', () => {
  it('counts the conditions beyond the scope', () => {
    expect(extraCount({ scope: 'mine', staleOnly: true, types: ['a', 'b'] })).toBe(3);
    expect(filtering({ ...NO_FILTER, scope: 'mine' })).toBe(true);
    expect(filtering(NO_FILTER)).toBe(false);
  });

  it('lists the types of one floor in name order', () => {
    expect(typesIn(snap, 'req')).toEqual([
      { name: '권한 요청', tag: 'blue' },
      { name: '데이터 추출', tag: 'green' },
    ]);
  });
});
