// Ticket windows: what a box holds, in a window floating over the room.

import type { Backend } from './backend';
import { sanitize } from './sanitize';
import type { Box, Snapshot, TicketActions, TicketDetail } from './types';
import { codeBlock, confirmAction, copyButton, dateTime, errText, fill, h, limitText, span, toast } from './ui';

// Details are read from Jira when a ticket is opened and kept only in memory,
// until the ticket changes. What can be done with it is asked the same way.
const details = new Map<string, { updated: string; detail?: TicketDetail; error?: string }>();
const actions = new Map<string, { updated: string; actions?: TicketActions; error?: string }>();
// A comment being written survives a window's redraws, and its closing.
const drafts = new Map<string, { text: string; isPublic: boolean }>();

/** One open ticket window. Several can be open at once. */
interface Win {
  key: string;
  box: Box;
  el: HTMLElement;
  body: HTMLElement; // the scrolling part
  actionsEl: HTMLElement | null;
  detailEl: HTMLElement | null;
  cancelEl: HTMLElement | null; // top of the window: where a request is cancelled
  min: boolean; // minimised: shrunk to its title bar, still where it was put
  size: { w: string; h: string }; // its size before it was minimised
  text: HTMLTextAreaElement | null; // the comment box's text area
  commentBox: HTMLElement | null; // built with the actions, shown with the comments
  busy: boolean; // a change is on its way to Jira
  // Redrawing replaces the comment box, which would break typing (Korean input
  // composes a syllable over several keys). While the box has the cursor, a
  // redraw waits here until the cursor leaves.
  pending: (() => void) | null;
}

const wins = new Map<string, Win>();
let top = 20; // z-index of the window in front
const MAX_WINDOWS = 6;

