// Registering a holiday. While it lasts, the avatar rests in the lodge in the
// basement instead of standing in the centre.

import type { Backend } from './backend';
import { errText, h, toast } from './ui';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export async function openVacation(backend: Backend) {
  const mine = await backend.myVacation();
  const dlg = h('dialog', { class: 'confirm vacation' });
  const from = h('input', { type: 'date', id: 'vac-from', value: mine.from || today() });
  const to = h('input', { type: 'date', id: 'vac-to', value: mine.to || mine.from || today() });
  const error = h('p', { class: 'error' });
  const close = () => {
    dlg.close();
    dlg.remove();
  };
  const save = async (a: string, b: string, done: string) => {
    error.textContent = '';
    try {
      await backend.setVacation(a, b);
      close();
      toast(done);
    } catch (e) {
      error.textContent = errText(e);
    }
  };
  from.addEventListener('change', () => {
    if (to.value < from.value) to.value = from.value;
  });
  dlg.append(
    h('h3', {}, '휴가 등록'),
    h('p', {}, mine.from ? `등록된 휴가: ${mine.from} ~ ${mine.to}` : '휴가 기간 동안 내 아바타는 지하 숙소에서 쉽니다.'),
    h(
      'div',
      { class: 'dates' },
      h('label', { for: 'vac-from' }, '시작일'),
      from,
      h('label', { for: 'vac-to' }, '종료일'),
      to,
    ),
    h('p', { class: 'quiet' }, mine.shared ? '팀 공유 티켓에 기록되어 팀원에게도 보입니다.' : '설정에 팀 공유 티켓이 없어 이 컴퓨터에서만 보입니다.'),
    error,
    h(
      'div',
      { class: 'buttons' },
      mine.from ? h('button', { class: 'danger', onclick: () => void save('', '', '휴가를 취소했습니다.') }, '휴가 취소') : null,
      h('button', { onclick: close }, '닫기'),
      h('button', { class: 'primary', onclick: () => void save(from.value, to.value, `휴가를 등록했습니다: ${from.value} ~ ${to.value}`) }, '등록'),
    ),
  );
  dlg.addEventListener('cancel', (e) => (e.preventDefault(), close()));
  document.body.append(dlg);
  dlg.showModal();
}
