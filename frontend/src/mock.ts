// Made-up data for the prototype. Every name, ticket and status here is
// invented; nothing comes from a real Jira.

import type { Backend } from './backend';
import type { AppState, BoardEvent, Box, Change, Member, PathStep, Snapshot, ZoneView } from './types';

const HOUR = 3600_000;

const zones: Omit<ZoneView, 'count' | 'staleCount'>[] = [
  { id: 'lobby', name: '접수 로비', kind: 'wait' },
  { id: 'review', name: '검토실', kind: 'work', staleAfter: '3h' },
  { id: 'approval', name: '승인 데스크', kind: 'work', staleAfter: '3h' },
  { id: 'work', name: '작업장', kind: 'desk', staleAfter: '5d' },
  { id: 'dock', name: '출고 도크', kind: 'done' },
  { id: 'returns', name: '반송함', kind: 'returned' },
];

const statusOf: Record<string, [string, string]> = {
  lobby: ['10001', '요청 부서 승인 대기'],
  review: ['10002', '검토 중'],
  approval: ['10003', '승인 대기'],
  work: ['10004', '작업 대기'],
  dock: ['10005', '완료'],
  returns: ['10006', '반려'],
};
const order = ['lobby', 'review', 'approval', 'work', 'dock'];

const types: [string, string][] = [
  ['[REQ] 스키마 변경', 'green'],
  ['[REQ] 계정 요청', 'orange'],
  ['[REQ] 데이터 추출', 'purple'],
  ['[REQ] 성능 분석', 'blue'],
  ['[REQ] 기타', 'gray'],
];
const people: [string, string][] = [
  ['u1', '김하늘'],
  ['u2', '이도윤'],
  ['u3', '박서준'],
  ['u4', '최지우'],
];
const reporters = ['정민서', '한지호', '오세린', '류태양', '문가은'];
const summaries = [
  '주문 통계 테이블에 인덱스 추가',
  '신규 배치 계정 발급',
  '지난달 정산 데이터 추출',
  '느린 조회 쿼리 원인 분석',
  '테스트 환경 스키마 동기화',
  '읽기 전용 계정 권한 추가',
  '상품 테이블 컬럼 타입 변경',
  '로그 테이블 파티션 추가',
  '임시 데이터베이스 생성',
  '쿠폰 이력 데이터 보정',
  '대시보드용 뷰 생성',
  '오래된 계정 정리',
];

let seq = 100;
let rnd = 7;
function rand(n: number) {
  rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; // fixed seed: the prototype looks the same every time
  return (rnd >>> 9) % n; // the low bits of this generator repeat too quickly
}

function path(zone: string): PathStep[] {
  const at = order.indexOf(zone);
  if (at < 0) return [{ statusId: statusOf[zone][0], name: statusOf[zone][1], state: 'current' }];
  const steps: PathStep[] = order.slice(0, at + 1).map((z, i) => ({
    statusId: statusOf[z][0],
    name: statusOf[z][1],
    state: i === at ? 'current' : 'done',
  }));
  if (at + 1 < order.length) steps.push({ statusId: statusOf[order[at + 1]][0], name: statusOf[order[at + 1]][1], state: 'next' });
  if (zone === 'approval') steps.push({ statusId: '10006', name: '반려', state: 'next' });
  return steps;
}

function place(b: Box, zone: string, now: number) {
  b.zone = zone;
  [b.statusId, b.status] = statusOf[zone];
  b.path = path(zone);
  b.updated = new Date(now).toISOString();
  b.enteredAt = new Date(now).toISOString();
  b.staleFrom = undefined;
  b.staleRatio = 0;
  b.stale = false;
  b.note = undefined;
  if (zone === 'work' && !b.assigneeId && rand(4) > 0) [b.assigneeId, b.assignee] = people[rand(people.length)];
  b.mine = b.assigneeId === 'u1';
}

