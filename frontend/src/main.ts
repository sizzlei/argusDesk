import { connect } from './backend';
import { news } from './game';
import { renderHud } from './hud';
import { addNotes, noticeCount, noticesOpen, renderNotices, toggleNotices } from './notices';
import { closeTickets, openTicket, openTickets, syncTickets } from './panel';
import { AGE, Scene, TAGS } from './scene';
import { renderSetup } from './setup';
import type { AppState, Box, GameStats, Snapshot } from './types';
import { checkForUpdates, initUpdates } from './update';
import { openAvatarPicker, openVacation } from './vacation';
import { errText, toast } from './ui';

async function boot() {
  const backend = await connect();
  let state: AppState = await backend.state();
  let snap: Snapshot | null = null;
  let space = 0;
  let lastError = '';
  let selected: Box | null = null;
  let game: GameStats | null = null;
  let gameOpen = false;

  const tooltip = document.getElementById('tooltip')!;
  // Ticket windows float over the room. The window in front marks its box.
  const tickets = {
    onFocus: (key: string) => scene.mark(key),
    onClose: (key: string) => {
      if (selected?.key === key) scene.mark('');
    },
  };
  const scene = new Scene(document.getElementById('scene')!, {
    onSelect: (box) => {
      selected = box;
      if (box && snap) openTicket(box, snap, backend, tickets);
    },
    onZoom: (scale) => {
      document.getElementById('zoom-pct')!.textContent = `${Math.round(scale * 100)}%`;
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
  document.getElementById('zoom-in')!.addEventListener('click', () => scene.zoom(1.25));
  document.getElementById('zoom-out')!.addEventListener('click', () => scene.zoom(0.8));
  document.getElementById('zoom-fit')!.addEventListener('click', () => scene.resetView());
  /** Opens a ticket from a notification: its floor comes into view and its window opens. */
  const visit = (box: Box) => {
    if (!snap) return;
    const floor = snap.spaces.findIndex((sp) => sp.id === box.space);
    if (floor >= 0 && floor !== space) {
      space = floor;
      scene.setSpace(floor);
      legend();
    }
    selected = box;
    openTicket(box, snap, backend, tickets);
    hud();
  };
  const hud = () => {
    renderNotices(snap, visit, () => hud());
    renderHud(state, snap, space, lastError, backend, {
      refresh: () => void backend.refresh(),
      reloadConfig: () => void backend.reloadConfig().then(apply, fail),
      chooseConfig: () => void backend.chooseConfig().then(apply, fail),
      checkUpdate: () => void checkForUpdates(true),
      logout: () => void backend.logout().then(apply, fail),
      windows: openTickets(),
      notices: {
        ...noticeCount(snap),
        open: noticesOpen(),
        toggle: () => {
          toggleNotices();
          hud();
        },
      },
      closeWindows: () => closeTickets(tickets),
      vacation: () => void openVacation(backend).catch(fail),
      avatar: () => {
        const me = snap?.members.find((m) => m.me);
        openAvatarPicker(backend, me ? game?.avatars[me.id] : undefined);
      },
      setNotify: (on) =>
        void backend.setNotify(on).then((next) => {
          apply(next);
          toast(on ? (next.notifyProblem ? `알림을 켰지만 보낼 수 없습니다: ${next.notifyProblem}` : '알림을 켰습니다.') : '알림을 껐습니다.');
        }, fail),
      game,
      gameOpen,
      toggleGame: () => {
        gameOpen = !gameOpen;
        hud();
      },
      setSpace: (i) => {
        space = i;
        scene.setSpace(i);
        hud();
        legend();
      },
    });
  };
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
  /** Takes new game statistics and celebrates what was just earned. */
  const score = (next: GameStats | null) => {
    if (!next) return;
    const fresh = news(game, next);
    game = next;
    scene.setTeam(next.fatigue ?? {}, next.away ?? [], next.avatars ?? {});
    hud();
    if (fresh.myLevel) {
      toast(`레벨 업! 나 Lv.${fresh.myLevel}`);
      scene.celebrate();
    }
    if (fresh.teamLevel) {
      toast(`센터 레벨 업! Lv.${fresh.teamLevel}`);
      scene.celebrate();
    }
    fresh.badges.forEach((b) => {
      toast(`배지 획득: ${b.name} · ${b.desc}`);
      scene.celebrate();
    });
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
      closeTickets();
      legend();
    }
    hud();
  }

  backend.onBoard((ev) => {
    snap = ev.snapshot;
    lastError = '';
    scene.update(ev.snapshot, ev.changes);
    syncTickets(ev.snapshot, backend);
    addNotes(ev.notes, ev.snapshot.fetchedAt);
    hud();
    legend();
  });
  backend.onGame(score);
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
  score(await backend.gameStats().catch(() => null));
  initUpdates(backend);
}

boot().catch((e) => {
  document.body.textContent = `시작하지 못했습니다: ${errText(e)}`;
});
