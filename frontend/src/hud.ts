// The bar above the room: what is loaded, how full each zone is, and the
// few commands the app has.

import { keyLabel } from './keys';
import type { Backend } from './backend';
import { avatarIcon, lookOf } from './avatars';
import { gameChip, renderGame } from './game';
import { offerUpdate, pendingUpdate } from './update';
import type { AppState, GameStats, Snapshot } from './types';
import { clock, fill, h, toast } from './ui';
import { type Filter, type Scope, extraCount } from './view';

export interface HudHooks {
  refresh(): void;
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
  notices: { approvals: number; unread: number; urgent: number; open: boolean; toggle(): void };
  setSpace(index: number): void;
  game: GameStats | null;
  gameOpen: boolean;
  toggleGame(): void;
}


const SCOPES: [Scope, string, string][] = [
  ['all', '전체', '팀 전체의 상자를 봅니다'],
  ['mine', '내 작업', '내가 담당하거나 내가 승인할 상자만 봅니다'],
  ['unassigned', '미배정', '담당자가 없는 상자만 봅니다'],
];

/** Why the team server is not in step, in words. */
export const SERVER_NEEDS: Record<string, string> = {
  login: 'Argus 로그인이 끝났습니다. 메뉴에서 다시 로그인해 주세요. 그동안은 마지막으로 받은 설정으로 동작합니다.',
  jira: 'Argus에 Jira 토큰이 등록되어 있지 않습니다. Argus 상단 아바타 메뉴 › 나의 ArgusDesk에서 등록해 주세요.',
  config: 'Argus에 아직 설정이 올라와 있지 않습니다.',
  forbidden: 'ArgusDesk는 서버 관리자만 쓸 수 있습니다. 이 계정에는 권한이 없습니다.',
  disabled: 'Argus에서 ArgusDesk 연동이 꺼져 있습니다.',
  locked: '서버 계정이 잠겨 있습니다. 서버에 로그인해 잠금을 풀어 주세요.',
  site: '서버에 Jira 사이트 주소가 정해져 있지 않습니다. 서버 관리자에게 알려 주세요.',
};

const TIRED = ['여유', '피곤', '소진'];

/**
 * The team at a glance: one avatar each, ringed by how worn they are. No
 * names: the picture is enough among four people. Mine comes first, with a bar.
 */
function team(snap: Snapshot | null, game: GameStats | null, hooks: HudHooks) {
  if (!snap || !game) return null;
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
          h('span', { class: 'meter' }, h('i', { style: `width:${Math.min(100, game.myFatigue)}%` })),
          h('span', { class: 'pct' }, `${game.myFatigue}%`),
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
          { class: i === space ? 'on' : '', 'aria-pressed': String(i === space), onclick: () => hooks.setSpace(i) },
          h('b', {}, `${i + 1}F`),
          h('span', { class: 'name' }, s.name, s.project ? h('small', {}, s.project) : null),
          h('span', { class: 'count' }, String(s.zones.filter((z) => z.kind !== 'done' && z.kind !== 'returned').reduce((n, z) => n + z.count, 0))),
          s.zones.some((z) => z.staleCount) ? h('span', { class: 'old-dot', title: '묵은 상자 있음' }) : null,
        ),
      )
      .reverse(),
    // the basement: the lodge where teammates on holiday rest
    snap
      ? h(
          'button',
          { class: space < 0 ? 'on' : '', 'aria-pressed': String(space < 0), onclick: () => hooks.setSpace(-1) },
          h('b', {}, 'B1'),
          h('span', { class: 'name' }, '숙소'),
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
      { class: 'zones', 'aria-label': '구역별 상자 수' },
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
      snap ? h('button', { class: 'find', title: `상자 찾기${keyLabel('search') ? ` (${keyLabel('search')})` : ''}`, 'aria-label': '상자 찾기', onclick: hooks.search }, h('span', { class: 'find-ico', 'aria-hidden': 'true' }), keyLabel('search') ? h('kbd', {}, keyLabel('search')) : null) : null,
      snap
        ? h(
            'div',
            { class: 'scope', role: 'group', 'aria-label': '보이는 작업' },
            ...SCOPES.map(([scope, text, tip]) =>
              h('button', { class: hooks.filter.scope === scope ? 'on' : '', 'aria-pressed': String(hooks.filter.scope === scope), title: tip, onclick: () => hooks.filter.scope !== scope && hooks.setFilter({ ...hooks.filter, scope }) },
                text,
                scope === 'unassigned' && hooks.unassigned.count
                  ? h('span', { class: `n${hooks.unassigned.stale ? ' old' : ''}`, title: hooks.unassigned.stale ? `묵은 미배정 ${hooks.unassigned.stale}건` : '' }, String(hooks.unassigned.count))
                  : null,
              ),
            ),
          )
        : null,
      snap
        ? h(
            'button',
            { class: `filter-btn${extraCount(hooks.filter) ? ' on' : ''}`, 'aria-expanded': String(hooks.filtersOpen), 'aria-controls': 'filters', title: '묵은 상자, 유형으로 걸러 보기', onclick: hooks.toggleFilters },
            '필터',
            extraCount(hooks.filter) ? h('span', { class: 'n' }, String(extraCount(hooks.filter))) : null,
          )
        : null,
      strip,
      lastError ? h('span', { class: 'chip warn', title: lastError }, '갱신 실패') : null,
      state.server && (state.serverNeeds || state.serverProblem)
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
      h(
        'button',
        {
          class: `bell${hooks.notices.approvals || hooks.notices.urgent ? ' urgent' : ''}`,
          'aria-expanded': String(hooks.notices.open),
          'aria-controls': 'notices',
          'aria-label': `알림: 내 승인 대기 ${hooks.notices.approvals}건, 새 알림 ${hooks.notices.unread}건, Argus 긴급 ${hooks.notices.urgent}건`,
          title: hooks.notices.approvals ? `내 승인 대기 ${hooks.notices.approvals}건` : '알림',
          onclick: hooks.notices.toggle,
        },
        h('span', { class: 'bell-ico', 'aria-hidden': 'true' }),
        hooks.notices.approvals + hooks.notices.unread + hooks.notices.urgent ? h('span', { class: 'n' }, String(hooks.notices.approvals + hooks.notices.unread + hooks.notices.urgent)) : null,
      ),
      h('span', { class: 'quiet when' }, snap ? `${clock(snap.fetchedAt)} 갱신` : '불러오는 중'),
      // In a narrow window the button is its sign alone, and tells the time of the last reading when pointed at.
      h('button', { class: 'refresh', onclick: hooks.refresh, 'aria-label': '새로 고침', title: snap ? `지금 Jira에서 다시 읽기 · ${clock(snap.fetchedAt)} 갱신` : '지금 Jira에서 다시 읽기' }, h('span', { class: 'ico', 'aria-hidden': 'true' }, '↻'), h('span', { class: 'txt' }, '새로 고침')),
      strip ? null : h('button', { 'aria-expanded': String(hooks.profileOpen), 'aria-controls': 'profile', onclick: hooks.toggleProfile }, state.me || '내 상태'),
    ),
  );
}
