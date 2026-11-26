// First-run pages. There are two ways in:
// - a team server: type its address, sign in there in the browser, and the
//   settings and the Jira key come from it;
// - no server: pick the settings file, then sign in to Jira here.

import type { Backend } from './backend';
import { SERVER_NEEDS } from './hud';
import type { AppState } from './types';
import { errText, h } from './ui';

let draft = ''; // a server address typed but not yet confirmed
let waiting = false; // the browser sign-in is under way

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

  if (!state.configLoaded) {
    const address = h('input', { id: 'server', placeholder: 'argus.example.com', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off' });
    host.replaceChildren(
      h(
        'section',
        { class: 'card' },
        h('h1', {}, 'Argus Desk'),
        h('h2', {}, '팀 서버로 시작'),
        h('p', { class: 'quiet' }, '팀이 서버를 쓰고 있다면 주소만 입력하면 됩니다. 설정과 Jira 연결은 서버에서 받아 옵니다.'),
        h(
          'form',
          {
            class: 'inline',
            onsubmit: (e: Event) => {
              e.preventDefault();
              if (!address.value.trim()) return fail('서버 주소를 입력하세요');
              draft = address.value.trim();
              again();
            },
          },
          h('label', { for: 'server', class: 'sr' }, '팀 서버 주소'),
          address,
          h('button', { class: 'primary', type: 'submit' }, '다음'),
        ),
        h('h2', {}, '서버 없이 시작'),
        h('p', { class: 'quiet' }, '설정 파일(YAML)을 고르고 Jira 토큰으로 로그인합니다. 앱은 파일의 위치를 기억하고 실행할 때마다 다시 읽습니다.'),
        state.configError ? h('pre', { class: 'error' }, state.configError) : null,
        h('button', { onclick: () => backend.chooseConfig().then(done, fail) }, state.configPath ? '다른 설정 파일 선택' : '설정 파일 선택'),
        state.configPath ? h('button', { onclick: () => backend.reloadConfig().then(done, fail) }, '같은 파일 다시 읽기') : null,
        error,
      ),
    );
    return true;
  }

  const site = h('input', { id: 'site', value: state.site, autocomplete: 'off', spellcheck: 'false' });
  const email = h('input', { id: 'email', type: 'email', value: state.email, autocomplete: 'username' });
  const token = h('input', { id: 'token', type: 'password', autocomplete: 'off' });
  const submit = h('button', { class: 'primary', type: 'submit' }, '로그인');
  const form = h(
    'form',
    {
      class: 'card',
      onsubmit: (e: Event) => {
        e.preventDefault();
        submit.disabled = true;
        error.textContent = '';
        backend
          .login(site.value, email.value, token.value)
          .then(done, fail)
          .finally(() => (submit.disabled = false));
      },
    },
    h('h1', {}, 'Jira 로그인'),
    state.authError ? h('p', { class: 'error' }, state.authError) : null,
    h('label', { for: 'site' }, 'Jira 사이트 주소'),
    site,
    h('label', { for: 'email' }, '이메일'),
    email,
    h('label', { for: 'token' }, 'API 토큰'),
    token,
    h('p', { class: 'quiet' }, '토큰은 이 컴퓨터의 자격 증명 저장소에만 보관합니다. Atlassian 계정 설정의 보안 메뉴에서 발급할 수 있습니다.'),
    submit,
    error,
  );
  host.replaceChildren(form);
  (state.email ? token : email).focus();
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
        if (state.server) void backend.cancelServerLogin().then(() => backend.forgetServer()).then(done, fail);
        else again();
      },
    },
    '다른 주소를 쓰거나 서버 없이 시작',
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

  if (waiting || state.serverBusy) {
    page(
      '브라우저에서 로그인하는 중',
      h('p', {}, '브라우저에 열린 팀 서버의 로그인 화면에서 로그인을 마치면 자동으로 넘어갑니다.'),
      h('p', { class: 'quiet' }, '브라우저 주소 창의 주소가 위 주소와 같은지 확인하세요. 3분 안에 끝내지 않으면 취소됩니다.'),
      h('button', { onclick: () => void backend.cancelServerLogin() }, '취소'),
    );
    return true;
  }
  const needs = state.server ? state.serverNeeds : 'login';
  if (needs === 'login' || !state.server) {
    page(
      '팀 서버에 로그인',
      h('p', {}, '이 주소의 서버에 로그인합니다. 주소가 맞는지 확인하세요.'),
      state.server && state.serverProblem ? h('p', { class: 'error' }, state.serverProblem) : null,
      h('button', { class: 'primary', onclick: signIn }, '브라우저에서 로그인'),
    );
    return true;
  }
  if (needs === 'jira') {
    page(
      'Jira 토큰 등록이 필요합니다',
      h('p', {}, state.authError || SERVER_NEEDS.jira),
      h('p', { class: 'quiet' }, '토큰은 서버에 암호화되어 보관되고, 이 앱은 로그인한 본인의 것만 받아 옵니다.'),
      h('button', { onclick: () => backend.openUrl(address) }, '서버 열기'),
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
    state.serverProblem ? '팀 서버에 연결하지 못했습니다' : '팀 서버에서 받아 오는 중',
    state.serverProblem ? h('p', { class: 'error' }, state.serverProblem) : h('p', { class: 'quiet' }, '설정과 Jira 연결을 받아 오고 있습니다.'),
    state.configError ? h('pre', { class: 'error' }, state.configError) : null,
    retry('다시 확인'),
  );
  return true;
}
