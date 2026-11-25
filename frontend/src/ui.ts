// Small DOM helpers shared by the HTML parts of the screen.

type Child = Node | string | null | undefined | false;

/** Creates an element: h('button', { class: 'primary', onclick }, 'Save'). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface ToastAction {
  label: string;
  run(): void;
}

/** Shows a message at the bottom of the window. Messages with actions stay until dismissed. */
export function toast(message: string, kind: 'info' | 'error' = 'info', actions: ToastAction[] = []): HTMLElement {
  const host = document.getElementById('toasts')!;
  const el = h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, h('span', {}, message));
  const close = () => el.remove();
  for (const a of actions) {
    el.append(
      h('button', { class: 'link', onclick: () => (close(), a.run()) }, a.label),
    );
  }
  el.append(h('button', { class: 'close', 'aria-label': '닫기', onclick: close }, '×'));
  host.append(el);
  if (actions.length === 0) setTimeout(close, kind === 'error' ? 8000 : 4000);
  return el;
}

const two = (n: number) => String(n).padStart(2, '0');

/** "11월 25일 14:03" */
export function dateTime(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** "14:03" */
export function clock(iso: string) {
  const d = new Date(iso);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** "3시간 20분", "2일 4시간" */
export function span(ms: number) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}분`;
  const hours = Math.floor(m / 60);
  if (hours < 24) return m % 60 ? `${hours}시간 ${m % 60}분` : `${hours}시간`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days}일 ${hours % 24}시간` : `${days}일`;
}

/** "3h" -> "3시간", "5d" -> "5일" */
export function limitText(after?: string) {
  const m = /^(\d+)([mhd])$/.exec(after ?? '');
  return m ? `${m[1]}${{ m: '분', h: '시간', d: '일' }[m[2] as 'm' | 'h' | 'd']}` : '';
}

/** Replaces an element's children, skipping empty ones. */
export function fill(el: Element, ...children: Child[]) {
  el.replaceChildren(...(children.filter(Boolean) as (Node | string)[]));
}

/** Puts text on the clipboard; falls back to a hidden text area where the clipboard API is refused. */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = h('textarea', { 'aria-hidden': 'true', style: 'position:fixed;opacity:0;pointer-events:none' });
    area.value = text;
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

/** A small "복사" button; the text is read when it is pressed. */
export function copyButton(text: () => string, name = '복사') {
  const b = h('button', { class: 'copy', type: 'button' }, name);
  b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const ok = await copyText(text());
    b.textContent = ok ? '복사됨' : '복사 실패';
    b.classList.toggle('done', ok);
    setTimeout(() => {
      b.textContent = name;
      b.classList.remove('done');
    }, 1500);
  });
  return b;
}

/** A block of code with a copy button in its corner. */
export function codeBlock(pre: HTMLElement) {
  return h('div', { class: 'code' }, copyButton(() => pre.textContent ?? ''), pre);
}

/** Asks before something is changed in Jira. Resolves true when confirmed. */
export function confirmAction(title: string, detail: string, okLabel: string, danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'confirm' });
    const done = (v: boolean) => {
      dlg.close();
      dlg.remove();
      resolve(v);
    };
    const ok = h('button', { class: danger ? 'primary danger' : 'primary', onclick: () => done(true) }, okLabel);
    dlg.append(
      h('h3', {}, title),
      h('p', {}, detail),
      h('div', { class: 'buttons' }, h('button', { onclick: () => done(false) }, '취소'), ok),
    );
    dlg.addEventListener('cancel', (e) => (e.preventDefault(), done(false)));
    document.body.append(dlg);
    dlg.showModal();
    ok.focus();
  });
}