const typing = (w: Win) => !!w.text && document.activeElement === w.text;
function flush(w: Win) {
  // Later, so a click on a button next to the box lands before the redraw.
  setTimeout(() => {
    if (typing(w)) return;
    const run = w.pending;
    w.pending = null;
    run?.();
  }, 200);
}
function commentSlot(w: Win) {
  const slot = h('div', { class: 'comment-slot' });
  if (w.commentBox) slot.append(w.commentBox);
  return slot;
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
 * Sends one change to Jira. The window is locked while it is on its way; what
 * was known about the ticket is forgotten so it is read again afterwards.
 */
async function act(w: Win, done: string, run: () => Promise<void>, redraw: () => void) {
  const b = w.box;
  if (w.busy) return;
  w.busy = true;
  redraw();
  try {
    await run();
    actions.delete(b.key);
    details.delete(b.key);
    toast(done);
  } catch (e) {
    toast(errText(e), 'error');
  } finally {
    w.busy = false;
    redraw();
  }
}

const DECISION: Record<string, string> = { pending: '대기', approved: '승인', declined: '반려' };

/** The "처리" part of the panel: assignee, approvals, moves and a comment box. */
function renderActions(w: Win, snap: Snapshot, backend: Backend) {
  const host = w.actionsEl;
  if (!host) return;
  const b = w.box;
  const busy = w.busy;
  const redraw = () => {
    if (wins.get(w.key) === w) renderActions(w, snap, backend);
  };
  if (typing(w) && !busy && host.childElementCount) {
    w.pending = redraw;
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
      void act(w, `${m.name} 님에게 배정했습니다.`, () => backend.assignTicket(b.key, m.id), redraw);
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
              void act(w, '나에게 배정했습니다.', () => backend.assignTicket(b.key, 'me'), redraw);
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
                void act(w, '배정을 해제했습니다.', () => backend.assignTicket(b.key, ''), redraw);
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
                    void act(w, '승인했습니다.', () => backend.answerApproval(b.key, ap.id, true), redraw);
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
                    void act(w, '반려했습니다.', () => backend.answerApproval(b.key, ap.id, false), redraw);
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
                        void act(w, `"${t.toName}"(으)로 옮겼습니다.`, () => backend.moveTicket(b.key, t.id), redraw);
                    },
                  },
                  t.name,
                );
              }),
            )
          : h('p', { class: 'quiet' }, '내가 승인할 수 있는 단계가 아닙니다. 승인자가 처리하면 상자가 움직입니다.'),
      )
    : null;

  // Cancelling a request is kept away from the other moves, at the top of the
  // window, so that it is not pressed by mistake.
  const cancels = (a?.transitions ?? []).filter((t) => t.toKind === 'returned' && !decide.includes(t));
  if (w.cancelEl) {
    fill(
      w.cancelEl,
      ...cancels.map((t) =>
        t.needs.length
          ? h('button', { class: 'copy', disabled: true, title: `필수 입력(${t.needs.join(', ')})이 있어 Jira에서 진행해야 합니다.` }, `${t.name} · Jira에서`)
          : h(
              'button',
              {
                class: 'copy danger',
                disabled: off,
                onclick: async () => {
                  if (await confirmAction(t.name, `${b.key} "${b.summary}"을(를) "${t.toName}"(으)로 옮깁니다. 요청이 취소되며 Jira에 바로 반영됩니다.`, t.name, true))
                    void act(w, `"${t.toName}"(으)로 옮겼습니다.`, () => backend.moveTicket(b.key, t.id), redraw);
                },
              },
              t.name,
            ),
      ),
    );
  }

  // moves
  const moves = (a?.transitions ?? []).filter((t) => !decide.includes(t) && !cancels.includes(t)).map((t) =>
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
                void act(w, `"${t.toName}"(으)로 옮겼습니다.`, () => backend.moveTicket(b.key, t.id), redraw);
            },
          },
          t.toName && t.toName !== t.name ? `${t.name} → ${t.toName}` : t.name,
        ),
  );

  // comment: a service desk request takes internal notes and public answers,
  // a ticket of an ordinary project takes plain comments
  const desk = a?.serviceDesk ?? true;
  const draft = drafts.get(b.key) ?? { text: '', isPublic: false };
  const old = w.text;
  const focused = old && document.activeElement === old ? [old.selectionStart, old.selectionEnd] : null;
  const text = h('textarea', { class: 'comment-text', rows: '3', placeholder: '댓글 쓰기', 'aria-label': `${b.key} 댓글`, disabled: off });
  w.text = text;
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
    send.disabled = w.busy || !a || !text.value.trim(); // not before Jira said what kind of ticket this is
    send.textContent = { plain: '댓글 등록', public: '요청자에게 답변', internal: '내부 메모 남기기' }[mode()];
  };
  keep();
  text.addEventListener('input', keep);
  text.addEventListener('blur', () => flush(w));
  audience.addEventListener('change', keep);
  send.addEventListener('click', async () => {
    const body = text.value.trim();
    const how = mode();
    if (!body) return;
    // A public comment reaches the requester, so it is confirmed first.
    if (how === 'public' && !(await confirmAction('요청자에게 답변', `${b.reporter} 님에게 보이는 공개 댓글로 등록합니다.`, '등록'))) return;
    void act(
      w,
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
  );
  // Writing a comment happens where the comments are read: at the top of that list.
  w.commentBox = h('div', { class: 'comment-box' }, text, h('div', { class: 'act-row' }, desk ? audience : null, send));
  w.detailEl?.querySelector('.comment-slot')?.replaceChildren(w.commentBox);
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

function renderDetail(w: Win, backend: Backend) {
  const host = w.detailEl;
  if (!host) return;
  const b = w.box;
  const entry = details.get(b.key);
  if (!entry || entry.updated !== b.updated) {
    details.set(b.key, { updated: b.updated });
    fill(host, h('p', { class: 'quiet' }, '내용을 불러오는 중입니다.'), h('h3', {}, '댓글'), commentSlot(w));
    backend.ticketDetail(b.key).then(
      (detail) => details.set(b.key, { updated: b.updated, detail }),
      (e) => details.set(b.key, { updated: b.updated, error: errText(e) }),
    ).finally(() => {
      // Draw only if the window is still open.
      if (wins.get(w.key) !== w) return;
      // Redrawing moves the comment box: wait while someone is typing in it.
      if (typing(w)) w.pending = () => renderDetail(w, backend);
      else renderDetail(w, backend);
    });
    return;
  }
  if (entry.error) {
    fill(host, h('p', { class: 'error' }, `내용을 불러오지 못했습니다: ${entry.error}`), h('h3', {}, '댓글'), commentSlot(w));
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
    commentSlot(w),
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

/** Draws a window's content for its ticket as it is in this snapshot. */
function draw(w: Win, snap: Snapshot, backend: Backend) {
  if (typing(w) && !w.busy) {
    w.pending = () => draw(w, snap, backend);
    return;
  }
  w.pending = null;
  const b = w.box;
  // A window is redrawn on every refresh: keep the reader's place.
  const scroll = w.body.scrollTop;
  const zone = snap.spaces.find((s) => s.id === b.space)?.zones.find((z) => z.id === b.zone);
  w.detailEl = h('div', { class: 'tw-detail' });
  w.actionsEl = h('section', { class: 'tw-actions' });
  w.cancelEl = h('span', { class: 'tw-cancel' });
  // Minimised, the title bar shows the type as a colour only, then the number and the summary.
  w.el.querySelector('.tw-title')!.replaceChildren(
    h('span', { class: `tag tag-${b.tag || 'gray'}`, title: b.type }, h('span', { class: 'tag-name' }, b.type)),
    h('b', {}, b.key),
    h('span', { class: 'tw-sum', title: b.summary }, b.summary),
  );
  fill(
    w.body,
    h(
      'p',
      { class: 'key' },
      b.key,
      copyButton(() => b.key),
      copyButton(() => b.url, '링크 복사'),
      h('button', { class: 'copy', type: 'button', onclick: () => backend.openUrl(b.url) }, 'Jira에서 열기'),
      w.cancelEl,
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
    w.actionsEl,
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
    w.detailEl,
  );
  renderActions(w, snap, backend);
  renderDetail(w, backend);
  w.body.scrollTop = scroll;
}

export interface TicketHooks {
  /** A window came to the front: its box is the one marked in the room. */
  onFocus(key: string): void;
  onClose(key: string): void;
}

/** Shrinks a window to its title bar, or opens it out again at the size it had. */
function setMin(w: Win, min: boolean) {
  if (w.min === min) return;
  w.min = min;
  if (min) {
    w.size = { w: w.el.style.width, h: w.el.style.height };
    w.el.style.width = '';
    w.el.style.height = '';
  } else {
    w.el.style.width = w.size.w;
    w.el.style.height = w.size.h;
  }
  w.el.classList.toggle('mini', min);
  const fold = w.el.querySelector<HTMLElement>('.fold')!;
  fold.textContent = min ? '▢' : '–';
  fold.title = min ? '펼치기' : '최소화';
  fold.setAttribute('aria-label', `${w.key} 창 ${min ? '펼치기' : '최소화'}`);
}

function front(w: Win, hooks: TicketHooks) {
  w.el.style.zIndex = String(++top);
  // A window dragged out of sight comes back when it is asked for.
  const host = w.el.parentElement;
  if (host && (w.el.offsetLeft > host.clientWidth - 120 || w.el.offsetTop > host.clientHeight - 60 || w.el.offsetLeft + w.el.offsetWidth < 120)) {
    w.el.style.left = `${Math.max(12, host.clientWidth - w.el.offsetWidth - 16)}px`;
    w.el.style.top = '66px';
  }
  wins.forEach((o) => o.el.classList.toggle('front', o === w));
  hooks.onFocus(w.key);
}

function close(w: Win, hooks: TicketHooks) {
  w.el.remove();
  wins.delete(w.key);
  hooks.onClose(w.key);
}

/**
 * Opens a ticket in its own window, or brings its window to the front if it
 * is open already. Windows float over the room, can be dragged by their title
 * and resized, and several can stay open side by side.
 */
export function openTicket(b: Box, snap: Snapshot, backend: Backend, hooks: TicketHooks) {
  const host = document.getElementById('windows')!;
  let w = wins.get(b.key);
  if (w) {
    w.box = b;
    setMin(w, false);
    front(w, hooks);
    draw(w, snap, backend);
    return;
  }
  // Room for one more: the window opened longest ago goes.
  if (wins.size >= MAX_WINDOWS) close(wins.values().next().value!, hooks);

  const title = h('div', { class: 'tw-title' });
  const shut = h('button', { class: 'close', 'aria-label': `${b.key} 창 닫기` }, '×');
  const fold = h('button', { class: 'close fold', 'aria-label': `${b.key} 창 최소화`, title: '최소화' }, '–');
  const head = h('header', { class: 'tw-head' }, title, h('span', { class: 'tw-buttons' }, fold, shut));
  const body = h('div', { class: 'tw-body' });
  const el = h('section', { class: 'tw', role: 'dialog', 'aria-label': `${b.key} ${b.summary}` }, head, body);
  const win: Win = { key: b.key, box: b, el, body, actionsEl: null, detailEl: null, cancelEl: null, min: false, size: { w: '', h: '' }, text: null, commentBox: null, busy: false, pending: null };
  w = win;
  wins.set(b.key, win);

  // Each new window opens a step down and to the left of the last, from the right edge.
  const n = wins.size - 1;
  const width = Math.min(560, host.clientWidth - 24);
  el.style.width = `${width}px`;
  el.style.left = `${Math.max(12, host.clientWidth - width - 16 - n * 32)}px`;
  el.style.top = `${66 + n * 30}px`;

  shut.addEventListener('click', () => close(win, hooks));
  // Minimised, a window is just its title bar: small, and still movable.
  fold.addEventListener('click', () => setMin(win, !win.min));
  head.addEventListener('dblclick', (e) => {
    if (!(e.target as HTMLElement).closest('button')) setMin(win, !win.min);
  });
  el.addEventListener(
    'pointerdown',
    (e) => {
      if (!(e.target as HTMLElement).closest('.tw-buttons')) front(win, hooks);
    },
    true,
  );
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !typing(win)) close(win, hooks);
  });
  // drag by the title bar, kept inside the window of the app
  head.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const sx = e.clientX - el.offsetLeft;
    const sy = e.clientY - el.offsetTop;
    head.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) => {
      el.style.left = `${Math.min(host.clientWidth - 80, Math.max(80 - el.offsetWidth, m.clientX - sx))}px`;
      el.style.top = `${Math.min(host.clientHeight - 40, Math.max(0, m.clientY - sy))}px`;
    };
    const stop = () => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', stop);
      head.removeEventListener('pointercancel', stop);
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', stop);
    head.addEventListener('pointercancel', stop);
  });

  host.append(el);
  front(win, hooks);
  draw(win, snap, backend);
}

/** Brings every open window up to date with a new snapshot. */
export function syncTickets(snap: Snapshot, backend: Backend) {
  wins.forEach((w) => {
    const now = snap.boxes.find((b) => b.key === w.key);
    // A ticket that left the centre keeps its window, as it was last seen.
    w.el.classList.toggle('gone', !now);
    if (now) w.box = now;
    draw(w, snap, backend);
  });
}

export function closeTickets(hooks?: TicketHooks) {
  const keys = [...wins.keys()];
  wins.forEach((w) => w.el.remove());
  wins.clear();
  if (hooks) keys.forEach((k) => hooks.onClose(k));
}

/** How many ticket windows are open (minimised ones included). */
export const openTickets = () => wins.size;
