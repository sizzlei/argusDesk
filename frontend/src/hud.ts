// The bar above the room: what is loaded, how full each zone is, and the
// few commands the app has.

import { keyLabel } from './keys';
import type { Backend } from './backend';
import { avatarIcon, lookOf } from './avatars';
import { gameChip, renderGame } from './game';
import { icon } from './rail';
import { offerUpdate, pendingUpdate } from './update';
import type { AppState, GameStats, Snapshot } from './types';
import { clock, fill, h, toast } from './ui';
import { type Filter, type Scope, extraCount } from './view';

export interface HudHooks {
  refresh(): void;
  settingsOpen: boolean;
  toggleSettings(): void;
  /** Signs in to Argus again, in the browser. */
  argusLogin(): void;
  profileOpen: boolean;
  toggleProfile(): void;
  spot: string; // the teammate whose boxes are lit ("" = everyone's)
  setSpot(id: string): void;
  filter: Filter; // which boxes the room shows
  setFilter(next: Filter): void;
  filtersOpen: boolean;
  toggleFilters(): void;
  search(): void;
  unassigned: { count: number; stale: number }; // open boxes nobody holds
  /** Production deployments set for today, and opening them all. */
  deploys: { mine: number; all: number; open(mine: boolean): void };
  notices: { approvals: number; unread: number; urgent: number; open: boolean; toggle(): void };
  setSpace(index: number): void;
  game: GameStats | null;
  gameOpen: boolean;
  toggleGame(): void;
  /** The week's deployments board. */
  week: { open: boolean; toggle(): void };
  /** Opens the waybill; null when no floor writes its own tickets. */
  write: (() => void) | null;
  /** The day's quests and their card beside the right rail (null = none today). */
  quests: { done: number; total: number; open: boolean; toggle(): void } | null;
}


const SCOPES: [Scope, string, string][] = [
  ['all', '전체', '팀 전체 보기'],
  ['mine', '내 작업', '내 작업만 보기'],
  ['unassigned', '미배정', '미배정만 보기'],
];

/** A tip with its shortcut, if it has one. */
const tipKey = (text: string, key: Parameters<typeof keyLabel>[0]) => (keyLabel(key) ? `${text} · ${keyLabel(key)}` : text);

/** A rail button: an icon, a name shown when pointed at, and maybe a number. */
function railButton(name: string, tip: string, attrs: Record<string, unknown>, badge?: Node | string | null) {
  return h('button', { class: 'ib', type: 'button', 'aria-label': tip, 'data-tip': tip, ...attrs }, icon(name), badge ? (typeof badge === 'string' ? h('span', { class: 'n' }, badge) : badge) : null);
}

/** Why the team server is not in step, in words. */
export const SERVER_NEEDS: Record<string, string> = {
  login: 'Argus 로그인이 끝났습니다. 상단의 "Argus 로그인"을 눌러 다시 로그인해 주세요. 그동안은 마지막으로 받은 설정으로 동작합니다.',
  jira: 'Argus에 Jira 토큰이 등록되어 있지 않습니다. Argus 상단 아바타 메뉴 › 나의 ArgusDesk에서 등록해 주세요.',
  config: 'Argus에 아직 설정이 올라와 있지 않습니다.',
  forbidden: 'ArgusDesk는 서버 관리자만 쓸 수 있습니다. 이 계정에는 권한이 없습니다.',
  disabled: 'Argus에서 ArgusDesk 연동이 꺼져 있습니다.',
  locked: '서버 계정이 잠겨 있습니다. 서버에 로그인해 잠금을 풀어 주세요.',
  site: '서버에 Jira 사이트 주소가 정해져 있지 않습니다. 서버 관리자에게 알려 주세요.',
};

// The room counters at the bottom can be folded to one line; kept between starts.
const ZONES_KEY = 'argusdesk.zones';
let zonesMin = (() => {
  try {
    return localStorage.getItem(ZONES_KEY) === 'min';
  } catch {
    return false;
  }
})();

