// Writing a ticket of our own. Some floors only receive boxes; on the others
// the team makes its own, and the form for it is laid out like a waybill:
// who sends, who receives, what is inside.

import { filesOf, sendFiles, sizeText } from './attach';
import type { Backend } from './backend';
import { TAGS } from './scene';
import type { CreateField, CreateForm, SpaceView } from './types';
import { errText, h, toast } from './ui';

const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const plain = (type: string) => type.replace(/^\[[^\]]+\]\s*/, '');

interface Who {
  id: string;
  name: string;
}

interface Ctx {
  me: string;
  people: Who[];
  find(query: string): Promise<Who[]>;
  tickets: { key: string; summary: string }[];
}

type Value = string | string[];

/**
 * A person field: type a part of a name and Jira is searched, as in Jira's
 * own form. Before anything is typed it offers whoever Jira starts the field
 * with, me and the team.
 */
function personPicker(f: CreateField, ctx: Ctx, id: string): { el: HTMLElement; value: () => Value } {
  const first = (f.people ?? []).map((p) => ({ ...p, note: '기본' }));
  const near: (Who & { note?: string })[] = [...first, { id: 'me', name: ctx.me, note: '나' }, ...ctx.people.filter((p) => !first.some((d) => d.id === p.id))];
  let chosen: Who | null = first[0] ?? null;
  let shown: (Who & { note?: string })[] = [];
  let at = 0;
  let asked = 0; // the newest search: an older answer arriving late is dropped
  let timer = 0;
  const listId = `${id}-list`;
  const input = h('input', { id, type: 'text', role: 'combobox', autocomplete: 'off', spellcheck: 'false', 'aria-autocomplete': 'list', 'aria-controls': listId, 'aria-expanded': 'false', placeholder: '이름으로 찾기' });
  const list = h('ul', { id: listId, class: 'wb-people', role: 'listbox', hidden: true });
  const el = h('div', { class: 'wb-person' }, input, list);
  input.value = chosen?.name ?? '';
  const shut = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
  };
  const pick = (p: Who) => {
    chosen = p;
    input.value = p.name;
    shut();
  };
  const draw = (note = '') => {
    at = Math.max(0, Math.min(at, shown.length - 1));
    list.replaceChildren(
      ...shown.map((p, i) => {
        const li = h('li', { role: 'option', id: `${listId}-${i}`, 'aria-selected': String(i === at), class: i === at ? 'on' : '' }, h('span', {}, p.name), p.note ? h('span', { class: 'quiet' }, p.note) : null);
        // mousedown, not click: the text box must not lose the cursor first
        li.addEventListener('mousedown', (e) => (e.preventDefault(), pick(p)));
        return li;
      }),
      note ? h('li', { class: 'none quiet' }, note) : '',
    );
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-activedescendant', shown.length ? `${listId}-${at}` : '');
  };
  const search = () => {
    const q = input.value.trim();
    window.clearTimeout(timer);
    if (!q || q === chosen?.name) {
      shown = near;
      return draw();
    }
    const local = near.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
    shown = local;
    draw('Jira에서 찾는 중…');
    const mine = ++asked;
    timer = window.setTimeout(() => {
      ctx.find(q).then(
        (found) => {
          if (mine !== asked) return;
          shown = [...local, ...found.filter((p) => !local.some((l) => l.id === p.id))];
          draw(shown.length ? '' : '찾는 사람이 없습니다.');
        },
        () => mine === asked && draw('Jira에서 찾지 못했습니다. 다시 입력해 보세요.'),
      );
    }, 250);
  };
  input.addEventListener('focus', () => (input.select(), search()));
  input.addEventListener('input', () => ((at = 0), search()));
  input.addEventListener('blur', () => {
    // What was typed without picking anyone is not a person: the box goes back to who is chosen.
    if (!input.value.trim() && !f.required) chosen = null;
    input.value = chosen?.name ?? '';
    asked++;
    shut();
  });
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return; // Korean input in progress: the keys belong to it
    if (list.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (shown.length) at = (at + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length;
      draw();
    } else if (e.key === 'Enter') {
      e.preventDefault(); // not the form's send
      if (shown[at]) pick(shown[at]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      input.value = chosen?.name ?? '';
      shut();
    }
  });
  return { el, value: () => chosen?.id ?? '' };
}

