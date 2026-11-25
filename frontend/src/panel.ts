// The ticket panel: what a box holds, shown beside the room.

import type { Backend } from './backend';
import { sanitize } from './sanitize';
import type { Box, Snapshot, TicketActions, TicketDetail } from './types';
import { codeBlock, confirmAction, copyButton, dateTime, errText, fill, h, limitText, span, toast } from './ui';

const el = () => document.getElementById('panel')!;

// Details are read from Jira when a box is opened and kept only in memory,
// until the ticket changes.
const details = new Map<string, { updated: string; detail?: TicketDetail; error?: string }>();
let shown = ''; // key of the ticket in the panel

// What can be done with a ticket is asked from Jira the same way.
const actions = new Map<string, { updated: string; actions?: TicketActions; error?: string }>();
// A comment being written survives the panel's redraws.
const drafts = new Map<string, { text: string; isPublic: boolean }>();
let busy = false; // a change is on its way to Jira
// Redrawing replaces the comment box, which would break typing (Korean input
// composes a syllable over several keys). While the box has the cursor, a
// redraw waits here until the cursor leaves.
let pending: (() => void) | null = null;
const typing = () => document.activeElement?.id === 'comment-text';
function flush() {
  // Later, so a click on a button next to the box lands before the redraw.
  setTimeout(() => {
    if (typing()) return;
    const run = pending;
    pending = null;
    run?.();
  }, 200);
}

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
  // Code blocks get a frame and a copy button.
  box.querySelectorAll<HTMLElement>('pre').forEach((pre) => {
    const frame = codeBlock(document.createElement('pre'));
    pre.replaceWith(frame);
    frame.querySelector('pre')!.replaceWith(pre);
  });
  box.querySelectorAll<HTMLElement>('a[data-href]').forEach((a) => {
    a.setAttribute('role', 'link');
    a.tabIndex = 0;
    const open = () => backend.openUrl(a.dataset.href!);
    a.addEventListener('click', open);
    a.addEventListener('keydown', (e) => e.key === 'Enter' && open());
  });
  return box;
}

/**
 * Sends one change to Jira. The panel is locked while it is on its way; what
 * was known about the ticket is forgotten so it is read again afterwards.
 */
async function act(b: Box, done: string, run: () => Promise<void>, redraw: () => void) {
  if (busy) return;
  busy = true;
  redraw();
  try {
    await run();
    actions.delete(b.key);
    details.delete(b.key);
    toast(done);
  } catch (e) {
    toast(errText(e), 'error');
  } finally {
    busy = false;
    redraw();
  }
}

const DECISION: Record<string, string> = { pending: '대기', approved: '승인', declined: '반려' };

