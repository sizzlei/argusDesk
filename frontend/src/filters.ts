// The filter panel: which boxes the room shows beyond "all / mine / unassigned".

import { TAGS } from './scene';
import type { Snapshot } from './types';
import { fill, h } from './ui';
import { type Filter, NO_FILTER, filtering, typesIn } from './view';

let open = false;

export const filtersOpen = () => open;

export function toggleFilters(force?: boolean) {
  open = force ?? !open;
}

const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** Draws the panel for the floor in view. `set` takes the changed filter. */
export function renderFilters(snap: Snapshot | null, space: number, f: Filter, shown: number, total: number, set: (next: Filter) => void, redraw: () => void) {
  const el = document.getElementById('filters')!;
  el.hidden = !open || !snap;
  if (el.hidden || !snap) return;
  const types = space >= 0 && snap.spaces[space] ? typesIn(snap, snap.spaces[space].id) : [];
  const chosen = new Set(f.types);
  const flip = (name: string) => {
    const next = new Set(chosen);
    if (!next.delete(name)) next.add(name);
    set({ ...f, types: [...next] });
  };
  fill(
    el,
    h(
      'div',
      { class: 'panel-head' },
      h('strong', {}, '필터'),
      h('span', { class: 'quiet' }, filtering(f) ? `${total}개 중 ${shown}개 표시` : `전체 ${total}개`),
      h('button', { class: 'close', 'aria-label': '필터 닫기', onclick: () => (toggleFilters(false), redraw()) }, '×'),
    ),
    h(
      'label',
      { class: 'check' },
      (() => {
        const box = h('input', { type: 'checkbox', onchange: () => set({ ...f, staleOnly: !f.staleOnly }) });
        box.checked = f.staleOnly;
        return box;
      })(),
      '묵은 상자만',
    ),
    h('h3', {}, '유형', h('span', { class: 'quiet' }, chosen.size ? `${chosen.size}개 선택` : '전체')),
    types.length
      ? h(
          'div',
          { class: 'chips' },
          ...types.map((t) =>
            h(
              'button',
              { class: chosen.has(t.name) ? 'on' : '', 'aria-pressed': String(chosen.has(t.name)), onclick: () => flip(t.name) },
              h('i', { class: 'tag', style: `background:${css(TAGS[t.tag] ?? TAGS.gray)}` }),
              t.name.replace(/^\[[^\]]+\]\s*/, ''),
            ),
          ),
        )
      : h('p', { class: 'quiet' }, '이 층에는 상자가 없습니다.'),
    filtering(f) ? h('button', { class: 'reset', onclick: () => set({ ...NO_FILTER }) }, '필터 모두 해제') : null,
  );
}
