// Self-update: checks GitHub Releases, downloads and installs the new version
// (Go side, internal/update), restarts, and shows the release notes once
// after an update. The flow follows ArgusCode.

import type { Backend } from './backend';
import type { Release } from './types';
import { errText, h, toast } from './ui';

const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
let busy = false;
let installed: Release | null = null;
let progress: HTMLElement | null = null;
let backend: Backend;

export function initUpdates(b: Backend) {
  backend = b;
  backend.onUpdateProgress((done, total) => showProgress(done, total));
  void checkForUpdates(false);
  setInterval(() => void checkForUpdates(false), CHECK_INTERVAL);
  void backend.notesToShow().then((tag) => {
    if (tag) void backend.releaseNotes(tag).then(showNotes, () => {});
  });
}

/** Automatic checks are silent unless an update is found; manual ones always answer. */
export async function checkForUpdates(manual: boolean) {
  if (backend.mock) return manual ? void toast('프로토타입에서는 업데이트를 확인하지 않습니다.') : undefined;
  if (installed) return ready(installed);
  if (busy) return manual ? void toast('업데이트를 확인하는 중입니다.') : undefined;
  if (!manual && Date.now() - (await backend.lastUpdateCheck()) < CHECK_INTERVAL) return;
  busy = true;
  try {
    const info = await backend.checkUpdate();
    const r = info.release;
    if (!info.available) {
      if (manual) toast(`최신 버전입니다 (v${info.current}).`);
      return;
    }
    toast(`새 버전 v${r.version}이 있습니다 (현재 v${info.current}).`, 'info', [
      { label: '릴리스 노트', run: () => showNotes(r) },
      info.supported
        ? { label: '지금 업데이트', run: () => void install(r) }
        : { label: '내려받기 페이지', run: () => backend.openUrl(r.url) },
    ]);
  } catch (e) {
    if (manual) toast(errText(e), 'error');
  } finally {
    busy = false;
  }
}

async function install(r: Release) {
  if (busy) return;
  busy = true;
  showProgress(0, r.assetSize);
  try {
    await backend.installUpdate(r.tag);
    installed = r;
    ready(r);
  } catch (e) {
    toast(`업데이트 실패: ${errText(e)}`, 'error', [{ label: '내려받기 페이지', run: () => backend.openUrl(r.url) }]);
  } finally {
    progress?.remove();
    progress = null;
    busy = false;
  }
}

function ready(r: Release) {
  toast(`v${r.version}을 설치했습니다. 다시 시작하면 적용됩니다.`, 'info', [
    { label: '다시 시작', run: () => void backend.restartApp().catch((e) => toast(errText(e), 'error')) },
  ]);
}

function showProgress(done: number, total: number) {
  if (!progress) {
    progress = h('div', { class: 'toast info' }, h('span', {}), h('progress', { max: '100' }));
    document.getElementById('toasts')!.append(progress);
  }
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  progress.querySelector('span')!.textContent = `새 버전 내려받는 중 ${pct}%`;
  (progress.querySelector('progress') as HTMLProgressElement).value = pct;
}

function showNotes(r: Release) {
  // Release notes come from this project's own repository; they are shown as
  // plain text so nothing in them is ever run.
  const body = r.notes || new DOMParser().parseFromString(r.notesHtml, 'text/html').body.textContent || '';
  const dialog = h(
    'dialog',
    { class: 'notes' },
    h('h2', {}, r.name || `v${r.version}`),
    h('pre', {}, body.trim() || '릴리스 노트가 없습니다.'),
    h('button', { class: 'primary', onclick: () => dialog.close() }, '닫기'),
  );
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