/** A gear, drawn here so nothing is loaded. */
function gearIcon() {
  const el = h('span', { class: 'gear-ico', 'aria-hidden': 'true' });
  el.innerHTML =
    '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6a.5.5 0 0 0 .1-.6l-2-3.5a.5.5 0 0 0-.6-.2l-2.5 1a7.4 7.4 0 0 0-1.7-1l-.4-2.6a.5.5 0 0 0-.5-.4h-4a.5.5 0 0 0-.5.4L9 5.1a7.4 7.4 0 0 0-1.7 1l-2.5-1a.5.5 0 0 0-.6.2l-2 3.5a.5.5 0 0 0 .1.6L4.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6a.5.5 0 0 0-.1.6l2 3.5c.1.2.4.3.6.2l2.5-1c.5.4 1.1.7 1.7 1l.4 2.6c0 .2.2.4.5.4h4c.3 0 .5-.2.5-.4l.4-2.6c.6-.3 1.2-.6 1.7-1l2.5 1c.2.1.5 0 .6-.2l2-3.5a.5.5 0 0 0-.1-.6ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z"/></svg>';
  return el;
}

const TIRED = ['여유', '피곤', '소진'];

/**
 * The team at a glance: one avatar each, ringed by how worn they are. No
 * names: the picture is enough among four people. Mine comes first, with a bar.
 */
function team(snap: Snapshot | null, game: GameStats | null, hooks: HudHooks) {
  if (!snap) return null;
  // Before the season's figures are in, the avatars still stand here (strength unknown).
  const known = !!game;
  game ??= { away: [], fatigue: {}, avatars: {}, myFatigue: 0 } as unknown as GameStats;
  const seen = new Set<string>();
  const people = snap.members.filter((m) => !seen.has(m.id) && seen.add(m.id)).sort((a, b) => Number(b.me) - Number(a.me));
  if (!people.length) return null;
  const away = new Set(game.away.filter((a) => a.active).map((a) => a.id));
  return h(
    'div',
    { class: 'team', role: 'list', 'aria-label': '팀' },
    ...people.map((m) => {
      const lv = game.fatigue[m.id] ?? 0;
      const state = away.has(m.id) ? '휴가 중' : TIRED[lv];
      const cls = `member lv${lv}${m.me ? ' me' : ''}${away.has(m.id) ? ' away' : ''}`;
      const icon = avatarIcon(lookOf(m.id, game.avatars), 26);
      // My own avatar opens my state, and shows my fatigue as a number.
      if (m.me) {
        return h(
          'button',
          { class: cls, role: 'listitem', 'aria-expanded': String(hooks.profileOpen), 'aria-controls': 'profile', 'aria-label': `내 상태 · 피로도 ${game.myFatigue}% 남음 (${state})`, title: `피로도 ${game.myFatigue}% 남음 · ${state} · 눌러서 내 상태 보기`, onclick: hooks.toggleProfile },
          icon,
          h('span', { class: 'meter' }, h('i', { style: `width:${known ? Math.min(100, game.myFatigue) : 0}%` })),
          h('span', { class: 'pct' }, known ? `${game.myFatigue}%` : '…'),
        );
      }
      // A teammate's avatar lights up their boxes: the tape on a box has the colour of its holder's clothes.
      const on = hooks.spot === m.id;
      return h(
        'button',
        { class: `${cls}${on ? ' spot' : ''}`, role: 'listitem', 'aria-pressed': String(on), 'aria-label': `${m.name} (${state}) 상자만 밝게 보기`, title: `${m.name} · ${state} · 눌러서 이 사람의 상자만 밝게 보기`, onclick: () => hooks.setSpot(on ? '' : m.id) },
        icon,
      );
    }),
  );
}

