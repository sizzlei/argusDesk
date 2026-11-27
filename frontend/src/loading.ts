// The loading screen: it covers the window from the first paint until the
// centre has its first snapshot (and the team's figures, or a few seconds
// more), so nothing half drawn shows on the way.

import type { AppState } from './types';

let done = false;
let snapAt = 0;
let slow = 0; // a timer: when it takes long, a way past the screen is offered

/** Takes the screen away. */
function lift(el: HTMLElement) {
  done = true;
  window.clearTimeout(slow);
  el.classList.add('gone');
  window.setTimeout(() => el.remove(), 400);
}

/** Says what is being waited for, or lifts the screen when there is enough to show. */
export function loading(state: AppState, hasSnap: boolean, hasGame: boolean, setupShown: boolean) {
  const el = document.getElementById('loading');
  if (!el || done) return;
  if (!slow) {
    slow = window.setTimeout(() => {
      if (done) return;
      const card = el.querySelector('.loading-card')!;
      const go = document.createElement('button');
      go.type = 'button';
      go.textContent = '그래도 들어가기';
      go.addEventListener('click', () => lift(el));
      const p = document.createElement('p');
      p.textContent = '생각보다 오래 걸리고 있습니다. 들어가서 알림과 내 상태 › 진단 정보를 확인해 보세요.';
      card.append(p, go);
    }, 20_000);
  }
  if (hasSnap && !snapAt) {
    snapAt = Date.now();
    // the team's figures may take a while: the centre opens without them after a moment
    window.setTimeout(() => loading(state, true, true, false), 2500);
  }
  if (setupShown || (hasSnap && hasGame)) return lift(el);
  const text = document.getElementById('loading-text')!;
  text.textContent = !state.configLoaded ? 'Argus에서 설정을 받는 중' : !state.signedIn ? 'Jira에 연결하는 중' : hasSnap ? '팀 기록을 불러오는 중' : 'Jira에서 상자를 읽는 중';
}
