// The week's production deployments: the whiteboard in the work room, and the
// board it opens. A week runs Monday to Sunday; done ones stay on it, ticked.

import { dayOf, deployWhen } from './deploy';
import type { Box, Snapshot } from './types';
import { fill, h } from './ui';

export interface Slot {
  box: Box;
  time: string; // "14:00", "" for a date alone
  done: boolean; // already finished
  unsure: boolean; // its date is not settled yet ("일정 미정")
  clash: boolean; // another open deployment on the same day at the same hour
}

export interface Day {
  date: string; // "2026-11-30"
  label: string; // "월 11/30"
  today: boolean;
  slots: Slot[];
}

const NAMES = ['월', '화', '수', '목', '금', '토', '일'];

/** Monday of the week `offset` weeks from the one holding `now`. */
export function monday(now: Date, offset = 0): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
  return d;
}

/** The week's deployments, day by day; in a day, by hour (whole-day ones last). */
export function weekDeploys(snap: Snapshot | null, offset = 0, now = new Date(), mine = false): Day[] {
  const start = monday(now, offset);
  const kind = (b: Box) => snap?.spaces.find((s) => s.id === b.space)?.zones.find((z) => z.id === b.zone)?.kind;
  const days: Day[] = NAMES.map((n, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return { date: dayOf(d), label: `${n} ${d.getMonth() + 1}/${d.getDate()}`, today: dayOf(d) === dayOf(now), slots: [] };
  });
  for (const box of snap?.boxes ?? []) {
    if (mine && !box.mine) continue;
    const k = kind(box);
    if (k === 'returned') continue; // sent back or cancelled: nothing goes out
    const w = deployWhen(box);
    const day = w && days.find((d) => d.date === w.day);
    if (!day) continue;
    day.slots.push({ box, time: w.time, done: k === 'done', unsure: !!box.note, clash: false });
  }
  for (const d of days) {
    d.slots.sort((a, b) => (a.time || '99').localeCompare(b.time || '99') || a.box.key.localeCompare(b.box.key));
    // two open ones in the same hour of a day: worth a look
    const open = d.slots.filter((s) => !s.done && s.time);
    for (const s of open) s.clash = open.some((o) => o !== s && o.time.slice(0, 2) === s.time.slice(0, 2));
  }
  return days;
}

/** How many of the week are still to go out, for the whiteboard. */
export const openCount = (days: Day[]) => days.reduce((n, d) => n + d.slots.filter((s) => !s.done).length, 0);

/**
 * The board: seven columns, a card per deployment. A card opens its ticket.
 * Draws into `el`; `state` holds the week shown and whether only mine are.
 */
export function renderWeek(
  el: HTMLElement,
  snap: Snapshot | null,
  state: { open: boolean; offset: number; mine: boolean },
  hooks: { close(): void; redraw(): void; open(box: Box): void },
) {
  el.hidden = !state.open || !snap;
  if (el.hidden) return;
  const days = weekDeploys(snap, state.offset, new Date(), state.mine);
  const first = days[0].date.slice(5).replace('-', '/');
  const last = days[6].date.slice(5).replace('-', '/');
  const all = days.flatMap((d) => d.slots);
  const week = state.offset === 0 ? '이번 주' : state.offset === 1 ? '다음 주' : state.offset === -1 ? '지난 주' : `${state.offset > 0 ? '+' : ''}${state.offset}주`;
  const step = (n: number) => () => ((state.offset = n), hooks.redraw());
  fill(
    el,
    h(
      'div',
      { class: 'panel-head' },
      h('strong', {}, '주간 배포 일정판'),
      h('span', { class: 'quiet' }, `${week} · ${first} – ${last}`),
      h('button', { class: 'close', 'aria-label': '주간 배포 일정판 닫기', onclick: hooks.close }, '×'),
    ),
    h(
      'div',
      { class: 'wk-bar' },
      h(
        'div',
        { class: 'wk-nav', role: 'group', 'aria-label': '주 바꾸기' },
        h('button', { type: 'button', onclick: step(state.offset - 1), 'aria-label': '이전 주' }, '‹'),
        h('button', { type: 'button', class: state.offset === 0 ? 'on' : '', onclick: step(0) }, '이번 주'),
        h('button', { type: 'button', onclick: step(state.offset + 1), 'aria-label': '다음 주' }, '›'),
      ),
      h(
        'label',
        { class: 'wk-mine' },
        h('input', { type: 'checkbox', checked: state.mine || undefined, onchange: (e: Event) => ((state.mine = (e.target as HTMLInputElement).checked), hooks.redraw()) }),
        '내 것만',
      ),
      h(
        'span',
        { class: 'wk-sum' },
        `예정 ${all.filter((s) => !s.done).length}`,
        ' · ',
        `완료 ${all.filter((s) => s.done).length}`,
        all.some((s) => s.unsure && !s.done) ? h('em', { class: 'unsure' }, ` · 미정 ${all.filter((s) => s.unsure && !s.done).length}`) : null,
        all.some((s) => s.clash) ? h('em', { class: 'clash' }, ` · 겹침 ${all.filter((s) => s.clash).length}`) : null,
      ),
    ),
    state.offset < 0 ? h('p', { class: 'quiet wk-note' }, '지난 주 완료 건은 출고 도크에 남아 있는 7일치까지만 보입니다.') : null,
    h(
      'div',
      { class: 'wk-days' },
      ...days.map((d, i) =>
        h(
          'section',
          { class: `wk-day${d.today ? ' today' : ''}${i >= 5 ? ' weekend' : ''}` },
          h(
            'h4',
            {},
            d.label,
            d.slots.filter((s) => !s.done).length ? h('span', { class: 'n' }, String(d.slots.filter((s) => !s.done).length)) : null,
          ),
          d.slots.filter((s) => s.unsure && !s.done).length >= 2 ? h('p', { class: 'wk-warn' }, `일정 미정 ${d.slots.filter((s) => s.unsure && !s.done).length}건`) : null,
          ...d.slots.map((s) =>
            h(
              'button',
              {
                type: 'button',
                class: `wk-card${s.done ? ' done' : ''}${s.unsure ? ' unsure' : ''}${s.clash ? ' clash' : ''}${s.box.mine ? ' mine' : ''}`,
                title: `${s.box.key} · ${s.box.summary}`,
                onclick: () => hooks.open(s.box),
              },
              h(
                'span',
                { class: 'wk-top' },
                h('b', {}, s.time || '종일'),
                s.done ? h('span', { class: 'chip ok' }, '완료') : s.unsure ? h('span', { class: 'chip unsure' }, '미정') : null,
                s.clash ? h('span', { class: 'chip clash', title: '같은 시간대에 다른 배포가 있습니다' }, '겹침') : null,
              ),
              h('span', { class: 'wk-key' }, s.box.key),
              h('span', { class: 'wk-sumline' }, s.box.summary),
              h('span', { class: 'wk-who' }, s.box.assignee || '미배정'),
            ),
          ),
          d.slots.length ? null : h('p', { class: 'quiet wk-empty' }, '—'),
        ),
      ),
    ),
  );
}