/** The "처리" part of the panel: assignee, approvals, moves and a comment box. */
function renderActions(host: HTMLElement, b: Box, snap: Snapshot, backend: Backend) {
  const redraw = () => {
    const now = document.getElementById('actions');
    const box = snap.boxes.find((x) => x.key === b.key) ?? b;
    if (shown === b.key && now) renderActions(now, box, snap, backend);
  };
  if (typing() && !busy && host.childElementCount) {
    pending = redraw;
    return;
  }
  const entry = actions.get(b.key);
  if (!entry || entry.updated !== b.updated) {
    actions.set(b.key, { updated: b.updated, actions: entry?.actions }); // keep showing the old ones meanwhile
    backend.ticketActions(b.key).then(
      (a) => actions.set(b.key, { updated: b.updated, actions: a }),
      (e) => actions.set(b.key, { updated: b.updated, error: errText(e) }),
    ).finally(redraw);
  }
  const a = actions.get(b.key)?.actions;
  const error = actions.get(b.key)?.error;
  const off = busy || undefined;

  // assignee
  const others = snap.members.filter((m) => m.space === b.space && !m.me && m.id !== b.assigneeId);
  const pick = h('select', { 'aria-label': '다른 담당자에게 배정', disabled: off }, h('option', { value: '' }, '다른 사람에게…'));
  others.forEach((m) => pick.append(h('option', { value: m.id }, m.name)));
  pick.addEventListener('change', async () => {
    const m = others.find((x) => x.id === pick.value);
    pick.value = '';
    if (m && (await confirmAction('담당자 변경', `${b.key}을(를) ${m.name} 님에게 배정합니다.`, '배정')))
      void act(b, `${m.name} 님에게 배정했습니다.`, () => backend.assignTicket(b.key, m.id), redraw);
  });
  const assign = h(
    'div',
    { class: 'act-row' },
    b.mine
      ? null
      : h(
          'button',
          {
            class: 'primary',
            disabled: off,
            onclick: async () => {
              const from = b.assignee ? `현재 담당자는 ${b.assignee} 님입니다. ` : '';
              if (b.assignee && !(await confirmAction('담당자 변경', `${from}${b.key}을(를) 나에게 배정합니다.`, '나에게 배정'))) return;
              void act(b, '나에게 배정했습니다.', () => backend.assignTicket(b.key, 'me'), redraw);
            },
          },
          '나에게 배정',
        ),
    others.length ? pick : null,
    b.assigneeId
      ? h(
          'button',
          {
            disabled: off,
            onclick: async () => {
              if (await confirmAction('배정 해제', `${b.key}의 담당자(${b.assignee})를 비웁니다.`, '배정 해제'))
                void act(b, '배정을 해제했습니다.', () => backend.assignTicket(b.key, ''), redraw);
            },
          },
          '배정 해제',
        )
      : null,
  );

  // approvals
  const approvals = (a?.approvals ?? []).map((ap) =>
    h(
      'div',
      { class: 'approval' },
      h('p', {}, h('b', {}, ap.name || '승인'), ' 대기 중'),
      ap.approvers.length
        ? h('ul', {}, ...ap.approvers.map((p) => h('li', { class: p.decision }, `${p.name} · ${DECISION[p.decision] ?? p.decision}`)))
        : null,
      ap.canAnswer
        ? h(
            'div',
            { class: 'act-row' },
            h(
              'button',
              {
                class: 'primary',
                disabled: off,
                onclick: async () => {
                  if (await confirmAction('승인', `${b.key} "${b.summary}"을(를) 승인합니다. Jira에 바로 반영되며 되돌릴 수 없습니다.`, '승인'))
                    void act(b, '승인했습니다.', () => backend.answerApproval(b.key, ap.id, true), redraw);
                },
              },
              '승인',
            ),
            h(
              'button',
              {
                class: 'danger',
                disabled: off,
                onclick: async () => {
                  if (await confirmAction('반려', `${b.key} "${b.summary}"을(를) 반려합니다. Jira에 바로 반영되며 되돌릴 수 없습니다.`, '반려', true))
                    void act(b, '반려했습니다.', () => backend.answerApproval(b.key, ap.id, false), redraw);
                },
              },
              '반려',
            ),
          )
        : h('p', { class: 'quiet' }, '내가 답할 수 있는 승인이 아닙니다.'),
    ),
  );

  // An approval made by moving the box on (a workflow step, where there is no
  // service desk approval): the moves are shown as approve / reject. Jira lists
  // only the moves this user may make, so an empty list means it is not my call.
  const zone = snap.spaces.find((s) => s.id === b.space)?.zones.find((z) => z.id === b.zone);
  const byMove = !!zone?.approval && approvals.length === 0 && !!a;
  const decide = byMove ? (a?.transitions ?? []).filter((t) => !t.needs.length) : [];
  const stepApproval = byMove
    ? h(
        'div',
        { class: 'approval' },
        h('p', {}, h('b', {}, b.status), ' · 승인 대기 중'),
        decide.length
          ? h(
              'div',
              { class: 'act-row' },
              ...decide.map((t) => {
                const reject = t.toKind === 'returned';
                return h(
                  'button',
                  {
                    class: reject ? 'danger' : 'primary',
                    disabled: off,
                    onclick: async () => {
                      const what = reject ? '반려(취소)' : '승인';
                      if (await confirmAction(what, `${b.key} "${b.summary}"을(를) "${t.toName}"(으)로 옮깁니다. Jira에 바로 반영됩니다.`, t.name, reject))
                        void act(b, `"${t.toName}"(으)로 옮겼습니다.`, () => backend.moveTicket(b.key, t.id), redraw);
                    },
                  },
                  t.name,
                );
              }),
            )
          : h('p', { class: 'quiet' }, '내가 승인할 수 있는 단계가 아닙니다. 승인자가 처리하면 상자가 움직입니다.'),
      )
    : null;

  // moves
  const moves = (a?.transitions ?? []).filter((t) => !decide.includes(t)).map((t) =>
    t.needs.length
      ? h(
          'button',
          { disabled: true, title: `필수 입력(${t.needs.join(', ')})이 있어 Jira에서 진행해야 합니다.` },
          `${t.name} · Jira에서`,
        )
      : h(
          'button',
          {
            disabled: off,
            onclick: async () => {
              if (await confirmAction('상태 이동', `${b.key}을(를) "${b.status}"에서 "${t.toName}"(으)로 옮깁니다.`, t.name))
                void act(b, `"${t.toName}"(으)로 옮겼습니다.`, () => backend.moveTicket(b.key, t.id), redraw);
            },
          },
          t.toName && t.toName !== t.name ? `${t.name} → ${t.toName}` : t.name,
        ),
  );

  // comment: a service desk request takes internal notes and public answers,
  // a ticket of an ordinary project takes plain comments
  const desk = a?.serviceDesk ?? true;
  const draft = drafts.get(b.key) ?? { text: '', isPublic: false };
  const old = document.getElementById('comment-text') as HTMLTextAreaElement | null;
  const focused = old && document.activeElement === old ? [old.selectionStart, old.selectionEnd] : null;
  const text = h('textarea', { id: 'comment-text', rows: '3', placeholder: '댓글 쓰기', disabled: off });
  text.value = draft.text;
  const send = h('button', { class: 'primary' });
  const audience = h('select', { 'aria-label': '댓글 공개 범위', disabled: off },
    h('option', { value: 'internal' }, '내부 메모 (팀만 봄)'),
    h('option', { value: 'public' }, '요청자에게 답변 (공개)'),
  );
  audience.value = draft.isPublic ? 'public' : 'internal';
  const mode = () => (!desk ? 'plain' : audience.value === 'public' ? 'public' : 'internal');
  const keep = () => {
    drafts.set(b.key, { text: text.value, isPublic: audience.value === 'public' });
    send.disabled = busy || !a || !text.value.trim(); // not before Jira said what kind of ticket this is
    send.textContent = { plain: '댓글 등록', public: '요청자에게 답변', internal: '내부 메모 남기기' }[mode()];
  };
  keep();
  text.addEventListener('input', keep);
  text.addEventListener('blur', flush);
  audience.addEventListener('change', keep);
  send.addEventListener('click', async () => {
    const body = text.value.trim();
    const how = mode();
    if (!body) return;
    // A public comment reaches the requester, so it is confirmed first.
    if (how === 'public' && !(await confirmAction('요청자에게 답변', `${b.reporter} 님에게 보이는 공개 댓글로 등록합니다.`, '등록'))) return;
    void act(
      b,
      { plain: '댓글을 등록했습니다.', public: '답변을 등록했습니다.', internal: '내부 메모를 남겼습니다.' }[how],
      async () => {
        await backend.addComment(b.key, body, how);
        drafts.delete(b.key);
      },
      redraw,
    );
  });

  fill(
    host,
    h('h3', {}, '처리', busy ? h('span', { class: 'chip' }, 'Jira에 반영 중') : null),
    h('div', { class: 'act' }, h('span', { class: 'act-name' }, '담당자'), assign),
    ...approvals,
    stepApproval,
    a?.approvalsError ? h('p', { class: 'quiet' }, `승인 정보를 읽지 못했습니다: ${a.approvalsError}`) : null,
    error ? h('p', { class: 'error' }, `가능한 처리를 불러오지 못했습니다: ${error}`) : null,
    !a && !error
      ? h('p', { class: 'quiet' }, '가능한 처리를 불러오는 중입니다.')
      : a
        ? h('div', { class: 'act' }, h('span', { class: 'act-name' }, '이동'), moves.length ? h('div', { class: 'act-row' }, ...moves) : h('span', { class: 'quiet' }, byMove && decide.length ? '위의 승인 단계에서 처리합니다.' : '지금 옮길 수 있는 상태가 없습니다.'))
        : null,
    h('div', { class: 'comment-box' }, text, h('div', { class: 'act-row' }, desk ? audience : null, send)),
  );
  if (focused) {
    text.focus();
    text.setSelectionRange(focused[0], focused[1]);
  }
}

