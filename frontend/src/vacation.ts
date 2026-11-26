// Registering a holiday. While it lasts, the avatar rests in the lodge in the
// basement instead of standing in the centre.

import type { Backend } from './backend';
import { avatarIcon, LOOKS } from './avatars';
import { confirmAction, errText, h, toast } from './ui';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Says how saving went. The holiday is saved either way; the team calendar is a second step that can fail on its own. */
function vacationToast(saved: { calendar?: string } | undefined, done: string, cancelled: boolean) {
  if (saved?.calendar && saved.calendar !== 'ok') toast(`${done} 다만 팀 캘린더에는 반영하지 못했습니다: ${saved.calendar}`, 'error');
  else toast(saved?.calendar === 'ok' ? `${done} ${cancelled ? '팀 캘린더의 일정도 지웠습니다.' : '팀 캘린더에도 반영했습니다.'}` : done);
}

/** Cancels the holiday that is registered, after asking. `when` is its days as shown. */
export async function cancelVacation(backend: Backend, when: string) {
  if (!(await confirmAction('휴가를 취소할까요?', `${when} 휴가를 취소합니다. 팀 캘린더의 일정도 지웁니다.`, '휴가 취소', true))) return;
  try {
    vacationToast(await backend.setVacation('', '', '', ''), '휴가를 취소했습니다.', true);
  } catch (e) {
    toast(errText(e), 'error');
  }
}

/** `me` is my name as the calendar will show it; `people` are the teammates who can cover. */
export async function openVacation(backend: Backend, me: string, people: { id: string; name: string }[]) {
  const mine = await backend.myVacation();
  const dlg = h('dialog', { class: 'confirm vacation' });
  const from = h('input', { type: 'date', id: 'vac-from', value: mine.from || today() });
  const to = h('input', { type: 'date', id: 'vac-to', value: mine.to || mine.from || today() });
  const kind = h('select', { id: 'vac-kind' }, ...mine.kinds.map((k) => h('option', { value: k.name }, k.name)));
  if (mine.kind) kind.value = mine.kind;
  const cover = h('select', { id: 'vac-cover' }, h('option', { value: '' }, '없음'), ...people.map((p) => h('option', { value: p.id }, p.name)));
  cover.value = people.some((p) => p.id === mine.coverId) ? mine.coverId : '';
  const error = h('p', { class: 'error' });
  const title = h('p', { class: 'quiet' });
  const close = () => {
    dlg.close();
    dlg.remove();
  };
  const half = () => mine.kinds.find((k) => k.name === kind.value)?.half ?? false;
  /** Part of a day is for one day only; and the calendar title is shown as it will read. */
  const sync = () => {
    if (half()) to.value = from.value;
    to.disabled = half();
    if (to.value < from.value) to.value = from.value;
    const who = people.find((p) => p.id === cover.value)?.name;
    title.textContent = `캘린더 제목: ${me || '이름'} / ${kind.value}${who ? ` / 대무자 : ${who}` : ''}${half() ? ' · 하루만 등록되고 아바타는 센터에 남습니다' : ''}`;
  };
  const save = async (a: string, b: string, done: string) => {
    error.textContent = '';
    try {
      const saved = await backend.setVacation(a, b, kind.value, cover.value);
      close();
      // The holiday is saved either way; the team calendar is a second step that can fail on its own.
      vacationToast(saved, done, !a);
    } catch (e) {
      error.textContent = errText(e);
    }
  };
  [from, to, kind, cover].forEach((el) => el.addEventListener('change', sync));
  sync();
  const now = mine.from ? `등록된 휴가: ${mine.from === mine.to ? mine.from : `${mine.from} ~ ${mine.to}`}${mine.kind ? ` · ${mine.kind}` : ''}${mine.cover ? ` · 대무자 ${mine.cover}` : ''}` : '';
  dlg.append(
    h('h3', {}, mine.from ? '휴가 변경 · 취소' : '휴가 등록'),
    h('p', {}, now || '휴가 기간 동안 내 아바타는 지하 숙소에서 쉽니다.'),
    h(
      'div',
      { class: 'dates' },
      h('label', { for: 'vac-kind' }, '구분'),
      kind,
      h('label', { for: 'vac-from' }, '시작일'),
      from,
      h('label', { for: 'vac-to' }, '종료일'),
      to,
      h('label', { for: 'vac-cover' }, '대무자'),
      cover,
    ),
    title,
    h('p', { class: 'quiet' }, '팀원에게도 보이고, 팀 캘린더에도 올라갑니다.'),
    error,
    h(
      'div',
      { class: 'buttons' },
      mine.from ? h('button', { class: 'danger', onclick: () => void save('', '', '휴가를 취소했습니다.') }, '휴가 취소') : null,
      h('button', { onclick: close }, '닫기'),
      h('button', { class: 'primary', onclick: () => void save(from.value, to.value, `${kind.value}를 등록했습니다: ${from.value === to.value ? from.value : `${from.value} ~ ${to.value}`}.`) }, mine.from ? '변경' : '등록'),
    ),
  );
  dlg.addEventListener('cancel', (e) => (e.preventDefault(), close()));
  document.body.append(dlg);
  dlg.showModal();
}

/** Lets the user pick the look of their own avatar. */
export function openAvatarPicker(backend: Backend, current: number | undefined) {
  const dlg = h('dialog', { class: 'confirm avatars' });
  const close = () => {
    dlg.close();
    dlg.remove();
  };
  const error = h('p', { class: 'error' });
  dlg.append(
    h('h3', {}, '아바타 선택'),
    h('p', { class: 'quiet' }, '센터와 화면 위쪽에 보이는 내 모습입니다.'),
    h(
      'div',
      { class: 'looks' },
      ...LOOKS.map((look, i) =>
        h(
          'button',
          {
            class: i === current ? 'on' : '',
            'aria-label': `아바타 ${i + 1}`,
            'aria-pressed': String(i === current),
            onclick: async () => {
              try {
                await backend.setAvatar(i);
                close();
                toast('아바타를 바꿨습니다.');
              } catch (e) {
                error.textContent = errText(e);
              }
            },
          },
          avatarIcon(look, 44),
        ),
      ),
    ),
    error,
    h('div', { class: 'buttons' }, h('button', { onclick: close }, '닫기')),
  );
  dlg.addEventListener('cancel', (e) => (e.preventDefault(), close()));
  document.body.append(dlg);
  dlg.showModal();
}
