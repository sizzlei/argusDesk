// First-run pages. The way in is Argus: type its address, sign in there in
// the browser, and the settings and the Jira key come from it. Nothing about
// Jira is asked here.

import type { Backend } from './backend';
import { SERVER_NEEDS } from './hud';
import type { AppState } from './types';
import { errText, h, openDiagnostics } from './ui';

let draft = ''; // a server address typed but not yet confirmed
let waiting = false; // the browser sign-in is under way
let start = false; // the address was just confirmed: go straight to the sign-in

/** Shows the page the state calls for; resolves to false when nothing is missing. */
export function renderSetup(state: AppState, backend: Backend, done: (next: AppState) => void): boolean {
  const host = document.getElementById('setup')!;
  if (state.configLoaded && state.signedIn) {
    host.hidden = true;
    host.replaceChildren();
    draft = '';
    return false;
  }
  host.hidden = false;
  const error = h('p', { class: 'error', role: 'alert' });
  const fail = (e: unknown) => (error.textContent = errText(e));
  const again = () => renderSetup(state, backend, done);

  if (state.server || draft) return serverPage(host, state, backend, done, error, fail, again);

  const address = h('input', { id: 'server', placeholder: 'argus.example.com', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off' });
  const where = h('p', { class: 'quiet' }, 'Argus 주소를 입력하면 브라우저에서 Argus 로그인 화면이 열립니다.');
  // The address is shown in full, as it will be opened, before the browser goes there.
  address.addEventListener('input', () => (where.textContent = address.value.trim() ? `${shown(address.value.trim())} 에 로그인합니다. 주소가 맞는지 확인하세요.` : 'Argus 주소를 입력하면 브라우저에서 Argus 로그인 화면이 열립니다.'));
  host.replaceChildren(
    h(
      'section',
      { class: 'card' },
      h('h1', {}, 'Argus Desk'),
      h('p', {}, 'Argus에 로그인하면 시작합니다. 설정과 Jira 연결은 Argus에 등록된 것을 받아 옵니다.'),
      h(
        'form',
        {
          class: 'inline',
          onsubmit: (e: Event) => {
            e.preventDefault();
            if (!address.value.trim()) return fail('Argus 주소를 입력하세요');
            draft = address.value.trim();
            start = true;
            again();
          },
        },
        h('label', { for: 'server', class: 'sr' }, 'Argus 주소'),
        address,
        h('button', { class: 'primary', type: 'submit' }, 'Argus로 로그인'),
      ),
      where,
      error,
      h('button', { class: 'link', onclick: () => void openDiagnostics(() => backend.diagnostics()) }, '진단 정보 보기'),
    ),
  );
  address.focus();
  return true;
}

/** "argus.example.com" → "https://argus.example.com", as the app will use it. */
const shown = (address: string) => (/^https?:\/\//i.test(address) ? address : `https://${address}`).replace(/\/+$/, '');

/** The pages of the team-server way in: confirm the address, sign in, then whatever the server still needs. */
function serverPage(host: HTMLElement, state: AppState, backend: Backend, done: (next: AppState) => void, error: HTMLElement, fail: (e: unknown) => void, again: () => void): boolean {
  const address = state.server || shown(draft);
  const leave = h(
    'button',
    {
      class: 'link',
      onclick: () => {
        draft = '';
        waiting = false;
        start = false;
        if (state.server) void backend.cancelServerLogin().then(() => backend.forgetServer()).then(done, fail);
        else again();
      },
    },
    '다른 주소로 로그인',
  );
  const retry = (label: string) =>
    h('button', { class: 'primary', onclick: (e: Event) => (((e.target as HTMLButtonElement).disabled = true), void backend.syncServer().then(done, fail)) }, label);
  const page = (title: string, ...body: (Node | string | null)[]) =>
    host.replaceChildren(
      h(
        'section',
        { class: 'card' },
        h('h1', {}, title),
        // The address is shown in full before anything is typed into a sign-in page: a wrong one could be an imitation.
        h('p', { class: 'server-address' }, address),
        ...body,
        error,
        leave,
        h('button', { class: 'link', onclick: () => void openDiagnostics(() => backend.diagnostics()) }, '진단 정보 보기'),
      ),
    );

  const signIn = () => {
    waiting = true;
    error.textContent = '';
    again();
    backend
      .connectServer(address)
      .then(
        (next) => {
          waiting = false;
          draft = '';
          done(next);
        },
        (e) => {
          waiting = false;
          again();
          host.querySelector('.error')!.textContent = errText(e);
        },
      );
  };

  if (start && !waiting) {
    start = false;
    signIn(); // the address was typed on the first page: no second click
    return true;
  }
  if (waiting || state.serverBusy) {
    page(
      '브라우저에서 로그인하는 중',
      h('p', {}, '브라우저에 열린 Argus 로그인 화면에서 로그인을 마치면 자동으로 넘어갑니다.'),
      h('p', { class: 'quiet' }, '브라우저 주소 창의 주소가 위 주소와 같은지 확인하세요. 3분 안에 끝내지 않으면 취소됩니다.'),
      h('button', { onclick: () => void backend.cancelServerLogin() }, '취소'),
    );
    return true;
  }
  const needs = state.server ? state.serverNeeds : 'login';
  if (needs === 'login' || !state.server) {
    page(
      'Argus에 로그인',
      h('p', {}, '이 주소의 Argus에 로그인합니다. 주소가 맞는지 확인하세요.'),
      state.server && state.serverProblem ? h('p', { class: 'error' }, state.serverProblem) : null,
      h('button', { class: 'primary', onclick: signIn }, '브라우저에서 로그인'),
    );
    return true;
  }
  if (needs === 'jira') {
    page(
      'Jira 토큰 등록이 필요합니다',
      h('p', {}, state.authError || SERVER_NEEDS.jira),
      h('p', { class: 'quiet' }, 'Argus 상단 아바타 메뉴 › 나의 ArgusDesk에서 등록합니다. 토큰은 Argus에 암호화되어 보관되고, 이 앱은 로그인한 본인의 것만 받아 옵니다.'),
      h('button', { onclick: () => backend.openUrl(`${address}/desk/my`) }, 'Argus에서 등록하기'),
      retry('등록했습니다. 다시 확인'),
    );
    return true;
  }
  if (needs) {
    page('아직 시작할 수 없습니다', h('p', {}, SERVER_NEEDS[needs] ?? state.serverProblem), retry('다시 확인'));
    return true;
  }
  // Signed in, nothing reported missing: still fetching, or the server cannot be reached.
  page(
    state.serverProblem ? '아직 시작하지 못했습니다' : 'Argus에서 받아 오는 중',
    state.serverProblem ? h('p', { class: 'error' }, state.serverProblem) : h('p', { class: 'quiet' }, '설정과 Jira 연결을 받아 오고 있습니다.'),
    state.configError ? h('pre', { class: 'error' }, state.configError) : null,
    retry('다시 확인'),
  );
  return true;
}
