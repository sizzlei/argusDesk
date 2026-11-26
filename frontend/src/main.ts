import { lookOf } from './avatars';
import { connect } from './backend';
import { news } from './game';
import { filtersOpen, renderFilters, toggleFilters } from './filters';
import { initFinder, openFinder } from './finder';
import { renderHud } from './hud';
import { addNotes, noticeCount, noticesOpen, renderNotices, setServerFeed, toggleNotices } from './notices';
import { closeTickets, openTicket, openTickets, setStrength, syncTickets } from './panel';
import { AGE, Scene, TAGS } from './scene';
import { type ProfileAction, profileOpen, renderProfile, toggleProfile } from './profile';
import { renderSetup } from './setup';
import type { AppState, Box, Change, GameStats, Snapshot } from './types';
import { checkForUpdates, initUpdates } from './update';
import { openAvatarPicker, openVacation } from './vacation';
import { errText, toast } from './ui';
import { openWaybill } from './waybill';
import { type Filter, applyFilter, loadFilter, saveFilter, unassigned } from './view';

async function boot() {
  const backend = await connect();
  let state: AppState = await backend.state();
  let snap: Snapshot | null = null;
  let space = 0;
  let lastError = '';
  let selected: Box | null = null;
  let game: GameStats | null = null;
  let gameOpen = false;
  let spot = ''; // the teammate whose boxes are lit
  let awaited = ''; // a ticket I just made: its window opens when the box arrives
  // The filter narrows what the room and the counters show.
  let filter = loadFilter();
  let hidden = new Set<string>();
  /** The snapshot as the room and the counters show it. */
  const view = (): Snapshot | null => {
    if (!snap) return null;
    const v = applyFilter(snap, filter);
    hidden = v.hidden;
    return v.snap;
  };
  const setFilter = (next: Filter) => {
    filter = next;
    saveFilter(next);
    draw([]);
    hud();
    legend();
  };
  /** Draws the room from the current snapshot and filter. */
  const draw = (changes: Change[]) => {
    const v = view();
    if (v) scene.update(v, changes.filter((c) => !hidden.has(c.key)), hidden);
  };

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
      tooltip.textContent = `${box.key} · ${box.summary} · ${box.assignee || '미배정'}`;
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
    scene.focus(box.key);
    hud();
  };
  // The panels on the right (notifications, filters, my state) take the same place: one at a time.
  const only = (which: 'notices' | 'filters' | 'profile' | '') => {
    if (which !== 'notices') toggleNotices(false);
    if (which !== 'filters') toggleFilters(false);
    if (which !== 'profile') toggleProfile(false);
  };
  /** The settings that sit under my state. */
  const actions = (): ProfileAction[] => {
    const setNotify = (on: boolean) =>
      void backend.setNotify(on).then((next) => {
        apply(next);
        toast(on ? (next.notifyProblem ? `알림을 켰지만 보낼 수 없습니다: ${next.notifyProblem}` : '알림을 켰습니다.') : '알림을 껐습니다.');
      }, fail);
    const list: (ProfileAction | false)[] = [
      {
        label: '아바타 선택',
        run: () => {
          const me = snap?.members.find((m) => m.me);
          openAvatarPicker(backend, me ? game?.avatars[me.id] : undefined);
        },
      },
      {
        label: '휴가 등록',
        run: () => {
          const seen = new Set<string>();
          const people = (snap?.members ?? []).filter((m) => !m.me && !seen.has(m.id) && seen.add(m.id)).map((m) => ({ id: m.id, name: m.name.trim().split(/\s+/)[0] }));
          void openVacation(backend, state.me.trim().split(/\s+/)[0] ?? '', people).catch(fail);
        },
      },
      { label: state.notify ? '알림 끄기' : '알림 켜기', run: () => setNotify(!state.notify), note: state.notify && state.notifyProblem ? `알림을 보낼 수 없습니다: ${state.notifyProblem}` : undefined },
      openTickets() > 1 && { label: `티켓 창 모두 닫기 (${openTickets()})`, run: () => closeTickets(tickets) },
      { label: state.server ? '서버에서 설정 다시 받기' : '설정 다시 읽기', run: () => void backend.reloadConfig().then(apply, fail) },
      !state.server && { label: '설정 파일 바꾸기', run: () => void backend.chooseConfig().then(apply, fail) },
      !!state.server &&
        state.serverNeeds === 'login' && {
          label: '팀 서버에 다시 로그인',
          run: () => {
            toast('브라우저에서 팀 서버에 로그인해 주세요.');
            void backend.connectServer(state.server).then(apply, fail);
          },
        },
      !!state.server && { label: '팀 서버 연결 끊기', run: () => void backend.forgetServer().then(apply, fail) },
      { label: '업데이트 확인', run: () => void checkForUpdates(true) },
      { label: '로그아웃', run: () => void backend.logout().then(apply, fail), danger: true },
    ];
    return list.filter((a): a is ProfileAction => !!a);
  };
  const hud = () => {
    renderNotices(snap, visit, () => hud(), (url) => backend.openUrl(url));
    const shown = view();
    renderFilters(snap, space, filter, shown?.boxes.length ?? 0, snap?.boxes.length ?? 0, setFilter, () => hud());
    renderProfile(
      state,
      snap,
      game,
      actions(),
      visit,
      () => {
        only('');
        gameOpen = true;
        hud();
      },
      () => hud(),
    );
    renderHud(state, shown, space, lastError, backend, {
      refresh: () => void backend.refresh(),
      write: () => {
        const sp = snap?.spaces[space];
        if (!sp) return;
        const seen = new Set<string>();
        const people = (snap?.members ?? []).filter((m) => !m.me && !seen.has(m.id) && seen.add(m.id)).map((m) => ({ id: m.id, name: m.name.trim().split(/\s+/)[0] }));
        openWaybill(backend, sp, state.me.trim().split(/\s+/)[0] ?? '', people, game?.myFatigue === 0, (key) => (awaited = key));
      },
      profileOpen: profileOpen(),
      toggleProfile: () => {
        const next = !profileOpen();
        only(next ? 'profile' : '');
        toggleProfile(next);
        hud();
      },
      spot,
      setSpot: (id) => {
        spot = id;
        scene.setSpot(id);
        hud();
      },
      filter,
      setFilter,
      filtersOpen: filtersOpen(),
      toggleFilters: () => {
        const next = !filtersOpen();
        only(next ? 'filters' : '');
        toggleFilters(next);
        hud();
      },
      search: openFinder,
      unassigned: unassigned(snap),
      notices: {
        ...noticeCount(snap),
        open: noticesOpen(),
        toggle: () => {
          const next = !noticesOpen();
          only(next ? 'notices' : '');
          toggleNotices(next);
          hud();
        },
      },
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
    view()?.boxes.filter((b) => b.space === id).forEach((b) => types.set(b.type, b.tag));
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
    const people = () => {
      const seen = new Set<string>();
      return (snap?.members ?? []).filter((m) => !seen.has(m.id) && seen.add(m.id));
    };
    const ages = ['여유', '기준 절반', '기준 초과', '3배 초과', '10배 초과'];
    el.replaceChildren(
      row('유형', [...types].sort().map(([name, tag]) => item('tag', TAGS[tag] ?? TAGS.gray, name.replace(/^\[[^\]]+\]\s*/, '')))),
      row('묵음', ages.map((t, i) => item('', AGE[i], t))),
      // the tape across a box has the colour of its holder's clothes
      row('담당', [
        ...people().map((m) => item('tape', lookOf(m.id, game?.avatars ?? {}).body, m.me ? `${m.name} (나)` : m.name)),
        item('tape none', 0xb9c0cc, '미배정'),
      ]),
    );
  };
  /** Takes new game statistics and celebrates what was just earned. */
  const score = (next: GameStats | null) => {
    if (!next) return;
    const fresh = news(game, next);
    game = next;
    setStrength(next.myFatigue);
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
    draw(ev.changes);
    syncTickets(ev.snapshot, backend);
    addNotes(ev.notes, ev.snapshot.fetchedAt);
    const arrived = awaited && ev.snapshot.boxes.find((b) => b.key === awaited);
    if (arrived) {
      awaited = '';
      visit(arrived);
    }
    hud();
    legend();
  });
  backend.onGame(score);
  backend.onServer(apply);
  const fed = (f: Parameters<typeof setServerFeed>[0]) => {
    setServerFeed(f);
    hud();
  };
  backend.onFeed(fed);
  void backend.serverFeed().then(fed, () => {});
  backend.onError((err) => {
    lastError = err.message;
    if (err.auth) void backend.state().then(apply);
    else hud();
  });

  initFinder(() => snap, visit);
  apply(state);
  const first = await backend.snapshot();
  if (first) {
    snap = first;
    draw([]);
    hud();
    legend();
  }
  score(await backend.gameStats().catch(() => null));
  initUpdates(backend);
}

boot().catch((e) => {
  document.body.textContent = `시작하지 못했습니다: ${errText(e)}`;
});
