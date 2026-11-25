// The bar above the room: what is loaded, how full each zone is, and the
// few commands the app has.

import type { Backend } from './backend';
import { avatarIcon, lookOf } from './avatars';
import { gameChip, renderGame } from './game';
import type { AppState, GameStats, Snapshot } from './types';
import { clock, fill, h, toast } from './ui';

export interface HudHooks {
  refresh(): void;
  reloadConfig(): void;
  chooseConfig(): void;
  checkUpdate(): void;
  logout(): void;
  setNotify(on: boolean): void;
  vacation(): void;
  avatar(): void;
  setSpace(index: number): void;
  game: GameStats | null;
  gameOpen: boolean;
  toggleGame(): void;
}

let menuOpen = false;

const TIRED = ['여유', '피곤', '지침'];

/**
 * The team at a glance: one avatar each, ringed by how worn they are. No
 * names: the picture is enough among four people. Mine comes first, with a bar.
 */
function team(snap: Snapshot | null, game: GameStats | null) {
  if (!snap || !game) return null;
  const seen = new Set<string>();
  const people = snap.members.filter((m) => !seen.has(m.id) && seen.add(m.id)).sort((a, b) => Number(b.me) - Number(a.me));
  if (!people.length) return null;
  const away = new Set(game.away.filter((a) => a.active).map((a) => a.id));
  return h(
    'div',
    { class: 'team', role: 'list', 'aria-label': '팀 피로도' },
    ...people.map((m) => {
      const lv = game.fatigue[m.id] ?? 0;
      const state = away.has(m.id) ? '휴가 중' : TIRED[lv];
      return h(
        'span',
        { class: `member lv${lv}${m.me ? ' me' : ''}${away.has(m.id) ? ' away' : ''}`, role: 'listitem', title: m.me ? `나 · ${state} (${game.myFatigue}%)` : state, 'aria-label': m.me ? `나, ${state}` : state },
        avatarIcon(lookOf(m.id, game.avatars), 26),
        m.me ? h('span', { class: 'meter' }, h('i', { style: `width:${Math.min(100, game.myFatigue)}%` })) : null,
      );
    }),
  );
}

export function renderHud(state: AppState, snap: Snapshot | null, space: number, lastError: string, backend: Backend, hooks: HudHooks) {
  const hud = document.getElementById('hud')!;
  // Returned boxes leave the building, so they have no room and no counter.
  const zones = (space < 0 ? [] : (snap?.spaces[space]?.zones ?? [])).filter((z) => z.kind !== 'returned');
  const item = (label: string, run: () => void) =>
    h('button', { role: 'menuitem', onclick: () => ((menuOpen = false), run()) }, label);

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
          h('span', { class: 'name' }, s.name),
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

  fill(
    hud,
    h(
      'div',
      { class: 'title' },
      h('strong', {}, snap?.name ?? state.configName ?? 'ArgusDesk'),
      h('span', { class: 'quiet', title: state.configPath }, `설정 ${state.configVersion || '?'}`),
      backend.mock ? h('span', { class: 'chip' }, '가짜 데이터') : null,
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
      team(snap, hooks.game),
      lastError ? h('span', { class: 'chip warn', title: lastError }, '갱신 실패') : null,
      snap?.warnings.length
        ? h(
            'button',
            { class: 'chip warn', onclick: () => snap.warnings.forEach((w) => toast(w, 'error')) },
            `경고 ${snap.warnings.length}건`,
          )
        : null,
      h('span', { class: 'quiet' }, snap ? `${clock(snap.fetchedAt)} 갱신` : '불러오는 중'),
      h('button', { onclick: hooks.refresh, title: '지금 Jira에서 다시 읽기' }, '새로 고침'),
      h(
        'div',
        { class: 'menu' },
        h(
          'button',
          {
            'aria-haspopup': 'menu',
            'aria-expanded': String(menuOpen),
            onclick: () => ((menuOpen = !menuOpen), renderHud(state, snap, space, lastError, backend, hooks)),
          },
          state.me || '메뉴',
        ),
        menuOpen
          ? h(
              'div',
              { class: 'menu-list', role: 'menu' },
              item('설정 다시 읽기', hooks.reloadConfig),
              item('설정 파일 바꾸기', hooks.chooseConfig),
              item('아바타 선택', hooks.avatar),
              item('휴가 등록', hooks.vacation),
              item(state.notify ? '알림 끄기' : '알림 켜기', () => hooks.setNotify(!state.notify)),
              state.notify && state.notifyProblem ? h('p', { class: 'quiet' }, `알림을 보낼 수 없습니다: ${state.notifyProblem}`) : null,
              item('업데이트 확인', hooks.checkUpdate),
              item('로그아웃', hooks.logout),
              h('p', { class: 'quiet' }, `ArgusDesk v${state.version}`),
            )
          : null,
      ),
    ),
  );
}
