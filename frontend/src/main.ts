import { connect } from './backend';
import { renderHud } from './hud';
import { showPanel } from './panel';
import { Scene } from './scene';
import { renderSetup } from './setup';
import type { AppState, Box, Snapshot } from './types';
import { checkForUpdates, initUpdates } from './update';
import { errText, toast } from './ui';

async function boot() {
  const backend = await connect();
  let state: AppState = await backend.state();
  let snap: Snapshot | null = null;
  let space = 0;
  let lastError = '';
  let selected: Box | null = null;

  const tooltip = document.getElementById('tooltip')!;
  const scene = new Scene(document.getElementById('scene')!, {
    onSelect: (box) => {
      selected = box;
      showPanel(box, snap, backend, () => scene.select(''));
    },
    onHover: (box, x, y) => {
      tooltip.hidden = !box;
      if (!box) return;
      tooltip.textContent = `${box.key} · ${box.summary}`;
      tooltip.style.left = `${x + 14}px`;
      tooltip.style.top = `${y + 14}px`;
    },
  });
  await scene.init();

  const hud = () =>
    renderHud(state, snap, space, lastError, backend, {
      refresh: () => void backend.refresh(),
      reloadConfig: () => void backend.reloadConfig().then(apply, fail),
      chooseConfig: () => void backend.chooseConfig().then(apply, fail),
      checkUpdate: () => void checkForUpdates(true),
      logout: () => void backend.logout().then(apply, fail),
      setSpace: (i) => {
        space = i;
        scene.setSpace(i);
        hud();
      },
    });
  const fail = (e: unknown) => void toast(errText(e), 'error');

  /** Takes a new app state: shows a setup page if something is missing. */
  function apply(next: AppState) {
    const reloaded = next.configVersion !== state.configVersion && state.configLoaded;
    state = next;
    if (state.configLoaded && state.configError) toast(state.configError, 'error');
    else if (reloaded) toast(`설정 ${state.configVersion}을 읽었습니다.`);
    const blocked = renderSetup(state, backend, apply);
    if (blocked) {
      snap = null;
      showPanel(null, null, backend, () => {});
    }
    hud();
  }

  backend.onBoard((ev) => {
    snap = ev.snapshot;
    lastError = '';
    scene.update(ev.snapshot, ev.changes);
    if (selected) showPanel(ev.snapshot.boxes.find((b) => b.key === selected!.key) ?? null, snap, backend, () => scene.select(''));
    hud();
  });
  backend.onError((err) => {
    lastError = err.message;
    if (err.auth) void backend.state().then(apply);
    else hud();
  });

  apply(state);
  const first = await backend.snapshot();
  if (first) {
    snap = first;
    scene.update(first, []);
    hud();
  }
  initUpdates(backend);
}

boot().catch((e) => {
  document.body.textContent = `시작하지 못했습니다: ${errText(e)}`;
});