/** Does a form answer read as SQL or a script rather than prose? */
function looksLikeCode(v: string) {
  const sql = /^\s*(select|insert|update|delete|alter|create|drop|grant|revoke|truncate|rename|call|explain|with|set|use|begin|commit|show|db\.)\b/im;
  return sql.test(v) || /;\s*$/m.test(v) || (/^(\s{2,}|\t)\S/m.test(v) && /[(){};=]/.test(v));
}

/** One answer of a form: short ones on a line, long ones full width, code in a block. */
function answer(label: string, value: string) {
  const wide = value.includes('\n') || value.length > 40;
  const name = h('dt', {}, label || '(이름 없는 항목)');
  if (!wide) return h('div', { class: 'answer' }, name, h('dd', {}, value));
  if (looksLikeCode(value)) {
    const pre = h('pre', {}, value);
    return h('div', { class: 'answer wide' }, name, h('dd', { class: 'plain' }, codeBlock(pre)));
  }
  name.append(copyButton(() => value));
  return h('div', { class: 'answer wide' }, name, h('dd', {}, value));
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
            ...answered.map((a) => answer(a.label, a.value)),
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
  if (shown === b.key && typing() && !busy) {
    pending = () => showPanel(b, snap, backend, close);
    return;
  }
  pending = null;
  // The panel is redrawn on every refresh: keep the reader's place.
  const scroll = shown === b.key ? p.scrollTop : 0;
  shown = b.key;
  const zone = snap.spaces.find((s) => s.id === b.space)?.zones.find((z) => z.id === b.zone);
  const detail = h('div', { id: 'detail' });
  const work = h('section', { id: 'actions' });
  p.hidden = false;
  fill(
    p,
    h(
      'div',
      { class: 'panel-head' },
      h('span', { class: `tag tag-${b.tag || 'gray'}` }, b.type),
      h('button', { class: 'close', 'aria-label': '패널 닫기', onclick: close }, '×'),
    ),
    h(
      'p',
      { class: 'key' },
      b.key,
      copyButton(() => b.key),
      copyButton(() => b.url, '링크 복사'),
      h('button', { class: 'copy', type: 'button', onclick: () => backend.openUrl(b.url) }, 'Jira에서 열기'),
    ),
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
    work,
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
  );
  renderActions(work, b, snap, backend);
  renderDetail(detail, b, backend);
  p.scrollTop = scroll;
}
