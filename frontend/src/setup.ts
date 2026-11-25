// First-run pages: pick the settings file, then sign in to Jira.

import type { Backend } from './backend';
import type { AppState } from './types';
import { errText, h } from './ui';

/** Shows the page the state calls for; resolves to false when nothing is missing. */
export function renderSetup(state: AppState, backend: Backend, done: (next: AppState) => void): boolean {
  const host = document.getElementById('setup')!;
  if (state.configLoaded && state.signedIn) {
    host.hidden = true;
    host.replaceChildren();
    return false;
  }
  host.hidden = false;
  const error = h('p', { class: 'error', role: 'alert' });
  const fail = (e: unknown) => (error.textContent = errText(e));

  if (!state.configLoaded) {
    host.replaceChildren(
      h(
        'section',
        { class: 'card' },
        h('h1', {}, 'ArgusDesk'),
        h('p', {}, '설정 파일을 선택해 주세요. 사용 가이드에서 내려받은 YAML 파일입니다.'),
        h('p', { class: 'quiet' }, '앱은 파일의 위치를 기억하고 실행할 때마다 다시 읽습니다. 파일을 옮기지 않을 곳에 저장해 두세요.'),
        state.configError ? h('pre', { class: 'error' }, state.configError) : null,
        h(
          'button',
          { class: 'primary', onclick: () => backend.chooseConfig().then(done, fail) },
          state.configPath ? '다른 설정 파일 선택' : '설정 파일 선택',
        ),
        state.configPath
          ? h('button', { onclick: () => backend.reloadConfig().then(done, fail) }, '같은 파일 다시 읽기')
          : null,
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
