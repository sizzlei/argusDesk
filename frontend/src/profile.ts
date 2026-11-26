// My state at a glance, behind my avatar: how worn I am, what I hold, what I
// have finished, and the settings that used to sit in a menu.

import { avatarIcon, lookOf } from './avatars';
import { TAGS, ageStep } from './scene';
import type { AppState, Box, GameStats, Snapshot } from './types';
import { fill, h } from './ui';
import { isMine } from './view';

let open = false;

export const profileOpen = () => open;

export function toggleProfile(force?: boolean) {
  open = force ?? !open;
}

/** One line of the settings list. */
export interface ProfileAction {
  label: string;
  run(): void;
  note?: string; // shown under the label
  danger?: boolean;
}

const TIRED = ['여유', '피곤', '지침'];
const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const LIST = 8; // boxes listed before "and n more"

const stat = (label: string, value: string | number, note?: string) => h('div', { class: 'stat' }, h('dt', {}, label), h('dd', {}, String(value)), note ? h('span', { class: 'quiet' }, note) : null);

/** Draws the panel. `go` opens a ticket; `more` opens the season's record. */
export function renderProfile(state: AppState, snap: Snapshot | null, game: GameStats | null, actions: ProfileAction[], go: (box: Box) => void, more: () => void, redraw: () => void) {
  const el = document.getElementById('profile')!;
  el.hidden = !open;
  if (!open) return;
  const close = () => (toggleProfile(false), redraw());
  const me = snap?.members.find((m) => m.me);
  const mine = (snap?.boxes ?? []).filter(isMine);
  const held = mine.filter((b) => b.mine);
  const approvals = mine.filter((b) => b.myApproval);
  const stale = held.filter((b) => b.stale);
  // what I hold, room by room, in the order of the floors
  const rooms: { name: string; count: number; old: number }[] = [];
  for (const sp of snap?.spaces ?? []) {
    for (const z of sp.zones) {
      const here = held.filter((b) => b.space === sp.id && b.zone === z.id);
      if (here.length) rooms.push({ name: z.name, count: here.length, old: here.filter((b) => b.stale).length });
    }
  }
  // the ones that need me first: approvals, then the oldest
  const order = [...mine].sort((a, b) => Number(!!b.myApproval) - Number(!!a.myApproval) || ageStep(b) - ageStep(a) || b.staleRatio - a.staleRatio);
  const open2 = (snap?.boxes ?? []).length;
  const lv = me && game ? (game.fatigue[me.id] ?? 0) : 0;
  const away = game?.away.find((a) => a.me);

  fill(
    el,
    h(
      'div',
      { class: 'panel-head' },
      h('span', { class: 'who' }, me && game ? avatarIcon(lookOf(me.id, game.avatars), 40) : null, h('span', {}, h('strong', {}, state.me || '나'), game ? h('span', { class: 'quiet' }, `Lv.${game.me.level}`) : null)),
      h('button', { class: 'close', 'aria-label': '내 상태 닫기', onclick: close }, '×'),
    ),

    h('h3', {}, '피로도'),
    game
      ? h(
          'div',
          { class: `fatigue lv${lv}` },
          h('div', { class: 'bar', role: 'progressbar', 'aria-label': '피로도', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(game.myFatigue) }, h('i', { style: `width:${Math.min(100, game.myFatigue)}%` })),
          h('b', {}, `${game.myFatigue}%`),
          h('span', { class: 'chip' }, TIRED[lv]),
        )
      : h('p', { class: 'quiet' }, '기록을 읽는 중입니다.'),
    h('p', { class: 'quiet' }, '최근 일주일에 끝낸 작업으로 계산합니다. 100%에 이르면 아바타가 벤치에서 쉽니다.'),
    away ? h('p', { class: 'quiet' }, `휴가 ${away.from} ~ ${away.to}${away.active ? ' (지금 휴가 중)' : ''}`) : null,

    h('h3', {}, '지금 가진 작업'),
    h(
      'dl',
      { class: 'stats' },
      stat('담당', held.length, open2 ? `열린 상자 ${open2}개 중` : undefined),
      stat('묵은 것', stale.length),
      stat('내 승인 대기', approvals.length),
    ),
    rooms.length ? h('p', { class: 'rooms' }, ...rooms.map((r) => h('span', { class: 'chip' }, `${r.name} ${r.count}`, r.old ? h('em', {}, String(r.old)) : null))) : null,
    order.length
      ? h(
          'ul',
          { class: 'notice-list' },
          ...order.slice(0, LIST).map((b) =>
            h(
              'li',
              {},
              h(
                'button',
                { class: 'notice', onclick: () => go(b) },
                h('i', { class: 'tag', style: `background:${css(TAGS[b.tag] ?? TAGS.gray)}` }),
                h('span', { class: 'what' }, h('b', {}, b.key), ` ${b.summary}`),
                h('span', { class: 'quiet' }, [b.myApproval ? '승인 요청' : '', b.status, b.stale ? '묵음' : ''].filter(Boolean).join(' · ')),
              ),
            ),
          ),
          order.length > LIST ? h('li', { class: 'quiet' }, `외 ${order.length - LIST}개. 상단의 "내 작업"으로 전부 볼 수 있습니다.`) : null,
        )
      : h('p', { class: 'quiet' }, '지금 가진 작업이 없습니다.'),

    h('h3', {}, '처리한 작업', game ? h('button', { class: 'copy', onclick: more }, '레벨과 배지') : null),
    game
      ? h(
          'dl',
          { class: 'stats' },
          stat('오늘', game.me.today),
          stat('이번 주', game.me.week),
          stat('시즌', game.me.done.toLocaleString(), `${game.me.xp.toLocaleString()} XP`),
        )
      : h('p', { class: 'quiet' }, '기록을 읽는 중입니다.'),

    h('h3', {}, '설정'),
    h(
      'ul',
      { class: 'actions' },
      ...actions.map((a) =>
        h('li', {}, h('button', { class: a.danger ? 'danger' : '', onclick: () => (toggleProfile(false), redraw(), a.run()) }, a.label), a.note ? h('span', { class: 'quiet' }, a.note) : null),
      ),
    ),
    h('p', { class: 'quiet' }, `ArgusDesk v${state.version}${state.server ? ` · 팀 서버 ${state.server.replace(/^https?:\/\//, '')}` : ''}`),
  );
}
