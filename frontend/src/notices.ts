// The notification centre: what waits for my approval, and what happened
// lately. It lives in memory only; closing the app clears it.

import type { Box, Note, ServerFeed, ServerNotice, Snapshot } from './types';
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

// Argus notices I have read, by id with the time each last changed: one that
// changes again is unread again. Kept on this computer between starts.
const SEEN_KEY = 'argusdesk.seen';
const seen = new Map<number, string>();
try {
  for (const [id, at] of JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as [number, string][]) seen.set(id, at);
} catch {
  /* nothing kept, or unreadable: everything is unread */
}
const keepSeen = () => {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch {
    /* kept for this run only */
  }
};
const isRead = (n: ServerNotice) => seen.get(n.id) === n.changed;
const markRead = (ns: ServerNotice[]) => {
  for (const n of ns) seen.set(n.id, n.changed);
  keepSeen();
};
let showRead = false; // the read ones are listed too
let showAll = false; // every unread one, not only the first few
const FIRST = 5;
const RANK: Record<string, number> = { crit: 0, warn: 1, info: 2, good: 3 };

/** Takes the team server's notices. */
export function setServerFeed(f: ServerFeed | null) {
  feed0 = f;
  // Notices the server no longer lists are forgotten, when it listed them all.
  if (f && f.total <= f.notices.length) {
    const live = new Set(f.notices.map((n) => n.id));
    let gone = false;
    for (const id of seen.keys()) if (!live.has(id)) gone = seen.delete(id) || gone;
    if (gone) keepSeen();
  }
}

const SEVERITY: Record<string, string> = { crit: '긴급', warn: '주의', info: '안내', good: '정상' };
const SYSTEM: Record<string, string> = { ok: '정상', warn: '주의', fail: '이상' };

const waiting = (snap: Snapshot | null) => (snap?.boxes ?? []).filter((b) => b.myApproval);

/** What the bell shows: approvals waiting for me, and notes not yet seen. */
export function noticeCount(snap: Snapshot | null) {
  return { approvals: waiting(snap).length, unread: feed.filter((f) => !f.read).length, urgent: (feed0?.notices ?? []).filter((n) => n.severity === 'crit' && !isRead(n)).length };
}

export const noticesOpen = () => open;

export function toggleNotices(force?: boolean) {
  open = force ?? !open;
  if (open) feed.forEach((f) => (f.read = true));
}

const ICON: Record<Note['kind'], string> = { approval: '!', reply: '“', new: '+', arrive: '→', mine: '↪', assigned: '@', summary: '…' };

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
    ...argusPart(redraw, open2),
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

/**
 * The team server's notices. Only the unread ones are listed, the most urgent
 * first and a few at a time; the rest are summed up. Opening one, or "모두 읽음",
 * marks it read.
 */
function argusPart(redraw: () => void, open2: (url: string) => void) {
  if (!feed0) return [];
  const f = feed0;
  const byRank = (a: ServerNotice, b: ServerNotice) => (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9) || b.changed.localeCompare(a.changed);
  const unread = f.notices.filter((n) => !isRead(n)).sort(byRank);
  const read = f.notices.filter(isRead).sort(byRank);
  const count = (ns: ServerNotice[]) =>
    (['crit', 'warn', 'info', 'good'] as const)
      .map((k) => [k, ns.filter((n) => n.severity === k).length] as const)
      .filter(([, n]) => n)
      .map(([k, n]) => h('span', { class: `tally-sev ${k}` }, `${SEVERITY[k]} ${n}`));
  const row = (n: ServerNotice) =>
    h(
      'li',
      {},
      h(
        'button',
        {
          class: `notice server ${n.severity}${isRead(n) ? ' read' : ''}`,
          disabled: !n.url,
          title: n.url ? '서버에서 엽니다' : '',
          onclick: () => {
            if (!n.url) return;
            markRead([n]);
            open2(n.url);
            redraw();
          },
        },
        h('span', { class: 'ico', 'aria-hidden': 'true' }, n.severity === 'crit' ? '!' : '·'),
        h('span', { class: 'what' }, h('b', {}, n.title)),
        h('span', { class: 'quiet' }, [SEVERITY[n.severity] ?? n.severity, n.category, n.target, n.due ? `기한 ${dateTime(n.due)}` : ''].filter(Boolean).join(' · ')),
      ),
    );
  const listed = showAll ? unread : unread.slice(0, FIRST);
  const toggle = (label: string, run: () => void) =>
    h('button', { class: 'copy', onclick: () => (run(), redraw()) }, label);
  return [
    h(
      'h3',
      {},
      unread.length ? `Argus 새 알림 ${unread.length}` : 'Argus',
      f.system ? h('button', { class: `copy sys-${f.system}`, title: '서버의 시스템 상태 화면을 엽니다', disabled: !f.systemUrl, onclick: () => open2(f.systemUrl) }, `시스템 ${SYSTEM[f.system] ?? f.system}`) : null,
      unread.length ? toggle('모두 읽음', () => markRead(unread)) : null,
    ),
    unread.length ? h('p', { class: 'sev-tally' }, ...count(unread)) : null,
    listed.length
      ? h('ul', { class: 'notice-list' }, ...listed.map(row))
      : h('p', { class: 'quiet' }, f.notices.length ? '새 Argus 알림이 없습니다.' : 'Argus에 진행 중인 알림이 없습니다.'),
    h(
      'p',
      { class: 'notice-more' },
      unread.length > FIRST ? toggle(showAll ? '접기' : `${unread.length - FIRST}개 더 보기`, () => (showAll = !showAll)) : null,
      read.length ? toggle(showRead ? `읽은 알림 숨기기` : `읽은 알림 ${read.length}개 보기`, () => (showRead = !showRead)) : null,
      f.total > f.notices.length ? h('button', { class: 'copy', onclick: () => open2(f.allUrl) }, `서버에서 모두 보기 (${f.total})`) : null,
    ),
    showRead && read.length ? h('ul', { class: 'notice-list read' }, ...read.map(row)) : null,
  ];
}
