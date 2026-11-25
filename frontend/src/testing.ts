// Made-up boxes and snapshots for the tests.

import type { Box, Snapshot } from './types';

export function box(over: Partial<Box> & { key: string }): Box {
  return {
    summary: '',
    type: '권한 요청',
    statusId: '1',
    status: '검토 중',
    priority: 'Medium',
    assigneeId: '',
    assignee: '',
    reporter: '요청자',
    created: '2026-11-01T00:00:00Z',
    updated: '2026-11-01T00:00:00Z',
    url: '',
    space: 'req',
    zone: 'review',
    tag: 'blue',
    workflow: '',
    mine: false,
    staleRatio: 0,
    stale: false,
    ...over,
  };
}

export function snapshot(boxes: Box[]): Snapshot {
  const zone = (id: string, kind: 'wait' | 'desk') => ({ id, name: id, kind, count: 99, staleCount: 99 });
  return {
    name: '시험 센터',
    configVersion: 't',
    fetchedAt: '2026-11-25T00:00:00Z',
    spaces: [
      { id: 'req', name: '요청', project: 'REQ', zones: [zone('review', 'wait'), zone('work', 'desk')] },
      { id: 'int', name: '내부', project: 'INT', zones: [zone('wait', 'wait')] },
    ],
    boxes,
    members: [],
    warnings: [],
  };
}
