// The notification centre: what waits for my approval, and what happened
// lately. It lives in memory only; closing the app clears it.

import type { Box, Note, ServerFeed, Snapshot } from './types';
import { clock, dateTime, fill, h } from './ui';

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

let feed0: ServerFeed | null = null; // what the team server last said

/** Takes the team server's notices. */
export function setServerFeed(f: ServerFeed | null) {
  feed0 = f;
}

const SEVERITY: Record<string, string> = { crit: '긴급', warn: '주의', info: '안내', good: '정상' };
const SYSTEM: Record<string, string> = { ok: '정상', warn: '주의', fail: '이상' };

const waiting = (snap: Snapshot | null) => (snap?.boxes ?? []).filter((b) => b.myApproval);

/** What the bell shows: approvals waiting for me, and notes not yet seen. */
export function noticeCount(snap: Snapshot | null) {
  return { approvals: waiting(snap).length, unread: feed.filter((f) => !f.read).length, urgent: (feed0?.notices ?? []).filter((n) => n.severity === 'crit').length };
}

export const noticesOpen = () => open;

export function toggleNotices(force?: boolean) {
  open = force ?? !open;
  if (open) feed.forEach((f) => (f.read = true));
}

const ICON: Record<Note['kind'], string> = { approval: '!', new: '+', arrive: '→', mine: '↪', assigned: '@', summary: '…' };

/** Draws the centre. `go` opens a ticket (and shows its floor). */
export function renderNotices(snap: Snapshot | null, go: (box: Box) => void, redraw: () => void, open2: (url: string) => void = () => {}) {
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
    // what the team server wants seen: its own notices, opened on the server
    feed0
      ? h(
          'h3',
          {},
          `팀 서버 ${feed0.total}`,
          feed0.system ? h('button', { class: `copy sys-${feed0.system}`, title: '서버의 시스템 상태 화면을 엽니다', disabled: !feed0.systemUrl, onclick: () => open2(feed0!.systemUrl) }, `시스템 ${SYSTEM[feed0.system] ?? feed0.system}`) : null,
        )
      : null,
    feed0 && feed0.notices.length
      ? h(
          'ul',
          { class: 'notice-list' },
          ...feed0.notices.map((n) =>
            h(
              'li',
              {},
              h(
                'button',
                { class: `notice server ${n.severity}`, disabled: !n.url, title: n.url ? '서버에서 엽니다' : '', onclick: () => n.url && open2(n.url) },
                h('span', { class: 'ico', 'aria-hidden': 'true' }, n.severity === 'crit' ? '!' : '·'),
                h('span', { class: 'what' }, h('b', {}, n.title)),
                h('span', { class: 'quiet' }, [SEVERITY[n.severity] ?? n.severity, n.category, n.target, n.due ? `기한 ${dateTime(n.due)}` : ''].filter(Boolean).join(' · ')),
              ),
            ),
          ),
          feed0.total > feed0.notices.length ? h('li', {}, h('button', { class: 'copy', onclick: () => open2(feed0!.allUrl) }, `서버에서 모두 보기 (${feed0.total})`)) : null,
        )
      : feed0
        ? h('p', { class: 'quiet' }, '팀 서버에 진행 중인 알림이 없습니다.')
        : null,
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