export function renderHud(state: AppState, snap: Snapshot | null, space: number, lastError: string, backend: Backend, hooks: HudHooks) {
  const hud = document.getElementById('hud')!;
  // Returned boxes leave the building, so they have no room and no counter.
  const zones = (space < 0 ? [] : (snap?.spaces[space]?.zones ?? [])).filter((z) => z.kind !== 'returned');

  // Spaces are floors of one building: the floor buttons stand beside it,
  // highest floor on top, each with its open boxes.
  const floors = document.getElementById('floors')!;
  floors.hidden = !snap;
  fill(
    floors,
    ...(snap?.spaces ?? [])
      .map((s, i) =>
        h(
          'button',
          { class: i === space ? 'on' : '', 'aria-pressed': String(i === space), 'aria-label': `${i + 1}층 ${s.name}`, 'data-tip': `${s.name}${s.project ? ` · ${s.project}` : ''}`, onclick: () => hooks.setSpace(i) },
          h('b', {}, `${i + 1}F`),
          h('span', { class: 'count' }, String(s.zones.filter((z) => z.kind !== 'done' && z.kind !== 'returned').reduce((n, z) => n + z.count, 0))),
          s.zones.some((z) => z.staleCount) ? h('span', { class: 'old-dot', title: '묵은 상자 있음' }) : null,
        ),
      )
      .reverse(),
    // the basement: the lodge where teammates on holiday rest
    snap
      ? h(
          'button',
          { class: space < 0 ? 'on' : '', 'aria-pressed': String(space < 0), 'aria-label': '지하 숙소', 'data-tip': '숙소 · 휴가 중인 사람', onclick: () => hooks.setSpace(-1) },
          h('b', {}, 'B1'),
          h('span', { class: 'count' }, String((hooks.game?.away ?? []).filter((a) => a.active).length)),
        )
      : null,
  );

  renderGame(hooks.game, hooks.gameOpen, hooks.toggleGame);
  // With the team strip showing, my avatar opens my state and the name is not shown.
  const strip = team(snap, hooks.game, hooks);

  fill(
    hud,
    h(
      'div',
      { class: 'title' },
      h('strong', { title: snap?.name ?? state.configName ?? '' }, 'Argus Desk'),
      h(
        'button',
        { class: `gear${hooks.settingsOpen ? ' on' : ''}`, 'aria-label': '설정', 'aria-expanded': String(hooks.settingsOpen), 'aria-controls': 'settings', title: '설정', onclick: hooks.toggleSettings },
        gearIcon(),
      ),
      h('span', { class: 'quiet ver', title: state.configFileVersion ? `Argus가 배포한 설정 버전 ${state.configVersion} (파일 안의 버전 ${state.configFileVersion})` : '설정 버전' }, state.configVersion || '?'),
      backend.mock ? h('span', { class: 'chip' }, '가짜 데이터') : null,
      (() => {
        const u = pendingUpdate();
        return u
          ? h('button', { class: 'chip update-chip', title: u.ready ? `v${u.version}을 설치했습니다. 눌러서 다시 시작` : `새 버전 v${u.version}이 있습니다. 눌러서 업데이트`, onclick: offerUpdate }, u.ready ? '다시 시작해 적용' : `업데이트 v${u.version}`)
          : null;
      })(),
      state.usingLastGood ? h('span', { class: 'chip warn', title: state.configError }, '이전 설정으로 실행 중') : null,
      gameChip(hooks.game, hooks.gameOpen, hooks.toggleGame),
    ),
    h(
      'ul',
      { class: `zones${zonesMin ? ' min' : ''}`, 'aria-label': '구역별 상자 수' },
      h(
        'li',
        { class: 'fold' },
        h(
          'button',
          {
            'aria-expanded': String(!zonesMin),
            title: zonesMin ? '구역별 상자 수 펼치기' : '구역별 상자 수 접기',
            onclick: (e: Event) => {
              zonesMin = !zonesMin;
              try {
                localStorage.setItem(ZONES_KEY, zonesMin ? 'min' : '');
              } catch {
                /* kept for this run only */
              }
              const list = (e.currentTarget as HTMLElement).closest('ul')!;
              list.classList.toggle('min', zonesMin);
              (e.currentTarget as HTMLElement).setAttribute('aria-expanded', String(!zonesMin));
              (e.currentTarget as HTMLElement).title = zonesMin ? '구역별 상자 수 펼치기' : '구역별 상자 수 접기';
            },
          },
          h('span', { class: 'ico', 'aria-hidden': 'true' }, '›'),
          h('span', { class: 'sum' }, `상자 ${zones.reduce((n, z) => n + z.count, 0)}`, zones.some((z) => z.staleCount) ? h('em', { title: '묵은 상자' }, String(zones.reduce((n, z) => n + (z.staleCount || 0), 0))) : null),
        ),
      ),
      ...zones.map((z) =>
        h(
          'li',
          { class: `kind-${z.kind}` },
          h('span', {}, z.name),
          h('b', {}, String(z.count)),
          z.staleCount ? h('em', { title: '묵은 상자' }, String(z.staleCount)) : null,
        ),
      ),
    ),
    h(
      'div',
      { class: 'tools' },
      strip,
      lastError ? h('span', { class: 'chip warn', title: lastError }, '갱신 실패') : null,
      state.server && state.serverNeeds === 'login'
        ? h('button', { class: 'chip warn', title: 'Argus 로그인이 끝났습니다. 눌러서 브라우저에서 다시 로그인합니다.', onclick: hooks.argusLogin }, 'Argus 로그인')
        : state.server && (state.serverNeeds || state.serverProblem)
        ? h(
            'button',
            { class: 'chip warn', title: 'Argus와 맞추지 못했습니다. 눌러서 내용을 봅니다.', onclick: () => toast(SERVER_NEEDS[state.serverNeeds] ?? state.serverProblem, 'error') },
            'Argus 확인',
          )
        : null,
      snap?.warnings.length
        ? h(
            'button',
            { class: 'chip warn', onclick: () => snap.warnings.forEach((w) => toast(w, 'error')) },
            `경고 ${snap.warnings.length}건`,
          )
        : null,
      h('span', { class: 'quiet when' }, snap ? `${clock(snap.fetchedAt)} 갱신` : '불러오는 중'),
      strip ? null : h('button', { 'aria-expanded': String(hooks.profileOpen), 'aria-controls': 'profile', onclick: hooks.toggleProfile }, state.me || '내 상태'),
    ),
  );
  renderRails(snap, hooks);
}

