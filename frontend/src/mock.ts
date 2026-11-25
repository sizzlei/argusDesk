// Made-up data for the prototype. Every name, ticket and status here is
// invented; nothing comes from a real Jira.

import type { Backend } from './backend';
import type { AppState, Away, Badge, BoardEvent, Box, Change, GameStats, Member, PathStep, Snapshot, Tally, Vacation, ZoneView } from './types';

const HOUR = 3600_000;

const zones: Omit<ZoneView, 'count' | 'staleCount'>[] = [
  { id: 'lobby', name: '접수 로비', kind: 'wait' },
  { id: 'security', name: '보안팀 승인', kind: 'siding' },
  { id: 'control', name: '내부통제 승인', kind: 'siding' },
  { id: 'review', name: '검토실', kind: 'work', staleAfter: '3h' },
  { id: 'approval', name: '승인 데스크', kind: 'work', staleAfter: '3h' },
  { id: 'work', name: '작업장', kind: 'desk', staleAfter: '5d' },
  { id: 'dock', name: '출고 도크', kind: 'done' },
  { id: 'returns', name: '반송함', kind: 'returned' },
];

const statusOf: Record<string, [string, string]> = {
  lobby: ['10001', '요청 부서 승인 대기'],
  security: ['10007', '보안팀 승인 요청'],
  control: ['10008', '내부통제 승인 요청'],
  review: ['10002', '검토 중'],
  approval: ['10003', '승인 대기'],
  work: ['10004', '작업 대기'],
  dock: ['10005', '완료'],
  returns: ['10006', '반려'],
};
// A second space: the team's own work, in an ordinary (non service desk) project.
const zones2: Omit<ZoneView, 'count' | 'staleCount'>[] = [
  { id: 'i-wait', name: '대기함', kind: 'wait' },
  { id: 'i-approval', name: '승인 데스크', kind: 'work', approval: true },
  { id: 'i-work', name: '작업장', kind: 'desk' },
  { id: 'i-done', name: '완료함', kind: 'done' },
  { id: 'i-returns', name: '취소함', kind: 'returned' },
];
Object.assign(statusOf, {
  'i-wait': ['20001', '열림'],
  'i-approval': ['20002', '승인 대기'],
  'i-work': ['20003', '업무 진행'],
  'i-done': ['20004', '업무 완료'],
  'i-returns': ['20005', '업무 취소'],
});
const order2 = ['i-wait', 'i-approval', 'i-work', 'i-done'];
const types2: [string, string][] = [
  ['[INT] 내부 업무', 'navy'],
  ['[INT] 작업 계획', 'teal'],
  ['[INT] 정책 승인', 'pink'],
];

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
  add('security', [3, 9, 30, 50]);
  add('control', [5, 12]);
  add('review', [0.3, 1, 2.2, 3.5, 7, 20, 52, 400]);
  add('approval', [0.2, 0.8, 1.6, 2.6, 4.2, 14, 75]);
  add('work', [2, 5, 9, 20, 30, 44, 60, 80, 100, 130, 150, 26, 12]);
  add('dock', [0.5, 1.5, 3, 4.5]);
  add('returns', [2, 6]);
  // The work zone ages from a date on the ticket: spread those dates out.
  boxes.filter((b) => b.zone === 'work').forEach((b, i) => {
    b.staleFrom = new Date(now - [10, 30, 50, 70, 90, 100, 110, 118, 125, 200, 480, 60, 1500][i % 13] * HOUR).toISOString();
    if (i === 4) {
      b.staleFrom = undefined;
      b.note = '일정 미정';
    }
  });
  // the second space
  const inner: [string, number, number][] = [['i-wait', 30, 0], ['i-wait', 200, 1], ['i-approval', 5, 2], ['i-work', 50, 0], ['i-work', 90, 1], ['i-work', 20, 0], ['i-done', 2, 2]];
  inner.forEach(([zone, hours, t], i) => {
    const b = make(zone, hours, now);
    b.space = 'internal';
    b.key = b.key.replace('REQ', 'INT');
    b.url = b.url.replace('REQ', 'INT');
    [b.type, b.tag] = types2[t];
    b.workflow = 'internal';
    b.path = order2.slice(0, order2.indexOf(zone) + 1).map((z, n, all) => ({ statusId: statusOf[z][0], name: statusOf[z][1], state: n === all.length - 1 ? 'current' : 'done' }));
    if (zone === 'i-work') [b.assigneeId, b.assignee] = people[i % people.length];
    b.mine = b.assigneeId === 'u1';
    boxes.push(b);
  });
  return boxes;
}