/** The control for one field, and how to read its value back. `extra` holds what travels beside it. */
function control(f: CreateField, ctx: Ctx): { el: HTMLElement; value: () => Value; extra?: () => Record<string, Value> } {
  const id = `wb-${f.id}`;
  const preset = (f.default ?? '').split(',');
  switch (f.kind) {
    case 'long': {
      const el = h('textarea', { id, rows: String(Math.min(12, Math.max(f.id === 'description' ? 5 : 3, (f.default ?? '').split('\n').length + 1))) });
      el.value = f.default ?? '';
      if (f.hasDefault && !f.default) el.placeholder = '비워 두면 Jira에 정해 둔 기본 양식이 들어갑니다.';
      return { el, value: () => el.value };
    }
    case 'option': {
      const el = h('select', { id }, h('option', { value: '' }, f.required ? '선택하세요' : '없음'), ...(f.options ?? []).map((o) => h('option', { value: o.id }, o.name)));
      el.value = f.default ?? '';
      return { el, value: () => el.value };
    }
    case 'options': {
      // A drop-down that takes several: closed, it names what is picked.
      const boxes = (f.options ?? []).map((o) => {
        const box = h('input', { type: 'checkbox', value: o.id });
        box.checked = preset.includes(o.id);
        return { box, name: o.name, label: h('label', { class: 'check' }, box, o.name) };
      });
      const face = h('summary', { id });
      const el = h('details', { class: 'wb-multi' }, face, h('div', { class: 'checks', role: 'group', tabindex: '-1', 'aria-label': f.name }, ...boxes.map((b) => b.label)));
      const show = () => {
        const picked = boxes.filter((b) => b.box.checked).map((b) => b.name);
        face.textContent = picked.length ? picked.join(', ') : f.required ? '선택하세요' : '없음';
        face.classList.toggle('empty', !picked.length);
      };
      el.addEventListener('change', show);
      // near the bottom of the waybill the list opens upwards, so the paper does not have to scroll
      el.addEventListener('toggle', () => {
        const r = el.getBoundingClientRect();
        const d = (el.closest('dialog') ?? document.body).getBoundingClientRect();
        el.classList.toggle('up', d.bottom - r.bottom < 250 && r.top - d.top > d.bottom - r.bottom);
      });
      // like a drop-down, it shuts when something else is clicked or Esc is pressed
      el.addEventListener('focusout', (e) => !el.contains(e.relatedTarget as Node | null) && (el.open = false));
      el.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !el.open) return;
        e.stopPropagation();
        e.preventDefault();
        el.open = false;
        face.focus();
      });
      show();
      return { el, value: () => boxes.filter((b) => b.box.checked).map((b) => b.box.value) };
    }
    case 'user':
      return personPicker(f, ctx, id);
    case 'users': {
      // Several people cannot be picked here: they go as Jira set them up.
      const who = f.people ?? [];
      return { el: h('p', { id, class: 'wb-fixed' }, ...who.map((p) => h('span', { class: 'chip' }, p.name)), h('span', { class: 'quiet' }, 'Jira에 정해 둔 대로 들어갑니다')), value: () => who.map((p) => p.id) };
    }
    case 'links': {
      const kind = h('select', { 'aria-label': '연결 종류' }, ...(f.options ?? []).map((o) => h('option', { value: o.id }, o.name)));
      kind.value = f.default ?? '';
      const listId = `${id}-list`;
      const keys = h('input', { id, type: 'text', autocomplete: 'off', list: listId, placeholder: '티켓 번호 (예: ABC-123). 여러 개는 쉼표로' });
      const list = h('datalist', { id: listId }, ...ctx.tickets.map((t) => h('option', { value: t.key }, t.summary)));
      return { el: h('div', { class: 'wb-links' }, kind, keys, list), value: () => keys.value, extra: () => ({ 'issuelinks.type': kind.value }) };
    }
    default: {
      const type = f.kind === 'date' ? 'date' : f.kind === 'datetime' ? 'datetime-local' : f.kind === 'number' ? 'number' : 'text';
      const el = h('input', { id, type, autocomplete: 'off', step: f.kind === 'number' ? 'any' : undefined });
      el.value = f.default ?? '';
      return { el, value: () => el.value };
    }
  }
}

