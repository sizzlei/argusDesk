// The ticket panel: what a box holds, shown beside the room.

import type { Backend } from './backend';
import { sanitize } from './sanitize';
import type { Box, Snapshot, TicketDetail } from './types';
import { dateTime, errText, fill, h, limitText, span } from './ui';

const el = () => document.getElementById('panel')!;

// Details are read from Jira when a box is opened and kept only in memory,
// until the ticket changes.
const details = new Map<string, { updated: string; detail?: TicketDetail; error?: string }>();
let shown = ''; // key of the ticket in the panel

function row(name: string, value: string | Node | undefined) {
  if (!value) return null;
  return h('div', { class: 'row' }, h('dt', {}, name), h('dd', {}, value));
}

function ageLine(b: Box, snap: Snapshot): Node | undefined {
  const zone = snap.spaces.find((s) => s.id === b.space)?.zones.find((z) => z.id === b.zone);
  if (b.note) return h('span', { class: 'chip quiet' }, b.note);
  if (!zone?.staleAfter || !b.staleFrom) return undefined;
  const elapsed = Date.parse(snap.fetchedAt) - Date.parse(b.staleFrom);
  const limit = limitText(zone.staleAfter);
  if (elapsed <= 0) return h('span', {}, `기준 시각 ${dateTime(b.staleFrom)} (아직 지나지 않음)`);
  return h(
    'span',
    { class: b.stale ? 'old' : '' },
    b.stale ? `묵은 상자: ${span(elapsed)} 경과 (기준 ${limit})` : `${span(elapsed)} 경과 (기준 ${limit})`,
  );
}

/** Untrusted HTML from Jira, made safe; its links open through the app. */
function rich(html: string, backend: Backend) {
  const box = h('div', { class: 'rich' });
  box.append(sanitize(html));
  box.querySelectorAll<HTMLElement>('a[data-href]').forEach((a) => {
    a.setAttribute('role', 'link');
    a.tabIndex = 0;
    const open = () => backend.openUrl(a.dataset.href!);
    a.addEventListener('click', open);
    a.addEventListener('keydown', (e) => e.key === 'Enter' && open());
  });
  return box;
}

function renderDetail(host: HTMLElement, b: Box, backend: Backend) {
  const entry = details.get(b.key);
  if (!entry || entry.updated !== b.updated) {
    details.set(b.key, { updated: b.updated });
    fill(host, h('p', { class: 'quiet' }, '내용을 불러오는 중입니다.'));
    backend.ticketDetail(b.key).then(
      (detail) => details.set(b.key, { updated: b.updated, detail }),
      (e) => details.set(b.key, { updated: b.updated, error: errText(e) }),
    ).finally(() => {
      // Draw only if the panel still shows this ticket.
      const now = document.getElementById('detail');
      if (shown === b.key && now) renderDetail(now, b, backend);
    });
    return;
  }
  if (entry.error) {
    fill(host, h('p', { class: 'error' }, `내용을 불러오지 못했습니다: ${entry.error}`));
    return;
  }
  const d = entry.detail;
  if (!d) {
    fill(host, h('p', { class: 'quiet' }, '내용을 불러오는 중입니다.'));
    return;
  }
  // Requests made from a form keep their content in the form, so forms come
  // first. Unanswered questions are left out.
  const forms = d.forms.map((f) => {
    const answered = f.answers.filter((a) => a.value.trim());
    return h(
      'section',
      { class: 'form' },
      h('h3', {}, f.name || '양식', f.submitted ? null : h('span', { class: 'chip' }, '작성 중')),
      answered.length
        ? h(
            'dl',
            {},
            ...answered.map((a) =>
              // Long or multi-line answers (SQL, reasons) get the full width.
              h(
                'div',
                { class: a.value.includes('\n') || a.value.length > 40 ? 'answer wide' : 'answer' },
                h('dt', {}, a.label || '(이름 없는 항목)'),
                h('dd', {}, a.value),
              ),
            ),
          )
        : h('p', { class: 'quiet' }, '작성된 항목이 없습니다.'),
    );
  });
  const hasDescription = d.descriptionHtml.trim() !== '';
  fill(
    host,
    ...forms,
    d.formsError ? h('p', { class: 'error' }, `양식을 불러오지 못했습니다: ${d.formsError}`) : null,
    // A ticket with forms and no description does not need an empty heading.
    hasDescription || forms.length === 0 ? h('h3', {}, '설명') : null,
    hasDescription ? rich(d.descriptionHtml, backend) : forms.length === 0 ? h('p', { class: 'quiet' }, '설명이 없습니다.') : null,
    d.attachments ? h('p', { class: 'quiet' }, `첨부파일 ${d.attachments}개는 Jira에서 볼 수 있습니다.`) : null,
    h('h3', {}, d.comments.length ? `댓글 ${d.comments.length}개` : '댓글'),
    d.comments.length
      ? h(
          'ol',
          { class: 'comments' },
          ...d.comments.map((c) =>
            h(
              'li',
              { class: c.internal ? 'internal' : '' },
              h(
                'p',
                { class: 'meta' },
                h('b', {}, c.author),
                ` · ${dateTime(c.created)}`,
                c.internal ? h('span', { class: 'chip' }, '내부 메모') : null,
              ),
              rich(c.bodyHtml, backend),
            ),
          ),
        )
      : h('p', { class: 'quiet' }, '댓글이 없습니다.'),
  );
}

export function showPanel(b: Box | null, snap: Snapshot | null, backend: Backend, close: () => void) {
  const p = el();
  if (!b || !snap) {
    shown = '';
    p.hidden = true;
    p.replaceChildren();
    return;
  }
  // The panel is redrawn on every refresh: keep the reader's place.
  const scroll = shown === b.key ? p.scrollTop : 0;
  shown = b.key;
  const zone = snap.spaces.find((s) => s.id === b.space)?.zones.find((z) => z.id === b.zone);
  const detail = h('div', { id: 'detail' });
  p.hidden = false;
  fill(
    p,
    h(
      'div',
      { class: 'panel-head' },
      h('span', { class: `tag tag-${b.tag || 'gray'}` }, b.type),
      h('button', { class: 'close', 'aria-label': '패널 닫기', onclick: close }, '×'),
    ),
    h('p', { class: 'key' }, b.key),
    h('h2', {}, b.summary),
    h(
      'dl',
      {},
      row('구역', zone?.name),
      row('상태', b.status),
      row('담당자', b.assignee || '미배정'),
      row('요청자', b.reporter),
      row('우선순위', b.priority),
      row('접수', dateTime(b.created)),
      row('구역 도착', dateTime(b.enteredAt)),
      row('경과', ageLine(b, snap)),
    ),
    b.path?.length
      ? h(
          'div',
          { class: 'route' },
          h('h3', {}, '경로'),
          h(
            'ol',
            {},
            ...b.path.map((s) =>
              h('li', { class: s.state }, h('span', { class: 'stamp', 'aria-hidden': 'true' }, s.state === 'done' ? '✓' : ''), s.name),
            ),
          ),
        )
      : null,
    detail,
    h('button', { class: 'primary', onclick: () => backend.openUrl(b.url) }, 'Jira에서 열기'),
  );
  renderDetail(detail, b, backend);
  p.scrollTop = scroll;
}
