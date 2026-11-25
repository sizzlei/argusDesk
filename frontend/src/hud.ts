// The bar above the room: what is loaded, how full each zone is, and the
// few commands the app has.

import type { Backend } from './backend';
import type { AppState, Snapshot } from './types';
import { clock, fill, h, toast } from './ui';

export interface HudHooks {
  refresh(): void;
  reloadConfig(): void;
  chooseConfig(): void;
  checkUpdate(): void;
  logout(): void;
  setNotify(on: boolean): void;
  setSpace(index: number): void;
}

let menuOpen = false;

export function renderHud(state: AppState, snap: Snapshot | null, space: number, lastError: string, backend: Backend, hooks: HudHooks) {
  const hud = document.getElementById('hud')!;
  // Returned boxes leave the building, so they have no room and no counter.
  const zones = (snap?.spaces[space]?.zones ?? []).filter((z) => z.kind !== 'returned');
  const item = (label: string, run: () => void) =>
    h('button', { role: 'menuitem', onclick: () => ((menuOpen = false), run()) }, label);

  // Spaces are floors of one building: the floor buttons stand beside it,
  // highest floor on top, each with its open boxes.
  const floors = document.getElementById('floors')!;
  floors.hidden = !snap || snap.spaces.length < 2;
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
  );

  fill(
    hud,
    h(
      'div',
      { class: 'title' },
      h('strong', {}, snap?.name ?? state.configName ?? 'ArgusDesk'),
      h('span', { class: 'quiet', title: state.configPath }, `설정 ${state.configVersion || '?'}`),
      backend.mock ? h('span', { class: 'chip' }, '가짜 데이터') : null,
      state.usingLastGood ? h('span', { class: 'chip warn', title: state.configError }, '이전 설정으로 실행 중') : null,
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
