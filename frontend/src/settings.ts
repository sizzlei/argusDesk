// Settings: behind the gear beside the app's name. What is used now and then
// (display, notifications, the Argus connection, help) lives here, so my
// state keeps to what I use every day.

import type { ProfileAction } from './profile';
import { fill, h } from './ui';

let open = false;
export const settingsOpen = () => open;
export function toggleSettings(force?: boolean) {
  open = force ?? !open;
}

export interface SettingsGroup {
  title: string;
  items: (ProfileAction | false)[];
}

/** Draws the panel; `footer` is the line of versions at the bottom. */
export function renderSettings(groups: SettingsGroup[], footer: string, redraw: () => void) {
  const el = document.getElementById('settings')!;
  el.hidden = !open;
  if (!open) return;
  const close = () => (toggleSettings(false), redraw());
  fill(
    el,
    h('div', { class: 'panel-head' }, h('strong', {}, '설정'), h('button', { class: 'close', 'aria-label': '설정 닫기', onclick: close }, '×')),
    ...groups.flatMap((g) => {
      const items = g.items.filter((a): a is ProfileAction => !!a);
      return items.length
        ? [
            h('h3', {}, g.title),
            h(
              'ul',
              { class: 'actions' },
              ...items.map((a) => h('li', {}, h('button', { class: a.danger ? 'danger' : '', onclick: () => (close(), a.run()) }, a.label), a.note ? h('span', { class: 'quiet' }, a.note) : null)),
            ),
          ]
        : [];
    }),
    h('p', { class: 'quiet' }, footer),
  );
}