/** The rails: choosing what is seen on the left, what comes to me on the right. */
function renderRails(snap: Snapshot | null, hooks: HudHooks) {
  const left = document.querySelector('#rail-left .rail-tools')!;
  const right = document.querySelector('#rail-right .rail-tools')!;
  const f = hooks.filter;
  const extra = extraCount(f);
  const u = hooks.unassigned;
  fill(
    left,
    snap ? h('hr', {}) : null,
    snap ? railButton('search', tipKey('상자 찾기', 'search'), { class: 'ib find', onclick: hooks.search }) : null,
    snap
      ? h(
          'div',
          { class: 'scope', role: 'group', 'aria-label': `보이는 작업 (${keyLabel('mine') || '단축키 없음'}로 차례로 전환)` },
          ...SCOPES.map(([scope, , tip]) =>
            railButton(
              scope,
              scope === 'mine' ? tipKey(tip, 'mine') : tip,
              { class: `ib${f.scope === scope ? ' on' : ''}`, 'aria-pressed': String(f.scope === scope), onclick: () => f.scope !== scope && hooks.setFilter({ ...f, scope }) },
              scope === 'unassigned' && u.count ? h('span', { class: `n${u.stale ? ' old' : ''}`, title: u.stale ? `묵은 미배정 ${u.stale}건` : '' }, String(u.count)) : null,
            ),
          ),
        )
      : null,
    snap
      ? railButton(
          'filter',
          extra ? `필터 ${extra}개 적용 중` : '필터 · 묵은 상자, 유형',
          { class: `ib${extra ? ' on' : ''}`, 'aria-expanded': String(hooks.filtersOpen), 'aria-controls': 'filters', onclick: hooks.toggleFilters },
          extra ? String(extra) : null,
        )
      : null,
    // today's deployments: mine, and the whole team's, each opening its tickets
    hooks.deploys.all
      ? h(
          'div',
          { class: 'deploy', role: 'group', 'aria-label': '오늘 운영 배포' },
          railButton(
            'truck',
            hooks.deploys.mine ? `오늘 내 배포 ${hooks.deploys.mine}건 모두 열기` : '오늘 배포할 내 티켓이 없습니다',
            { class: 'ib deploy-btn', disabled: !hooks.deploys.mine, onclick: () => hooks.deploys.open(true) },
            hooks.deploys.mine ? String(hooks.deploys.mine) : null,
          ),
          h(
            'button',
            { class: 'deploy-all', type: 'button', 'aria-label': `팀 전체 오늘 배포 ${hooks.deploys.all}건 모두 열기`, 'data-tip': `팀 전체 오늘 배포 ${hooks.deploys.all}건 모두 열기`, onclick: () => hooks.deploys.open(false) },
            '전체 ',
            h('b', {}, String(hooks.deploys.all)),
          ),
        )
      : null,
    snap?.boxes.some((b) => b.deploy)
      ? railButton('calendar', '주간 배포 일정판 · 작업장 화이트보드', { class: `ib week-btn${hooks.week.open ? ' on' : ''}`, 'aria-expanded': String(hooks.week.open), 'aria-controls': 'week', onclick: hooks.week.toggle })
      : null,
    hooks.write ? h('hr', {}) : null,
    hooks.write ? railButton('pen', tipKey('송장 쓰기', 'write'), { class: 'ib write', onclick: hooks.write }) : null,
  );
  const n = hooks.notices;
  const all = n.approvals + n.unread + n.urgent;
  const q = hooks.quests;
  fill(
    right,
    railButton(
      'bell',
      n.approvals ? `알림 · 내 승인 대기 ${n.approvals}건` : tipKey('알림', 'notices'),
      {
        class: `ib bell${n.approvals || n.urgent ? ' urgent' : ''}${n.open ? ' on' : ''}`,
        'aria-expanded': String(n.open),
        'aria-controls': 'notices',
        'aria-label': `알림: 내 승인 대기 ${n.approvals}건, 새 알림 ${n.unread}건, Argus 긴급 ${n.urgent}건`,
        onclick: n.toggle,
      },
      all ? String(all) : null,
    ),
    q
      ? railButton(
          'flag',
          `오늘의 퀘스트 ${q.done}/${q.total}`,
          { class: `ib quest-btn${q.open ? ' on' : ''}`, 'aria-expanded': String(q.open), 'aria-controls': 'quests', onclick: q.toggle },
          h('span', { class: `n tally${q.done === q.total ? ' all' : ''}` }, `${q.done}/${q.total}`),
        )
      : null,
    hooks.game ? railButton('trophy', '기록 · 레벨과 배지', { class: `ib${hooks.gameOpen ? ' on' : ''}`, 'aria-expanded': String(hooks.gameOpen), 'aria-controls': 'game', onclick: hooks.toggleGame }) : null,
    railButton('refresh', snap ? `${tipKey('새로 고침', 'refresh')} · ${clock(snap.fetchedAt)} 갱신` : tipKey('새로 고침', 'refresh'), { class: 'ib refresh', onclick: hooks.refresh }),
    h('hr', {}),
  );
}
