// Release notes, written in Markdown in this repository, shown as headings
// and lists. Only a small, known part of Markdown is read, and everything is
// built as DOM nodes: nothing in the notes is ever run or parsed as HTML.

import { h } from './ui';

/** `**bold**` and `code` inside a line. */
function inline(text: string): (Node | string)[] {
  const out: (Node | string)[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) out.push(text.slice(at, m.index));
    out.push(m[1] !== undefined ? h('strong', {}, m[1]) : h('code', {}, m[2]));
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** Renders release notes: `#` headings, `-` lists (one level of nesting), paragraphs. */
export function renderNotes(md: string): HTMLElement {
  const root = h('div', { class: 'release-notes' });
  let list: HTMLElement | null = null; // the open top-level list
  let item: HTMLElement | null = null; // its last item, for nested points
  let sub: HTMLElement | null = null; // the nested list under it
  let para: string[] = [];
  const flush = () => {
    if (para.length) root.append(h('p', {}, ...inline(para.join(' '))));
    para = [];
  };
  const endList = () => {
    list = item = sub = null;
  };
  for (const raw of md.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    const bullet = /^(\s*)[-*]\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flush();
      continue;
    }
    if (heading) {
      flush();
      endList();
      root.append(h(heading[1].length <= 2 ? 'h3' : 'h4', {}, ...inline(heading[2])));
    } else if (bullet) {
      flush();
      const nested = bullet[1].length >= 2 && item;
      if (nested) {
        if (!sub) {
          sub = h('ul', {});
          item!.append(sub);
        }
        sub.append(h('li', {}, ...inline(bullet[2])));
      } else {
        if (!list) {
          list = h('ul', {});
          root.append(list);
        }
        item = h('li', {}, ...inline(bullet[2]));
        sub = null;
        list.append(item);
      }
    } else if (/^\s{2,}\S/.test(raw) && item) {
      // a wrapped line of the point above
      (sub?.lastElementChild ?? item).append(' ', ...inline(line.trim()));
    } else {
      endList();
      para.push(line.trim());
    }
  }
  flush();
  if (!root.childNodes.length) root.append(h('p', { class: 'quiet' }, '릴리스 노트가 없습니다.'));
  return root;
}
