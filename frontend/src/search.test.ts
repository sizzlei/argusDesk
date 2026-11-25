import { describe, expect, it } from 'vitest';
import { search } from './search';
import { box } from './testing';

const boxes = [
  box({ key: 'REQ-12', summary: '주문 테이블 권한 요청', reporter: '김하늘' }),
  box({ key: 'REQ-120', summary: '통계 데이터 추출', type: '데이터 추출', assignee: '이도윤', updated: '2026-11-20T00:00:00Z' }),
  box({ key: 'INT-12', summary: 'REQ-12 후속 점검', type: '[DBA] 점검', updated: '2026-11-21T00:00:00Z' }),
  box({ key: 'INT-7', summary: '권한 정리', reporter: '박서준' }),
];
const keys = (q: string, n?: number) => search(boxes, q, n).map((b) => b.key);

describe('search', () => {
  it('finds nothing for an empty query', () => {
    expect(keys('  ')).toEqual([]);
  });

  it('puts an exact key first, then keys that start with it, then titles', () => {
    expect(keys('req-12')).toEqual(['REQ-12', 'REQ-120', 'INT-12']);
  });

  it('matches the number alone, newest first among equals', () => {
    expect(keys('12')).toEqual(['INT-12', 'REQ-12', 'REQ-120']);
  });

  it('looks in titles, people and types', () => {
    expect(keys('권한')).toEqual(['INT-7', 'REQ-12']); // a title that starts with the word comes first
    expect(keys('이도윤')).toEqual(['REQ-120']);
    expect(keys('dba')).toEqual(['INT-12']);
  });

  it('needs every word', () => {
    expect(keys('권한 김하늘')).toEqual(['REQ-12']);
    expect(keys('권한 없는말')).toEqual([]);
  });

  it('stops at the limit', () => {
    expect(keys('12', 2)).toHaveLength(2);
  });
});
