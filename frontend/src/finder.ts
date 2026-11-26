// Quick search: Cmd/Ctrl+K (or "/") opens it, typing narrows the list, Enter
// goes to the box. It looks through every open box, whatever the filter shows.

import { TAGS } from './scene';
import { search } from './search';
import type { Box, Snapshot } from './types';
import { fill, h } from './ui';

let open = false;
let query = '';
let at = 0; // the highlighted result
let source: () => Snapshot | null = () => null;
let go: (box: Box) => void = () => {};
let back: HTMLElement | null = null; // what had the focus before

const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

function close() {
  open = false;
  render();
  back?.focus();
}

function pick(box: Box | undefined) {
  if (!box) return;
  open = false;
  render();
  go(box);
}

function render() {
  const el = document.getElementById('finder')!;
  el.hidden = !open;
  if (!open) return;
  const snap = source();
  const found = snap ? search(snap.boxes, query) : [];
  at = Math.max(0, Math.min(at, found.length - 1));
  const floor = (b: Box) => {
    const i = snap?.spaces.findIndex((s) => s.id === b.space) ?? -1;
    const zone = snap?.spaces[i]?.zones.find((z) => z.id === b.zone)?.name ?? b.status;
    return `${i + 1}F · ${zone}`;
  };
  const list = document.getElementById('finder-list')!;
  fill(
    list,
    ...found.map((b, i) =>
      h(
        'li',
        { role: 'option', id: `finder-${i}`, 'aria-selected': String(i === at), class: i === at ? 'on' : '', onclick: () => pick(b), onmousemove: () => i !== at && ((at = i), render()) },
        h('i', { class: 'tag', style: `background:${css(TAGS[b.tag] ?? TAGS.gray)}` }),
        h('b', {}, b.key),
        h('span', { class: 'what' }, b.summary),
        h('span', { class: 'quiet' }, `${floor(b)} · ${b.assignee || '미배정'}${b.stale ? ' · 묵음' : ''}`),
      ),
    ),
    !found.length ? h('li', { class: 'none quiet' }, query.trim() ? '열려 있는 상자 중에는 없습니다.' : '키, 제목, 요청자, 담당자, 유형으로 찾습니다.') : null,
  );
  const input = document.getElementById('finder-input') as HTMLInputElement;
  input.setAttribute('aria-activedescendant', found.length ? `finder-${at}` : '');
  list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
}

export function openFinder() {
  if (!source()) return;
  back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  open = true;
  query = '';
  at = 0;
  const input = document.getElementById('finder-input') as HTMLInputElement;
  input.value = '';
  render();
  input.focus();
}

/** Sets the search up once: where the boxes come from and what choosing one does. */
export function initFinder(snapshot: () => Snapshot | null, visit: (box: Box) => void) {
  source = snapshot;
  go = visit;
  const el = document.getElementById('finder')!;
  const input = document.getElementById('finder-input') as HTMLInputElement;
  input.addEventListener('input', () => {
    query = input.value;
    at = 0;
    render();
  });
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return; // Korean input in progress: the keys belong to it
    const n = document.querySelectorAll('#finder-list li[role=option]').length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (n) at = (at + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const snap = source();
      pick(snap ? search(snap.boxes, query)[at] : undefined);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });
  el.addEventListener('mousedown', (e) => {
    if (e.target === el) close(); // a click beside the box closes it
  });
  window.addEventListener('keydown', (e) => {
    const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
    if (e.key === '/' && !typing && !open && !e.defaultPrevented) {
      e.preventDefault();
      openFinder();
    }
  });
}

export const finderOpen = () => open;

/** Opens the search, or closes it when it is open. */
export function toggleFinder() {
  if (open) close();
  else openFinder();
}
