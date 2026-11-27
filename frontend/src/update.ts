// Self-update: checks GitHub Releases, downloads and installs the new version
// (Go side, internal/update), restarts, and shows the release notes once
// after an update. The flow follows ArgusCode.

import type { Backend } from './backend';
import type { Release } from './types';
import { dateTime, errText, h, toast } from './ui';
import { renderNotes } from './notes';
import { sanitize } from './sanitize';

// GitHub is asked at most once an hour. The clock is looked at every ten
// minutes and whenever the window comes back, so a computer that slept still
// checks soon after it wakes.
const CHECK_INTERVAL = 60 * 60 * 1000;
const TICK = 10 * 60 * 1000;
let busy = false;
let found: { release: Release; supported: boolean } | null = null; // a newer version, told once
const changed = () => window.dispatchEvent(new Event('argusdesk:update'));

/** The newer version found, for the top bar ("" = none). */
export function pendingUpdate() {
  return installed ? { version: installed.version, ready: true } : found ? { version: found.release.version, ready: false } : null;
}

/** What the top bar's update mark does: offer the update again. */
export function offerUpdate() {
  if (installed) return ready(installed);
  if (found) announce(found.release, found.supported);
}

function announce(r: Release, supported: boolean) {
  toast(`새 버전 v${r.version}이 있습니다 (현재 v${current}).`, 'info', [
    { label: '릴리스 노트', run: () => showNotes(r) },
    supported ? { label: '지금 업데이트', run: () => void install(r) } : { label: '내려받기 페이지', run: () => backend.openUrl(r.url) },
  ]);
}
let current = '';
let installed: Release | null = null;
let progress: HTMLElement | null = null;
let backend: Backend;

export function initUpdates(b: Backend) {
  backend = b;
  backend.onUpdateProgress((done, total) => showProgress(done, total));
  void checkForUpdates(false);
  setInterval(() => void checkForUpdates(false), TICK);
  const back = () => document.visibilityState === 'visible' && void checkForUpdates(false);
  document.addEventListener('visibilitychange', back);
  window.addEventListener('focus', back);
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
    current = info.current;
    if (!info.available) {
      if (manual) toast(`최신 버전입니다 (v${info.current}).`);
      return;
    }
    // Said once per version: after that the mark in the top bar keeps it in view.
    const fresh = found?.release.version !== r.version;
    found = { release: r, supported: info.supported };
    if (fresh || manual) announce(r, info.supported);
    if (fresh) changed();
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
    changed();
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
  // Release notes come from this project's own repository. The Markdown is
  // drawn as headings and lists; the HTML of the release feed (used when the
  // API is not available) only through the same sanitiser as ticket text.
  const body = r.notes ? renderNotes(r.notes) : h('div', { class: 'release-notes rich' }, sanitize(r.notesHtml || ''));
  const dialog = h(
    'dialog',
    { class: 'notes' },
    h('p', { class: 'quiet' }, `ArgusDesk v${r.version}${r.published ? ` · ${dateTime(r.published)}` : ''}`),
    h('h2', {}, r.name && r.name !== r.tag ? r.name : `v${r.version}에서 바뀐 것`),
    body,
    h('div', { class: 'act-row' }, h('button', { class: 'primary', onclick: () => dialog.close() }, '닫기')),
  );
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelector<HTMLButtonElement>('.act-row button')?.focus();
}