/**
 * Opens the waybill for a floor. `me` is my name; `people` are the teammates a
 * box can be addressed to; `tickets` are the ones on the floor, offered where
 * another ticket is linked. `made` is told the key of the new ticket.
 */
export function openWaybill(backend: Backend, space: SpaceView, me: string, people: Who[], tickets: Ctx['tickets'], spent: boolean, made: (key: string, tag: number) => void) {
  const ctx: Ctx = { me, people, tickets, find: (q) => backend.findPeople(q) };
  const types = space.types ?? [];
  if (!types.length) return void toast('이 층의 설정에 만들 수 있는 유형이 없습니다.', 'error');
  const dlg = h('dialog', { class: 'waybill' });
  const close = () => {
    dlg.close();
    dlg.remove();
  };
  const type = h('select', { id: 'wb-type' }, ...types.map((t) => h('option', { value: t.name }, plain(t.name))));
  // With the week's strength used up I cannot take a box, so it is not addressed to me by default.
  const to = h('select', { id: 'wb-to' }, h('option', { value: 'me', disabled: spent }, `${me} (나)${spent ? ' · 피로도 0' : ''}`), ...people.map((p) => h('option', { value: p.id }, p.name)), h('option', { value: '' }, '미배정'));
  to.value = spent ? '' : 'me';
  const stripe = h('i', { class: 'wb-stripe' });
  const body = h('div', { class: 'wb-body' });
  const error = h('p', { class: 'error', role: 'alert' });
  const send = h('button', { class: 'primary', type: 'submit' }, '송장 붙여 보내기');
  // Files to go with the ticket: Jira takes them once the ticket exists, so they are sent right after it is made.
  let picked: File[] = [];
  const pick = h('input', { type: 'file', multiple: true, hidden: true });
  const chosen = h('ul', { class: 'files' });
  const showPicked = () =>
    chosen.replaceChildren(
      ...picked.map((f, i) =>
        h(
          'li',
          {},
          h('span', { class: 'name' }, f.name),
          h('span', { class: 'quiet' }, sizeText(f.size)),
          h('button', { type: 'button', class: 'close', 'aria-label': `${f.name} 빼기`, onclick: () => (picked.splice(i, 1), showPicked()) }, '×'),
        ),
      ),
    );
  const add = (list: File[]) => {
    picked.push(...list);
    showPicked();
  };
  pick.addEventListener('change', () => (add([...(pick.files ?? [])]), (pick.value = '')));
  const attachRow = space.attach
    ? h('div', { class: 'wb-attach' }, h('span', { class: 'wb-cap' }, '첨부'), chosen, h('p', { class: 'attach-bar' }, pick, h('button', { type: 'button', onclick: () => pick.click() }, '파일 추가'), h('span', { class: 'quiet' }, '끌어다 놓거나 붙여넣어도 됩니다.')))
    : null;
  let form: CreateForm | null = null;
  let read: { field: CreateField; value: () => Value; extra?: () => Record<string, Value> }[] = [];

  const load = async () => {
    const t = types.find((x) => x.name === type.value)!;
    stripe.style.background = css(TAGS[t.tag] ?? TAGS.gray);
    error.textContent = '';
    send.disabled = true;
    body.replaceChildren(h('p', { class: 'quiet' }, '이 유형의 입력 항목을 Jira에서 읽는 중입니다.'));
    try {
      const got = await backend.createForm(space.id, t.name);
      if (type.value !== t.name) return; // another kind was picked meanwhile
      form = got;
    } catch (e) {
      form = null;
      body.replaceChildren();
      error.textContent = errText(e);
      return;
    }
    if (form.blocked.length) {
      // Fields the app cannot fill in: this kind is written in Jira.
      read = [];
      body.replaceChildren(
        h('p', {}, `이 유형은 앱에서 입력할 수 없는 필수 항목이 있어 Jira에서 만들어야 합니다: ${form.blocked.join(', ')}`),
        form.jiraUrl ? h('button', { type: 'button', onclick: () => (backend.openUrl(form!.jiraUrl), close()) }, 'Jira에서 만들기') : '',
      );
      return;
    }
    const made = form.fields.map((f) => ({ field: f, ...control(f, ctx) }));
    read = made;
    body.replaceChildren(
      ...made.flatMap(({ field, el }) => [
        h('label', { for: `wb-${field.id}` }, field.id === 'summary' ? '품목 (제목)' : field.id === 'description' ? '내용' : field.kind === 'links' ? '연결할 티켓' : field.name, field.required ? h('em', { title: '필수' }, ' *') : null),
        el,
      ]),
      form.auto.length ? h('p', { class: 'quiet wb-auto' }, `Jira가 알아서 채우는 항목: ${form.auto.join(', ')}`) : '',
    );
    send.disabled = false;
    (body.querySelector('input, textarea, select') as HTMLElement | null)?.focus();
  };
  type.addEventListener('change', () => void load());

  const paper = h(
    'form',
    {
      class: 'wb-paper',
      onsubmit: async (e: Event) => {
        e.preventDefault();
        if (!form || form.blocked.length) return;
        const values: Record<string, Value> = {};
        for (const r of read) {
          const v = r.value();
          if (r.field.required && !r.field.hasDefault && (Array.isArray(v) ? v.length === 0 : !v.trim())) {
            error.textContent = `${r.field.id === 'summary' ? '품목(제목)' : r.field.kind === 'links' ? '연결할 티켓' : r.field.name} 항목을 입력해 주세요.`;
            return;
          }
          values[r.field.id] = v;
          Object.assign(values, r.extra?.());
        }
        error.textContent = '';
        send.disabled = true;
        try {
          const key = await backend.createTicket(space.id, type.value, values, to.value);
          close();
          toast(`${key} 송장을 붙였습니다. 곧 ${space.name}에 상자가 나타납니다.`);
          if (picked.length) {
            const sent = await sendFiles(backend, key, picked);
            if (sent) toast(`${key}에 파일 ${sent}개를 붙였습니다.`);
          }
          made(key, TAGS[types.find((x) => x.name === type.value)?.tag ?? ''] ?? TAGS.gray);
        } catch (err) {
          error.textContent = errText(err);
          send.disabled = false;
        }
      },
    },
    h(
      'header',
      {},
      stripe,
      h('strong', {}, '송장'),
      h('span', { class: 'wb-route' }, `${space.project} · ${space.name}`),
      h('span', { class: 'wb-code', 'aria-hidden': 'true' }),
      h('button', { class: 'close', type: 'button', 'aria-label': '닫기', onclick: close }, '×'),
    ),
    h(
      'div',
      { class: 'wb-parties' },
      h('div', {}, h('span', { class: 'wb-cap' }, '보내는 사람'), h('b', {}, me || '나')),
      h('div', {}, h('label', { class: 'wb-cap', for: 'wb-to' }, '받는 사람 (담당자)'), to),
      h('div', {}, h('label', { class: 'wb-cap', for: 'wb-type' }, '유형'), type),
    ),
    body,
    attachRow,
    error,
    h('footer', {}, h('span', { class: 'quiet' }, '보내면 Jira에 바로 티켓이 만들어집니다.'), h('button', { type: 'button', onclick: close }, '닫기'), send),
  );
  if (space.attach) {
    dlg.addEventListener('dragover', (e) => e.dataTransfer?.types.includes('Files') && e.preventDefault());
    dlg.addEventListener('drop', (e) => {
      const list = filesOf(e.dataTransfer);
      if (!list.length) return;
      e.preventDefault();
      add(list);
    });
    dlg.addEventListener('paste', (e) => {
      const list = filesOf(e.clipboardData);
      if (!list.length) return; // text goes where it was going
      e.preventDefault();
      add(list);
    });
  }
  dlg.append(paper);
  dlg.addEventListener('cancel', (e) => (e.preventDefault(), close()));
  document.body.append(dlg);
  dlg.showModal();
  void load();
}
