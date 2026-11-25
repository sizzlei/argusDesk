import { connect } from './backend';
import { renderHud } from './hud';
import { showPanel } from './panel';
import { AGE, Scene, TAGS } from './scene';
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
      inset();
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
  /** Keeps the building clear of the open panel. */
  const inset = () => {
    const p = document.getElementById('panel')!;
    scene.setInset(p.hidden ? 0 : p.offsetWidth + 24);
  };
  window.addEventListener('resize', inset);

  const hud = () =>
    renderHud(state, snap, space, lastError, backend, {
      refresh: () => void backend.refresh(),
      reloadConfig: () => void backend.reloadConfig().then(apply, fail),
      chooseConfig: () => void backend.chooseConfig().then(apply, fail),
      checkUpdate: () => void checkForUpdates(true),
      logout: () => void backend.logout().then(apply, fail),
      setNotify: (on) =>
        void backend.setNotify(on).then((next) => {
          apply(next);
          toast(on ? (next.notifyProblem ? `알림을 켰지만 보낼 수 없습니다: ${next.notifyProblem}` : '알림을 켰습니다.') : '알림을 껐습니다.');
        }, fail),
      setSpace: (i) => {
        space = i;
        scene.setSpace(i);
        hud();
        legend();
      },
    });
  let legendOpen = false;
  document.getElementById('legend-toggle')!.addEventListener('click', () => {
    legendOpen = !legendOpen;
    legend();
  });
  /** The legend lists the request types on the floor and the age colours. */
  const legend = () => {
    const el = document.getElementById('legend')!;
    const id = snap?.spaces[space]?.id;
    const types = new Map<string, string>();
    snap?.boxes.filter((b) => b.space === id).forEach((b) => types.set(b.type, b.tag));
    const toggle = document.getElementById('legend-toggle')!;
    toggle.hidden = !snap || types.size === 0;
    toggle.setAttribute('aria-expanded', String(legendOpen));
    el.hidden = toggle.hidden || !legendOpen; // shown only while asked for
    if (el.hidden) return;
    const css = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
    const item = (cls: string, colour: number, text: string) => {
      const span = document.createElement('span');
      span.className = 'item';
      const dot = document.createElement('i');
      dot.className = cls;
      dot.style.background = css(colour);
      span.append(dot, text);
      return span;
    };
    const row = (title: string, items: HTMLElement[]) => {
      const div = document.createElement('div');
      div.className = 'row';
      const b = document.createElement('b');
      b.textContent = title;
      div.append(b, ...items);
      return div;
    };
    const ages = ['여유', '기준 절반', '기준 초과', '3배 초과', '10배 초과'];
    el.replaceChildren(
      row('유형', [...types].sort().map(([name, tag]) => item('tag', TAGS[tag] ?? TAGS.gray, name.replace(/^\[[^\]]+\]\s*/, '')))),
      row('묵음', ages.map((t, i) => item('', AGE[i], t))),
    );
  };
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
      legend();
    }
    hud();
  }

  backend.onBoard((ev) => {
    snap = ev.snapshot;
    lastError = '';
    scene.update(ev.snapshot, ev.changes);
    if (selected) showPanel(ev.snapshot.boxes.find((b) => b.key === selected!.key) ?? null, snap, backend, () => scene.select(''));
    hud();
    legend();
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
    legend();
  }
  initUpdates(backend);
}

boot().catch((e) => {
  document.body.textContent = `시작하지 못했습니다: ${errText(e)}`;
});
