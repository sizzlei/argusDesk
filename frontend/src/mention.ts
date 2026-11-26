// "@" in a comment: a list of people to pick from, as in Jira.

import { h } from './ui';

export interface Who {
  id: string;
  name: string;
}

/**
 * Lets people be picked with "@" in a text area. `host` is the box around
 * the text area, where the list is shown. Whoever is picked is added to
 * `picked`: the text then says "@" and the name, and Jira is told who is meant
 * when the comment is sent.
 */
export function mentions(text: HTMLTextAreaElement, host: HTMLElement, picked: Who[], find: (query: string) => Promise<Who[]>, changed: () => void) {
  const list = h('ul', { class: 'mention-list', role: 'listbox', 'aria-label': '멘션할 사람', hidden: true });
  host.append(list);
  let found: Who[] = [];
  let at = -1; // where the "@" being written is
  let on = 0; // the row the keys are on
  let asked = 0; // only the latest question is answered
  let timer = 0;

  const close = () => {
    at = -1;
    list.hidden = true;
    window.clearTimeout(timer);
    asked++;
  };
  const show = (note?: string) => {
    list.replaceChildren(
      ...(note
        ? [h('li', { class: 'quiet' }, note)]
        : found.map((p, i) => {
            const row = h('li', { role: 'option', 'aria-selected': String(i === on), class: i === on ? 'on' : '' }, p.name);
            // mousedown, and kept from taking the cursor: the text area stays where it is typed in
            row.addEventListener('mousedown', (e) => {
              e.preventDefault();
              pick(p);
            });
            return row;
          })),
    );
    list.style.top = `${text.offsetTop + text.offsetHeight + 2}px`;
    list.hidden = false;
  };
  const pick = (p: Who) => {
    const end = text.selectionStart;
    const before = text.value.slice(0, at);
    const put = `@${p.name} `;
    text.value = before + put + text.value.slice(end);
    text.setSelectionRange(before.length + put.length, before.length + put.length);
    if (!picked.some((x) => x.id === p.id)) picked.push(p);
    close();
    changed();
  };
  const look = () => {
    // The "@" starts a word, and what follows it up to the cursor is the name being written.
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(text.value.slice(0, text.selectionStart));
    if (!m) return close();
    at = m.index + m[1].length;
    const query = m[2];
    window.clearTimeout(timer);
    const mine = ++asked;
    if (!query) {
      found = [];
      return show('이름을 입력하면 Jira에서 찾습니다.');
    }
    if (list.hidden) show('찾는 중…');
    timer = window.setTimeout(async () => {
      try {
        const got = await find(query);
        if (mine !== asked) return;
        found = got.slice(0, 8);
        on = 0;
        show(found.length ? undefined : '찾는 사람이 없습니다.');
      } catch {
        if (mine === asked) show('사람을 찾지 못했습니다.');
      }
    }, 200);
  };

  text.addEventListener('input', look);
  text.addEventListener('click', look);
  text.addEventListener('blur', close);
  text.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'Escape') {
      e.preventDefault(); // closes the list, not the window
      e.stopPropagation();
      return close();
    }
    if (e.isComposing || !found.length) return; // a Korean syllable still being composed takes the key
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      on = (on + (e.key === 'ArrowDown' ? 1 : found.length - 1)) % found.length;
      show();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      pick(found[on]);
    }
  });
}
