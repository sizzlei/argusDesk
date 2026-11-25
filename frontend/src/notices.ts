// The notification centre: what waits for my approval, and what happened
// lately. It lives in memory only; closing the app clears it.

import type { Box, Note, Snapshot } from './types';
import { clock, fill, h } from './ui';

interface Item extends Note {
  at: string;
  read: boolean;
}

const feed: Item[] = [];
const MAX = 50;
let open = false;

/** Takes the notes of one refresh. Returns true when something new arrived. */
export function addNotes(notes: Note[] | undefined, at: string) {
  if (!notes?.length) return false;
  for (const n of notes) feed.unshift({ ...n, at, read: open });
  feed.length = Math.min(feed.length, MAX);
  return true;
}

const waiting = (snap: Snapshot | null) => (snap?.boxes ?? []).filter((b) => b.myApproval);

/** What the bell shows: approvals waiting for me, and notes not yet seen. */
export function noticeCount(snap: Snapshot | null) {
  return { approvals: waiting(snap).length, unread: feed.filter((f) => !f.read).length };
}

export const noticesOpen = () => open;

export function toggleNotices(force?: boolean) {
  open = force ?? !open;
  if (open) feed.forEach((f) => (f.read = true));
}

const ICON: Record<Note['kind'], string> = { approval: '!', new: '+', arrive: '→', mine: '↪', assigned: '@', summary: '…' };

/** Draws the centre. `go` opens a ticket (and shows its floor). */
export function renderNotices(snap: Snapshot | null, go: (box: Box) => void, redraw: () => void) {
  const el = document.getElementById('notices')!;
  el.hidden = !open;
  if (!open) return;
  const mine = waiting(snap);
  const find = (key: string) => snap?.boxes.find((b) => b.key === key);
  fill(
    el,
    h(
      'div',
      { class: 'panel-head' },
      h('strong', {}, '알림'),
      h('button', { class: 'close', 'aria-label': '알림 닫기', onclick: () => (toggleNotices(false), redraw()) }, '×'),
    ),
    h('h3', {}, `내 승인 대기 ${mine.length}`),
    mine.length
      ? h(
          'ul',
          { class: 'notice-list' },
          ...mine.map((b) =>
            h(
              'li',
              {},
              h(
                'button',
                { class: 'notice approval', onclick: () => go(b) },
                h('span', { class: 'ico', 'aria-hidden': 'true' }, '!'),
                h('span', { class: 'what' }, h('b', {}, b.key), ` ${b.summary}`),
                h('span', { class: 'quiet' }, `${b.type} · ${b.reporter}`),
              ),
            ),
          ),
        )
      : h('p', { class: 'quiet' }, '내가 승인할 건이 없습니다.'),
    h(
      'h3',
      {},
      '최근 알림',
      feed.length
        ? h(
            'button',
            {
              class: 'copy',
              onclick: () => {
                feed.length = 0;
                redraw();
              },
            },
            '지우기',
          )
        : null,
    ),
    feed.length
      ? h(
          'ul',
          { class: 'notice-list' },
          ...feed.map((f) => {
            const box = f.key ? find(f.key) : undefined;
            return h(
              'li',
              {},
              h(
                'button',
                { class: `notice ${f.kind}`, disabled: !box, title: box ? '' : '센터를 떠난 티켓입니다', onclick: () => box && go(box) },
                h('span', { class: 'ico', 'aria-hidden': 'true' }, ICON[f.kind]),
                h('span', { class: 'what' }, h('b', {}, f.title)),
                h('span', { class: 'quiet' }, `${clock(f.at)} · ${f.body}`),
              ),
            );
          }),
        )
      : h('p', { class: 'quiet' }, '아직 알림이 없습니다. 새 상자, 내 상자의 이동, 승인 요청이 여기에 쌓입니다.'),
  );
}