function snapshot(boxes: Box[], now: number): Snapshot {
  boxes.forEach((b) => age(b, now));
  const view = (list: typeof zones): ZoneView[] =>
    list.map((z) => ({
      ...z,
      count: boxes.filter((b) => b.zone === z.id).length,
      staleCount: boxes.filter((b) => b.zone === z.id && b.stale).length,
    }));
  const zv = view(zones);
  const members: Member[] = people.flatMap(([id, name]) => {
    const own = boxes.filter((b) => b.assigneeId === id && b.zone === 'work');
    const inner = boxes.filter((b) => b.assigneeId === id && b.zone === 'i-work');
    return [
      { id, name, space: 'requests', zone: own.length ? 'work' : 'review', count: own.length, me: id === 'u1' },
      { id, name, space: 'internal', zone: inner.length ? 'i-work' : 'i-wait', count: inner.length, me: id === 'u1' },
    ];
  });
  return {
    name: '요청 센터 (프로토타입)',
    configVersion: '2026-11-25.1',
    fetchedAt: new Date(now).toISOString(),
    spaces: [
      { id: 'requests', name: '요청 센터', project: 'REQ', zones: zv },
      { id: 'internal', name: '내부 사무동', project: 'INT', zones: view(zones2) },
    ],
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
    notify: true,
    notifyProblem: '프로토타입에서는 알림을 보내지 않습니다',
  };

  let stamp = 0; // makes every change from the panel a new "updated" time
  const written = new Map<string, { author: string; created: string; bodyHtml: string; internal: boolean }[]>();
  const zoneOfStatus = (id: string) => Object.keys(statusOf).find((z) => statusOf[z][0] === id) ?? '';
  const find = (key: string) => {
    const b = boxes.find((x) => x.key === key);
    if (!b) throw new Error(`${key}: 티켓을 찾을 수 없습니다`);
    return b;
  };
  const pause = () => new Promise((r) => setTimeout(r, 300));
  /** Tells the screen about a change made from the panel. */
  const publish = (changes: Change[]) => {
    const snap = snapshot(boxes, now);
    listeners.forEach((cb) => cb({ snapshot: snap, changes }));
  };
  const move = (b: Box, to: string) => {
    const from = b.zone;
    place(b, to, now);
    publish([{ kind: 'moved', key: b.key, fromZone: from, toZone: to }]);
  };

  // The game: made-up totals that grow as boxes are shipped.
  const gameListeners: ((s: GameStats) => void)[] = [];
  const counts = { team: 498, me: 98, teamToday: 6, meToday: 3 }; // just short of a level and a badge, to show them
  const tally = (done: number, today: number, scale: number): Tally => {
    const xp = done * 10;
    let level = 1;
    let from = 0;
    while (xp >= from + 100 * level * scale) from += 100 * level++ * scale;
    return { done, today, week: today + 9, xp, level, levelXp: from, nextXp: from + 100 * level * scale };
  };
  const day = (offset: number) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);
  const vacation: Vacation = { from: '', to: '', shared: true };
  const away = (): Away[] => {
    const list: Away[] = [{ id: 'u4', name: '최지우', from: day(-1), to: day(2), active: true, me: false }];
    if (vacation.from) list.push({ id: 'u1', name: '김하늘', from: vacation.from, to: vacation.to, active: vacation.from <= day(0) && vacation.to >= day(0), me: true });
    return list;
  };
  const chosen: Record<string, number> = { u2: 1, u3: 4 };
  const game = (): GameStats => {
    const b = (id: string, name: string, desc: string, scope: 'me' | 'team', have: number, need: number): Badge => ({ id, name, desc, scope, have: Math.min(have, need), need, earned: have >= need });
    return {
      since: '2026-01-01T00:00:00+09:00',
      fatigue: { u1: counts.meToday > 4 ? 1 : 0, u2: 1, u3: 2 }, // one teammate tired, one resting, to show both
      myFatigue: Math.min(100, 30 + counts.meToday * 6),
      avatars: { ...chosen },
      away: away(),
      team: tally(counts.team, counts.teamToday, 4),
      me: tally(counts.me, counts.meToday, 1),
      badges: [
        b('first', '첫 출고', '상자 하나를 끝까지 보냈다', 'me', counts.me, 1),
        b('done-50', '출고 50', '시즌에 상자 50개 출고', 'me', counts.me, 50),
        b('done-100', '출고 100', '시즌에 상자 100개 출고', 'me', counts.me, 100),
        b('done-300', '출고 300', '시즌에 상자 300개 출고', 'me', counts.me, 300),
        b('day-5', '바쁜 하루', '하루에 5개 출고', 'me', counts.meToday, 5),
        b('day-10', '불타는 하루', '하루에 10개 출고', 'me', counts.meToday, 10),
        b('streak-5', '꾸준함', '5일(근무일) 연속 출고', 'me', 5, 5),
        b('fast-10', '번개 처리', '접수 1시간 안에 끝낸 상자 10개', 'me', 4, 10),
        b('types', '유형 수집가', '모든 요청 유형을 한 번씩 출고', 'me', 4, 5),
        b('team-500', '팀 출고 500', '시즌에 팀이 상자 500개 출고', 'team', counts.team, 500),
        b('team-1000', '팀 출고 1000', '시즌에 팀이 상자 1000개 출고', 'team', counts.team, 1000),
        b('team-day-20', '팀 대목', '팀이 하루에 20개 출고', 'team', counts.teamToday, 20),
      ],
    };
  };
  const finish = (mine: boolean) => {
    counts.team++;
    counts.teamToday++;
    if (mine) {
      counts.me++;
      counts.meToday++;
    }
    const s = game();
    gameListeners.forEach((cb) => cb(s));
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
    } else if (roll < 8) {
      const sidings = ['security', 'control'];
      const movable = boxes.filter((b) => (order.indexOf(b.zone) >= 0 && b.zone !== 'dock') || sidings.includes(b.zone));
      const b = movable[rand(movable.length)];
      if (b) {
        const from = b.zone;
        // From the lobby some boxes turn off to another team's approval first.
        const to = sidings.includes(b.zone)
          ? 'review'
          : b.zone === 'lobby' && rand(3) === 0
            ? sidings[rand(2)]
            : b.zone === 'approval' && rand(6) === 0
              ? 'returns'
              : order[order.indexOf(b.zone) + 1];
        place(b, to, now);
        changes.push({ kind: 'moved', key: b.key, fromZone: from, toZone: to });
      }
    } else {
      const done = boxes.findIndex((b) => b.zone === 'dock');
      if (done >= 0) {
        const gone = boxes.splice(done, 1)[0];
        changes.push({ kind: 'removed', key: gone.key, fromZone: 'dock' });
        finish(gone.assigneeId === 'u1' || rand(2) === 0);
      }
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
    setNotify: async (on) => {
      state.notify = on;
      return state;
    },
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
          ...(written.get(key) ?? []),
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
    ticketActions: async (key) => {
      await pause();
      const b = find(key);
      const at = order.indexOf(b.zone);
      const transitions = [];
      const at2 = order2.indexOf(b.zone);
      if (at2 >= 0 && at2 + 1 < order2.length) {
        const [id, name] = statusOf[order2[at2 + 1]];
        transitions.push({ id: `to-${id}`, name: b.zone === 'i-approval' ? '내부업무 승인' : name, toId: id, toName: name, toKind: 'work', needs: [] });
        if (b.zone === 'i-approval') transitions.push({ id: 'to-20005', name: '승인 취소', toId: '20005', toName: '업무 취소', toKind: 'returned', needs: [] });
      }
      if (at >= 0 && at + 1 < order.length && b.zone !== 'approval') {
        const [id, name] = statusOf[order[at + 1]];
        transitions.push({ id: `to-${id}`, name: `${name}(으)로`, toId: id, toName: name, toKind: '', needs: [] });
      }
      if (b.zone === 'review') transitions.push({ id: 'to-10006', name: '반려', toId: '10006', toName: '반려', toKind: 'returned', needs: ['반려 사유'] });
      if (b.zone === 'lobby') transitions.push({ id: 'to-10006', name: '요청 취소', toId: '10006', toName: '반려', toKind: 'returned', needs: [] });
      if (b.zone !== 'lobby' && b.zone !== 'dock' && b.zone !== 'returns' && b.space === 'requests' && !transitions.some((t) => t.toKind === 'returned')) {
        transitions.push({ id: 'to-10006', name: '작업 요청 취소', toId: '10006', toName: '반려', toKind: 'returned', needs: [] });
      }
      const approvals =
        b.zone === 'approval'
          ? [{ id: 'a1', name: 'DBA 승인', canAnswer: true, approvers: [{ id: 'u1', name: '김하늘', decision: 'pending' }, { id: 'u3', name: '박서준', decision: 'pending' }] }]
          : [];
      return { key, transitions, approvals, serviceDesk: b.space === 'requests', approvalsError: '' };
    },
    moveTicket: async (key, id) => {
      await pause();
      move(find(key), zoneOfStatus(id.replace('to-', '')));
    },
    assignTicket: async (key, account) => {
      await pause();
      const b = find(key);
      const id = account === 'me' ? 'u1' : account;
      [b.assigneeId, b.assignee] = people.find((p) => p[0] === id) ?? ['', ''];
      b.mine = b.assigneeId === 'u1';
      b.updated = new Date(now + ++stamp).toISOString();
      publish([{ kind: 'updated', key }]);
    },
    answerApproval: async (key, _id, approve) => {
      await pause();
      move(find(key), approve ? 'work' : 'returns');
    },
    addComment: async (key, text, mode) => {
      await pause();
      const b = find(key);
      const body = document.createElement('p');
      body.textContent = text;
      written.set(key, [...(written.get(key) ?? []), { author: '김하늘', created: new Date(now).toISOString(), bodyHtml: body.outerHTML, internal: mode === 'internal' }]);
      b.updated = new Date(now + ++stamp).toISOString();
      publish([{ kind: 'updated', key }]);
    },
    openUrl: (url) => console.info('open', url),
    onBoard: (cb) => void listeners.push(cb),
    onError: () => {},
    gameStats: async () => game(),
    setAvatar: async (look) => {
      await pause();
      chosen.u1 = look;
      const s = game();
      gameListeners.forEach((cb) => cb(s));
    },
    myVacation: async () => ({ ...vacation }),
    setVacation: async (from, to) => {
      await pause();
      vacation.from = from;
      vacation.to = to;
      const s = game();
      gameListeners.forEach((cb) => cb(s));
      return { ...vacation };
    },
    onGame: (cb) => void gameListeners.push(cb),
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
