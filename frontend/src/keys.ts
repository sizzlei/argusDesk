// Keyboard shortcuts, and the dialog where they are changed. A shortcut is
// kept as the physical key with its modifiers ("Mod+KeyK"), so it works the
// same under a Korean keyboard layout. They are saved on this computer.

import { h, toast } from './ui';

export type KeyAction = 'search' | 'write' | 'refresh' | 'mine' | 'notices' | 'profile' | 'floorUp' | 'floorDown' | 'fit';

const NAMES: Record<KeyAction, string> = {
  search: '상자 찾기',
  write: '송장 쓰기',
  refresh: '새로 고침',
  mine: '전체 / 내 작업 / 미배정 차례로 전환',
  notices: '알림 열기',
  profile: '내 상태 열기',
  floorUp: '위층으로',
  floorDown: '아래층으로',
  fit: '화면 맞춤',
};

export const DEFAULT_KEYS: Record<KeyAction, string> = {
  search: 'Mod+KeyK',
  write: 'KeyN',
  refresh: 'KeyR',
  mine: 'KeyM',
  notices: 'KeyB',
  profile: 'KeyP',
  floorUp: 'BracketRight',
  floorDown: 'BracketLeft',
  fit: 'Digit0',
};

const STORE = 'argusdesk.keys';
const MAC = /Mac/.test(navigator.platform);
let keys: Record<KeyAction, string> = { ...DEFAULT_KEYS };
let changed: () => void = () => {};

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? '{}') as Record<string, unknown>;
    for (const a of Object.keys(DEFAULT_KEYS) as KeyAction[]) if (typeof saved[a] === 'string') keys[a] = saved[a] as string;
  } catch {
    // nothing saved, or it cannot be read: the defaults stand
  }
}

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify(keys));
  } catch {
    // it stays for this run only
  }
  changed();
}

/** The key of an event as a shortcut; "" for a modifier on its own. */
export function combo(e: KeyboardEvent) {
  if (/^(Control|Meta|Alt|Shift)(Left|Right)$/.test(e.code) || !e.code) return '';
  return `${e.metaKey || e.ctrlKey ? 'Mod+' : ''}${e.altKey ? 'Alt+' : ''}${e.shiftKey ? 'Shift+' : ''}${e.code}`;
}

const CODES: Record<string, string> = { BracketLeft: '[', BracketRight: ']', Slash: '/', Backslash: '\\', Comma: ',', Period: '.', Semicolon: ';', Quote: "'", Minus: '-', Equal: '=', Backquote: '`', Space: 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };

/** A shortcut as it is shown: "⌘K", "Ctrl K", "N". "" when the action has none. */
export function comboLabel(c: string) {
  if (!c) return '';
  const parts = c.split('+');
  const code = parts.pop()!;
  const key = CODES[code] ?? code.replace(/^Key|^Digit|^Numpad/, '');
  const mods = parts.map((m) => (m === 'Mod' ? (MAC ? '⌘' : 'Ctrl') : m === 'Alt' ? (MAC ? '⌥' : 'Alt') : MAC ? '⇧' : 'Shift'));
  return MAC ? mods.join('') + key : [...mods, key].join(' ');
}

export const keyLabel = (a: KeyAction) => comboLabel(keys[a]);

const typingIn = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/**
 * Starts listening. A shortcut without ⌘/Ctrl is left alone while something is
 * being typed; none fires while a dialog is open. `onChange` redraws what
 * shows a shortcut.
 */
export function initKeys(run: Record<KeyAction, () => void>, onChange: () => void) {
  load();
  changed = onChange;
  window.addEventListener('keydown', (e) => {
    if (e.isComposing || e.defaultPrevented || e.repeat) return;
    const c = combo(e);
    if (!c || document.querySelector('dialog[open]')) return;
    if (typingIn(e.target) && !c.startsWith('Mod+')) return;
    const action = (Object.keys(keys) as KeyAction[]).find((a) => keys[a] === c);
    if (!action) return;
    e.preventDefault();
    run[action]();
  });
}

/** The dialog where shortcuts are changed. */
export function openKeySettings() {
  const dlg = h('dialog', { class: 'keys' });
  let waiting: KeyAction | null = null;
  const close = () => {
    dlg.close();
    dlg.remove();
  };
  const list = h('dl', {});
  const draw = () => {
    list.replaceChildren(
      ...(Object.keys(NAMES) as KeyAction[]).map((a) =>
        h(
          'div',
          { class: 'row' },
          h('dt', {}, NAMES[a]),
          h(
            'dd',
            {},
            h(
              'button',
              {
                type: 'button',
                class: waiting === a ? 'key waiting' : 'key',
                'aria-label': `${NAMES[a]} 단축키 바꾸기`,
                onclick: () => {
                  waiting = waiting === a ? null : a;
                  draw();
                },
              },
              waiting === a ? '키를 누르세요' : keys[a] ? h('kbd', {}, comboLabel(keys[a])) : '없음',
            ),
          ),
        ),
      ),
    );
    list.querySelector<HTMLElement>('.waiting')?.focus();
  };
  // While a row waits, the next key is its shortcut: Esc leaves it as it was, Backspace takes it away.
  dlg.addEventListener(
    'keydown',
    (e) => {
      if (!waiting) return;
      e.preventDefault();
      e.stopPropagation();
      const a = waiting;
      if (e.code === 'Escape') {
        waiting = null;
      } else if (e.code === 'Backspace' || e.code === 'Delete') {
        keys[a] = '';
        waiting = null;
        save();
      } else {
        const c = combo(e);
        if (!c) return; // a modifier on its way down
        if (c === 'Enter' || c === 'Tab' || c === 'Space') return void toast('그 키는 단축키로 쓸 수 없습니다.', 'error');
        const other = (Object.keys(keys) as KeyAction[]).find((o) => o !== a && keys[o] === c);
        if (other) {
          keys[other] = '';
          toast(`${comboLabel(c)}은(는) "${NAMES[other]}"에서 쓰던 키라, 그쪽은 비웠습니다.`);
        }
        keys[a] = c;
        waiting = null;
        save();
      }
      draw();
    },
    true,
  );
  dlg.addEventListener('cancel', (e) => (e.preventDefault(), close()));
  dlg.append(
    h(
      'form',
      { method: 'dialog', onsubmit: (e: Event) => (e.preventDefault(), close()) },
      h('h2', {}, '단축키'),
      h('p', { class: 'quiet' }, '바꿀 항목을 누른 다음 새 키를 누르세요. Backspace는 단축키를 없애고, Esc는 그대로 둡니다. Esc(열린 창 닫기)는 바꿀 수 없습니다.'),
      list,
      h(
        'footer',
        {},
        h(
          'button',
          {
            type: 'button',
            onclick: () => {
              keys = { ...DEFAULT_KEYS };
              waiting = null;
              save();
              draw();
            },
          },
          '기본값으로',
        ),
        h('button', { class: 'primary', type: 'submit' }, '닫기'),
      ),
    ),
  );
  document.body.append(dlg);
  draw();
  dlg.showModal();
}