function make(zone: string, ageHours: number, now: number): Box {
  const [type, tag] = types[rand(types.length)];
  const created = now - ageHours * HOUR - rand(48) * HOUR;
  const b: Box = {
    key: `REQ-${++seq}`,
    summary: summaries[rand(summaries.length)],
    type,
    tag,
    statusId: '',
    status: '',
    priority: rand(6) === 0 ? 'High' : 'Medium',
    assigneeId: '',
    assignee: '',
    reporter: reporters[rand(reporters.length)],
    created: new Date(created).toISOString(),
    updated: '',
    url: `https://example.atlassian.net/browse/REQ-${seq}`,
    space: 'requests',
    zone,
    workflow: 'standard',
    mine: false,
    staleRatio: 0,
    stale: false,
  };
  place(b, zone, now - ageHours * HOUR);
  return b;
}

function age(b: Box, now: number) {
  const limit = b.zone === 'work' ? 120 : b.zone === 'review' || b.zone === 'approval' ? 3 : 0;
  if (!limit || b.note) return;
  const from = b.zone === 'work' ? Date.parse(b.staleFrom ?? b.enteredAt!) : Date.parse(b.enteredAt!);
  b.staleFrom = new Date(from).toISOString();
  b.staleRatio = Math.max(0, (now - from) / (limit * HOUR));
  b.stale = b.staleRatio >= 1;
}

function seed(now: number): Box[] {
  const boxes: Box[] = [];
  const add = (zone: string, hours: number[]) => hours.forEach((h) => boxes.push(make(zone, h, now)));
  add('lobby', [1, 3, 6, 20, 30, 52, 70]);
  add('review', [0.3, 1, 2.2, 3.5, 5]);
  add('approval', [0.2, 0.8, 1.6, 2.6, 4.2, 7]);
  add('work', [2, 5, 9, 20, 30, 44, 60, 80, 100, 130, 150, 26, 12]);
  add('dock', [0.5, 1.5, 3, 4.5]);
  add('returns', [2, 6]);
  // The work zone ages from a date on the ticket: spread those dates out.
  boxes.filter((b) => b.zone === 'work').forEach((b, i) => {
    b.staleFrom = new Date(now - [10, 30, 50, 70, 90, 100, 110, 118, 125, 140, 160, 60, 20][i % 13] * HOUR).toISOString();
    if (i === 4) {
      b.staleFrom = undefined;
      b.note = '일정 미정';
    }
  });
  return boxes;
}

function snapshot(boxes: Box[], now: number): Snapshot {
  boxes.forEach((b) => age(b, now));
  const zv: ZoneView[] = zones.map((z) => ({
    ...z,
    count: boxes.filter((b) => b.zone === z.id).length,
    staleCount: boxes.filter((b) => b.zone === z.id && b.stale).length,
  }));
  const members: Member[] = people.map(([id, name]) => {
    const own = boxes.filter((b) => b.assigneeId === id && b.zone === 'work');
    return { id, name, space: 'requests', zone: own.length ? 'work' : 'review', count: own.length, me: id === 'u1' };
  });
  return {
    name: '요청 센터 (프로토타입)',
    configVersion: '2026-11-25.1',
    fetchedAt: new Date(now).toISOString(),
    spaces: [{ id: 'requests', name: '요청 센터', zones: zv }],
    boxes: boxes.map((b) => ({ ...b })),
    members,
    warnings: [],
  };
}

