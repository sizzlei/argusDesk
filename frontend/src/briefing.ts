// The morning briefing: what happened while I was away, on one card. It is
// shown when the app opens, or the window comes back, after a long absence;
// and from my status menu at any time.

import type { Away, Box, Snapshot } from './types';
import { dateTime, h } from './ui';

const SEEN_KEY = 'argusdesk.seenAt'; // when this window was last in view
const GAP = 2 * 60 * 60 * 1000; // away this long: there is something to tell
const MAX_ROWS = 6;

let seenAt = read();
let since = seenAt; // the absence the next briefing covers
let open: HTMLDialogElement | null = null;

function read(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}
function mark() {
  seenAt = Date.now();
  try {
    localStorage.setItem(SEEN_KEY, String(seenAt));
  } catch {
    /* kept for this run only */
  }
}

/**
 * Keeps the time this window was last looked at, and calls `due` when a
 * briefing is owed: at start (once the first snapshot is in) and whenever the
 * window comes back after a long absence. The very first start owes nothing.
 */
export function watchPresence(due: () => void) {
  const owed = () => seenAt > 0 && Date.now() - seenAt >= GAP;
  const startOwed = owed();
  if (!startOwed) mark();
  window.setInterval(() => document.visibilityState === 'visible' && document.hasFocus() && mark(), 60_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') return mark();
    if (owed()) {
      since = seenAt;
      due();
    }
    mark();
  });
  if (startOwed) {
    since = seenAt;
    due();
    mark();
  }
}

/** Opens the briefing. `manual`: asked for from the menu (covers at least the last day). */
export function showBriefing(snap: Snapshot | null, away: Away[], go: (box: Box) => void, manual = false) {
  if (!snap) return;
  open?.close();
  const from = manual ? Math.min(since || Date.now(), Date.now() - 24 * 60 * 60 * 1000) : since;
  const at = (iso?: string) => (iso ? Date.parse(iso) : 0);
  const boxes = snap.boxes;
  const isNew = (b: Box) => at(b.created) > from;
  const sections: [string, string, Box[]][] = [
    ['approval', '내 승인 대기', boxes.filter((b) => b.myApproval)],
    ['reply', '요청자 답변', boxes.filter((b) => b.reply && (b.mine || !b.assigneeId))],
    ['new', '새로 들어온 상자', boxes.filter(isNew).sort((a, b) => at(b.created) - at(a.created))],
    ['moved', '내 상자의 변화', boxes.filter((b) => b.mine && !isNew(b) && at(b.updated) > from).sort((a, b) => at(b.updated) - at(a.updated))],
    ['stale', '내 묵은 상자', boxes.filter((b) => b.mine && b.stale).sort((a, b) => b.staleRatio - a.staleRatio)],
  ];
  const resting = away.filter((a) => a.active && !a.me);
  const hour = new Date().getHours();
  const hello = hour < 11 ? '좋은 아침입니다' : hour < 18 ? '다시 오셨네요' : '늦게까지 고생 많으십니다';

  const dialog = h('dialog', { class: 'brief', 'aria-labelledby': 'brief-title' }) as HTMLDialogElement;
  const close = () => dialog.close();
  const row = (b: Box) =>
    h(
      'li',
      {},
      h(
        'button',
        { onclick: () => (close(), go(b)) },
        h('b', {}, b.key),
        h('span', { class: 'what' }, b.summary),
        h('span', { class: 'quiet' }, [b.status, b.assignee || '미배정'].filter(Boolean).join(' · ')),
      ),
    );
  const any = sections.some(([, , list]) => list.length);
  const parts: (Node | null)[] = [
    h('p', { class: 'quiet' }, `${hello} · ${dateTime(new Date(from).toISOString())} 이후`),
    h('h2', { id: 'brief-title' }, '출근 브리핑'),
    h(
      'ul',
      { class: 'brief-sum' },
      ...sections.map(([kind, name, list]) => h('li', { class: `${kind}${list.length ? '' : ' none'}` }, h('b', {}, String(list.length)), h('span', {}, name))),
    ),
    resting.length ? h('p', { class: 'brief-away' }, `오늘 쉬는 사람: ${resting.map((a) => `${a.name}${a.kind ? ` (${a.kind})` : ''}`).join(', ')}`) : null,
    any
      ? h(
          'div',
          { class: 'brief-body' },
          ...sections
            .filter(([, , list]) => list.length)
            .map(([kind, name, list]) =>
              h(
                'section',
                { class: kind },
                h('h3', {}, name, h('span', { class: 'quiet' }, ` ${list.length}`)),
                h('ul', {}, ...list.slice(0, MAX_ROWS).map(row)),
                list.length > MAX_ROWS ? h('p', { class: 'quiet' }, `외 ${list.length - MAX_ROWS}건`) : null,
              ),
            ),
        )
      : h('p', { class: 'quiet' }, '자리를 비운 사이 바뀐 것이 없습니다.'),
    h('div', { class: 'act-row' }, h('button', { class: 'primary', onclick: close }, '센터로 들어가기')),
  ];
  dialog.append(...parts.filter((p): p is Node => !!p));
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (open === dialog) open = null;
  });
  document.body.append(dialog);
  open = dialog;
  dialog.showModal();
  dialog.querySelector<HTMLButtonElement>('.act-row button')?.focus();
}