export function mockBackend(): Backend {
  let now = Date.now();
  const boxes = seed(now);
  let listeners: ((ev: BoardEvent) => void)[] = [];
  const state: AppState = {
    version: '0.1.0',
    configPath: '(프로토타입: 가짜 데이터)',
    configName: '요청 센터',
    configVersion: '2026-11-25.1',
    configError: '',
    configLoaded: true,
    usingLastGood: false,
    site: 'example.atlassian.net',
    email: 'me@example.com',
    signedIn: true,
    me: '김하늘',
    authError: '',
    pollSeconds: 60,
  };

  // Every few seconds something happens, as it would over a working day.
  function tick() {
    now += 20 * 60_000;
    const changes: Change[] = [];
    const roll = rand(10);
    if (roll < 3) {
      const b = make(rand(3) === 0 ? 'review' : 'lobby', 0, now);
      boxes.push(b);
      changes.push({ kind: 'added', key: b.key, toZone: b.zone });
    } else if (roll < 9) {
      const movable = boxes.filter((b) => order.indexOf(b.zone) >= 0 && b.zone !== 'dock');
      const b = movable[rand(movable.length)];
      if (b) {
        const from = b.zone;
        const to = b.zone === 'approval' && rand(6) === 0 ? 'returns' : order[order.indexOf(b.zone) + 1];
        place(b, to, now);
        changes.push({ kind: 'moved', key: b.key, fromZone: from, toZone: to });
      }
    } else {
      const done = boxes.findIndex((b) => b.zone === 'dock');
      if (done >= 0) changes.push({ kind: 'removed', key: boxes.splice(done, 1)[0].key, fromZone: 'dock' });
    }
    const snap = snapshot(boxes, now);
    listeners.forEach((cb) => cb({ snapshot: snap, changes }));
  }
  setInterval(tick, 3500);

  const nothing = async () => state;
  return {
    mock: true,
    state: async () => state,
    chooseConfig: nothing,
    reloadConfig: nothing,
    login: nothing,
    logout: nothing,
    snapshot: async () => snapshot(boxes, now),
    refresh: async () => tick(),
    ticketDetail: async (key) => {
      await new Promise((r) => setTimeout(r, 350));
      const b = boxes.find((x) => x.key === key);
      return {
        key,
        // The script, handler and image below are here to show they are removed.
        descriptionHtml: `<p>안녕하세요. <b>${b?.summary ?? ''}</b> 요청드립니다.</p>
<h3>대상</h3><ul><li>환경: 운영</li><li>데이터베이스: <code>sample_db</code></li></ul>
<pre>ALTER TABLE sample_order ADD INDEX idx_created_at (created_at);</pre>
<table><tr><th>항목</th><th>값</th></tr><tr><td>예상 행 수</td><td>1,200만</td></tr><tr><td>희망 시간</td><td>업무 시간 외</td></tr></table>
<p onclick="alert(1)">참고 문서: <a href="https://example.com/doc">설계 문서</a> <img src="x" alt="구성도"></p><script>alert(1)</script>`,
        comments: [
          { author: '박서준', created: new Date(now - 5 * HOUR).toISOString(), bodyHtml: '<p>영향 범위 확인 부탁드립니다.</p>', internal: false },
          { author: '김하늘', created: new Date(now - 2 * HOUR).toISOString(), bodyHtml: '<p>인덱스 크기 추정 후 진행 예정.</p>', internal: true },
        ],
        attachments: 1,
        forms: [
          {
            name: '스키마 변경 요청서',
            submitted: true,
            answers: [
              { label: '작업 구분', value: 'DDL 배포 요청' },
              { label: '대상 데이터베이스', value: 'sample_db, sample_db_stage' },
              { label: '작업 완료 요청일시', value: '2026-12-03 11:00' },
              { label: '개인정보 컬럼 포함 여부', value: '미포함' },
              { label: '요청 사유', value: '주문 통계 조회가 느려 created_at 조건에 인덱스가 필요합니다.\n배포 전날까지 스테이지에 먼저 반영 부탁드립니다.' },
              { label: '실행할 SQL', value: 'ALTER TABLE sample_order\n  ADD INDEX idx_created_at (created_at);\n\nALTER TABLE sample_order_item\n  ADD COLUMN memo VARCHAR(200) NULL;' },
              { label: '비고', value: '' },
            ],
          },
        ],
        formsError: '',
      };
    },
    openUrl: (url) => console.info('open', url),
    onBoard: (cb) => void listeners.push(cb),
    onError: () => {},
    checkUpdate: async () => ({
      current: '0.1.0',
      available: false,
      supported: false,
      release: { version: '0.1.0', tag: 'v0.1.0', name: '', notes: '', notesHtml: '', url: '', published: '', assetName: '', assetUrl: '', assetSize: 0 },
    }),
    lastUpdateCheck: async () => Date.now(),
    releaseNotes: async () => {
      throw new Error('프로토타입에는 릴리스가 없습니다');
    },
    notesToShow: async () => '',
    installUpdate: async () => {},
    restartApp: async () => {},
    onUpdateProgress: () => {},
  };
}
