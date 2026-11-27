import { lookOf } from './avatars';
import { connect } from './backend';
import { news } from './game';
import { filtersOpen, renderFilters, toggleFilters } from './filters';
import { finderOpen, initFinder, openFinder, toggleFinder } from './finder';
import { initKeys, keyLabel, openKeySettings } from './keys';
import { renderHud } from './hud';
import { addNotes, noticeCount, noticesOpen, renderNotices, setServerFeed, toggleNotices } from './notices';
import { closeFront, closeTickets, onAnswered, openTicket, openTickets, setStrength, syncTickets } from './panel';
import { AGE, Scene, TAGS } from './scene';
import { type ProfileAction, profileOpen, renderProfile, toggleProfile } from './profile';
import { renderSetup } from './setup';
import type { AppState, Box, Change, GameStats, Snapshot } from './types';
import { checkForUpdates, initUpdates } from './update';
import { showBriefing, watchPresence } from './briefing';
import { renderQuests, updateQuests } from './quests';
import { readDust } from './dust';
import { loading } from './loading';
import { type SettingsGroup, renderSettings, settingsOpen, toggleSettings } from './settings';
import { deployPopupDue, deploysToday } from './deploy';
import { WEATHER_NAME, setWeatherOn, weatherAt, weatherOn } from './weather';
import { openAvatarPicker, openVacation, cancelVacation } from './vacation';
import { startTour, tourRunning, tourSeen } from './tour';
import { chooseAction, confirmAction, errText, openDiagnostics, toast } from './ui';
import { openWaybill } from './waybill';
import { type Filter, applyFilter, loadFilter, saveFilter, unassigned } from './view';

// Something broke that nothing caught: say so once, instead of a screen that
// silently stops answering. The same message is not repeated.
const told = new Set<string>();
function tell(what: unknown) {
  const text = what instanceof Error ? what.message : String(what ?? '');
  if (!text || told.has(text) || /ResizeObserver loop/.test(text)) return;
  told.add(text);
  console.error(what);
  toast(`화면에서 오류가 났습니다: ${text.slice(0, 200)}`, 'error');
}
window.addEventListener('error', (e) => tell(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => tell(e.reason));

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
  /**
   * Opens the waybill: for the floor shown when tickets are written there,
   * otherwise for the first floor where they are.
   */
  const write = () => {
    if (!snap || !state || document.querySelector('dialog[open]')) return;
    const sp = snap.spaces[space]?.create ? snap.spaces[space] : snap.spaces.find((x) => x.create);
    if (!sp) return;
    const seen = new Set<string>();
    const people = snap.members.filter((m) => !m.me && !seen.has(m.id) && seen.add(m.id)).map((m) => ({ id: m.id, name: m.name.trim().split(/\s+/)[0] }));
    const tickets = snap.boxes.filter((b) => b.space === sp.id).map((b) => ({ key: b.key, summary: b.summary }));
    openWaybill(backend, sp, state.me.trim().split(/\s+/)[0] ?? '', people, tickets, game?.myFatigue === 0, (key, tag) => {
      awaited = key;
      scene.pack(tag);
    });
  };
  const scene = new Scene(document.getElementById('scene')!, {
    onWrite: () => write(),
    onDrop: (box, zone, to) => void dropBox(box, zone, to),
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
  scene.setMe(state.meId, state.me);
  await scene.init();
  // The weather outside, by the season; it turns every three hours.
  const sky = () => scene.setWeather(weatherOn() ? weatherAt() : 'clear');
  sky();
  window.setInterval(sky, 10 * 60_000);
  onAnswered((key, approve) => scene.stamp(key, approve));
  // The room dims in the evening; whoever would rather not has it switched off, on this computer.
  const HOURS = 'argusdesk.hours';
  try {
    scene.hours = localStorage.getItem(HOURS) !== 'off';
  } catch {
    // not readable: the room follows the hour
  }
  const setHours = (on: boolean) => {
    scene.hours = on;
    try {
      localStorage.setItem(HOURS, on ? 'on' : 'off');
    } catch {
      // it stays for this run only
    }
    draw([]);
    hud();
  };
  document.getElementById('zoom-in')!.addEventListener('click', () => scene.zoom(1.25));
  document.getElementById('zoom-out')!.addEventListener('click', () => scene.zoom(0.8));
  document.getElementById('zoom-fit')!.addEventListener('click', () => scene.resetView());
  /**
   * A box dragged onto a desk lane is given to that person; dragged into
   * another room, it is moved by the Jira transition that leads there (and
   * given to the lane's person too, when dropped on one). Each is confirmed.
   */
  async function dropBox(box: Box, zone: string, to: string | undefined) {
    if (!snap) return;
    const sp = snap.spaces.find((s) => s.id === box.space);
    const zoneName = sp?.zones.find((z) => z.id === zone)?.name ?? zone;
    const who = (id: string) => (id === '' ? '미배정' : `${snap?.members.find((m) => m.id === id)?.name ?? '그 사람'} 님`);
    const assignTo = to !== undefined && to !== box.assigneeId ? to : undefined;
    const meId = snap.members.find((m) => m.me)?.id ?? state.meId;
    const assign = async () => {
      if (assignTo === undefined) return;
      await backend.assignTicket(box.key, assignTo === meId ? 'me' : assignTo);
    };
    try {
      if (zone === box.zone) {
        if (assignTo === undefined) return;
        const off = game?.away.find((a) => a.active && a.id === assignTo);
        const text = assignTo === '' ? `${box.key}의 담당자를 비웁니다.` : `${box.key}을(를) ${who(assignTo)}에게 배정합니다.${off ? ` ${who(assignTo)}은(는) 지금 ${off.kind || '휴가'} 중입니다.` : ''}`;
        if (!(await confirmAction('담당자 변경', text, assignTo === '' ? '비우기' : '배정'))) return;
        await assign();
        toast(assignTo === '' ? `${box.key}의 담당자를 비웠습니다.` : `${box.key}을(를) ${who(assignTo)}에게 배정했습니다.`);
        return;
      }
      const acts = await backend.ticketActions(box.key);
      const ways = acts.transitions.filter((t) => t.toZone === zone);
      if (!ways.length) return void toast(`${box.key}은(는) 지금 ${zoneName}(으)로 바로 옮길 수 없습니다. 티켓 창에서 가능한 처리를 확인해 주세요.`, 'error');
      const free = ways.filter((t) => !t.needs.length);
      if (!free.length) {
        return void toast(`${zoneName}(으)로 옮기려면 Jira에서 ${ways[0].needs.join(', ')}을(를) 입력해야 합니다.`, 'error', [{ label: 'Jira에서 열기', run: () => backend.openUrl(box.url) }]);
      }
      const also = assignTo !== undefined ? ` 담당자는 ${who(assignTo)}(으)로 바꿉니다.` : '';
      let pick = free[0].id;
      if (free.length > 1) {
        const chosen = await chooseAction('상자 옮기기', `${box.key}을(를) ${zoneName}(으)로 옮깁니다.${also} 어떤 처리로 옮길까요?`, free.map((t) => ({ label: t.name, value: t.id })));
        if (!chosen) return;
        pick = chosen;
      } else if (!(await confirmAction('상자 옮기기', `${box.key}을(를) ${zoneName}(으)로 옮깁니다 (${free[0].name}).${also}`, '옮기기'))) return;
      await backend.moveTicket(box.key, pick);
      await assign();
      toast(`${box.key}을(를) ${zoneName}(으)로 옮겼습니다.`);
    } catch (e) {
      toast(errText(e), 'error');
    } finally {
      void backend.refresh();
    }
  }

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
    scene.walkTo(box.key);
    hud();
  };
  // The panels on the right (notifications, filters, my state) take the same place: one at a time.
  const only = (which: 'notices' | 'filters' | 'profile' | 'settings' | '') => {
    if (which !== 'settings') toggleSettings(false);
    if (which !== 'notices') toggleNotices(false);
    if (which !== 'filters') toggleFilters(false);
    if (which !== 'profile') toggleProfile(false);
  };
  /** What I do often, at the top of my state: holidays, my avatar, the briefing. */
  const quick = (): ProfileAction[] => {
    const myAway = game?.away.find((a) => a.me);
    const when = myAway ? (myAway.from === myAway.to ? myAway.from : `${myAway.from} ~ ${myAway.to}`) : '';
    const list: (ProfileAction | false)[] = [
      {
        label: myAway ? '휴가 변경' : '휴가 등록',
        note: myAway ? `${myAway.kind || '휴가'} ${when}${myAway.cover ? ` · 대무자 ${myAway.cover}` : ''}` : undefined,
        run: () => {
          const seen = new Set<string>();
          const people = (snap?.members ?? []).filter((m) => !m.me && !seen.has(m.id) && seen.add(m.id)).map((m) => ({ id: m.id, name: m.name.trim().split(/\s+/)[0] }));
          void openVacation(backend, state.me.trim().split(/\s+/)[0] ?? '', people).catch(fail);
        },
      },
      !!myAway && { label: '휴가 취소', run: () => void cancelVacation(backend, when), danger: true },
      { label: '출근 브리핑', run: () => showBriefing(snap, game?.away ?? [], visit, true), note: '내 승인 대기, 요청자 답변, 오늘 배포, 새로 들어온 상자' },
      {
        label: '아바타',
        run: () => {
          const me = snap?.members.find((m) => m.me);
          openAvatarPicker(backend, me ? game?.avatars[me.id] : undefined);
        },
      },
    ];
    return list.filter((a): a is ProfileAction => !!a);
  };
  /** Everything else, behind the gear beside the app's name. */
  const settingsGroups = (): SettingsGroup[] => {
    const setNotify = (on: boolean) =>
      void backend.setNotify(on).then((next) => {
        apply(next);
        toast(on ? (next.notifyProblem ? `알림을 켰지만 보낼 수 없습니다: ${next.notifyProblem}` : '알림을 켰습니다.') : '알림을 껐습니다.');
      }, fail);
    return [
      {
        title: '화면',
        items: [
          {
            label: weatherOn() ? '날씨 끄기' : '날씨 켜기',
            run: () => {
              setWeatherOn(!weatherOn());
              sky();
            },
            note: `지금 창밖: ${WEATHER_NAME[weatherAt()]} · 계절에 따라 눈, 비, 바람, 낙엽이 지나갑니다`,
          },
          { label: scene.hours ? '시간대 조명 끄기' : '시간대 조명 켜기', run: () => setHours(!scene.hours), note: '저녁과 밤에 센터 조명이 어두워집니다' },
          { label: '단축키 설정', run: () => openKeySettings(), note: `송장 쓰기 ${keyLabel('write') || '없음'} · 상자 찾기 ${keyLabel('search') || '없음'} · Esc 창 닫기` },
          openTickets() > 1 && { label: `티켓 창 모두 닫기 (${openTickets()})`, run: () => closeTickets(tickets) },
        ],
      },
      {
        title: '알림',
        items: [{ label: state.notify ? 'OS 알림 끄기' : 'OS 알림 켜기', run: () => setNotify(!state.notify), note: state.notify && state.notifyProblem ? `알림을 보낼 수 없습니다: ${state.notifyProblem}` : '새 상자, 내 상자의 이동, 승인 요청, 요청자 답변' }],
      },
      {
        title: 'Argus',
        items: [
          { label: 'Argus에서 설정 다시 받기', run: () => void backend.reloadConfig().then(apply, fail), note: state.configVersion ? `지금 설정 ${state.configVersion}` : undefined },
          !!state.server && state.serverNeeds === 'login' && { label: 'Argus에 다시 로그인', run: () => argusLogin() },
          !!state.server && { label: 'Argus 연결 끊기', run: () => void backend.forgetServer().then(apply, fail) },
        ],
      },
      {
        title: '도움말',
        items: [
          { label: '둘러보기 다시 보기', run: () => tour(true) },
          { label: '진단 정보', run: () => void openDiagnostics(() => backend.diagnostics()) },
          { label: '업데이트 확인', run: () => void checkForUpdates(true) },
          { label: '로그아웃', run: () => void backend.logout().then(apply, fail), danger: true },
        ],
      },
    ];
  };
  /** Opens a window for every ticket that goes to production today. */
  const openDeploys = () => {
    if (!snap) return;
    const list = deploysToday(snap);
    list.slice(0, 6).forEach((d) => openTicket(d.box, snap!, backend, tickets));
    toast(list.length > 6 ? `오늘 배포 ${list.length}건 중 6건을 열었습니다. 창은 6개까지 열립니다.` : `오늘 배포 ${list.length}건을 열었습니다.`);
  };

  /** Moves the day's quests along; a quest done, or the whole day, is celebrated. */
  const quests = () => {
    const meId = snap?.members.find((m) => m.me)?.id || state.meId;
    const won = updateQuests(snap, game, meId);
    if (won.day) {
      toast(`오늘의 퀘스트를 모두 끝냈습니다! 연속 ${won.day}일`);
      scene.celebrate();
    } else if (won.quest) toast(`퀘스트 완료: ${won.quest}`);
    renderQuests(document.getElementById('quests')!, document.getElementById('floors'));
  };

  const hud = () => {
    // after this draw, when the floor list has its height
    requestAnimationFrame(() => renderQuests(document.getElementById('quests')!, document.getElementById('floors')));
    renderNotices(snap, visit, () => hud(), (url) => backend.openUrl(url));
    const shown = view();
    renderFilters(snap, space, filter, shown?.boxes.length ?? 0, snap?.boxes.length ?? 0, setFilter, () => hud());
    renderProfile(
      state,
      snap,
      game,
      quick(),
      visit,
      () => {
        only('');
        gameOpen = true;
        hud();
      },
      () => hud(),
    );
    renderSettings(settingsGroups(), `ArgusDesk v${state.version}${state.server ? ` · Argus ${state.server.replace(/^https?:\/\//, '')}` : ''}`, () => hud());
    renderHud(state, shown, space, lastError, backend, {
      settingsOpen: settingsOpen(),
      toggleSettings: () => {
        const next = !settingsOpen();
        only(next ? 'settings' : '');
        toggleSettings(next);
        hud();
      },
      refresh: () => void backend.refresh(),
      argusLogin: () => argusLogin(),
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
      deploys: { count: deploysToday(snap).length, open: () => openDeploys() },
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
  /** Plays the tour of the centre. */
  const tour = (full = false) => {
    if (!snap || tourRunning()) return;
    only('');
    gameOpen = false;
    closeTickets(tickets);
    hud();
    const home = Math.max(0, space);
    const to = (i: number) => {
      if (i === space) return;
      space = i;
      scene.setSpace(i);
      hud();
      legend();
    };
    to(home);
    startTour({
      rect: (what) => scene.rectOf(what),
      toWritingFloor: () => {
        const i = snap?.spaces.findIndex((sp) => sp.create) ?? -1;
        if (i >= 0) to(i);
        return i >= 0;
      },
      toFirstFloor: () => to(home),
      closeWindows: () => closeTickets(tickets),
      celebrate: () => scene.celebrate(),
    }, () => {}, full);
  };
  const floor = (step: number) => {
    if (!snap) return;
    const next = Math.max(0, Math.min(snap.spaces.length - 1, (space < 0 ? -1 : space) + step));
    if (next === space) return;
    space = next;
    scene.setSpace(next);
    hud();
    legend();
  };
  const panel = (which: 'notices' | 'profile', isOpen: boolean, toggle: (on: boolean) => void) => {
    only(isOpen ? '' : which);
    toggle(!isOpen);
    hud();
  };
  initKeys(
    {
      search: toggleFinder,
      write,
      refresh: () => void backend.refresh(),
      // 전체 → 내 작업 → 미배정 → 전체: one key goes round every view.
      mine: () => {
        const order = ['all', 'mine', 'unassigned'] as const;
        const scope = order[(order.indexOf(filter.scope as (typeof order)[number]) + 1) % order.length];
        setFilter({ ...filter, scope });
        toast({ all: '전체 보기', mine: '내 작업만 보기', unassigned: '미배정만 보기' }[scope]);
      },
      notices: () => panel('notices', noticesOpen(), toggleNotices),
      profile: () => panel('profile', profileOpen(), toggleProfile),
      floorUp: () => floor(1),
      floorDown: () => floor(-1),
      fit: () => scene.resetView(),
    },
    () => hud(),
  );
  // Esc shuts what is open, one thing at a time: a panel, the record, then the ticket window in front.
  // Dialogs and the search shut themselves; in a text box, the first Esc only leaves the box.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.isComposing || e.defaultPrevented) return;
    if (document.querySelector('dialog[open]') || finderOpen()) return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return void t.blur();
    if (noticesOpen() || filtersOpen() || profileOpen() || settingsOpen()) {
      only('');
      hud();
    } else if (gameOpen) {
      gameOpen = false;
      hud();
    } else if (legendOpen) {
      legendOpen = false;
      legend();
    } else closeFront(tickets);
  });
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
    loading(state, !!snap, true, false);
    quests();
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
  function argusLogin() {
    toast('브라우저에서 Argus에 로그인해 주세요.');
    void backend.connectServer(state.server).then(apply, fail);
  }

  function apply(next: AppState) {
    // A sign-in that ran out while the centre is open: offered at once, once.
    const lapsed = next.server && next.serverNeeds === 'login' && state.serverNeeds !== 'login' && state.signedIn && next.signedIn;
    const reloaded = next.configVersion !== state.configVersion && state.configLoaded;
    // A problem with the settings is told when it appears, not again with every later state.
    const problem = next.configLoaded && next.configError && next.configError !== state.configError;
    state = next;
    scene.setMe(state.meId, state.me);
    if (lapsed) toast('Argus 로그인이 끝났습니다. 다시 로그인하면 Argus 알림과 설정을 계속 받습니다.', 'error', [{ label: '로그인', run: argusLogin }]);
    if (problem) toast(state.configError, 'error');
    else if (reloaded) toast(`설정 ${state.configVersion}을 읽었습니다.`);
    const blocked = renderSetup(state, backend, apply);
    loading(state, !!snap, !!game, blocked);
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
    // dust monsters, from the whole centre; one swept away goes up in a puff
    const { dust, gone } = readDust(ev.snapshot);
    gone.forEach((d) => scene.sweep(d.key));
    if (gone.length) toast(`먼지 괴물을 물리쳤습니다! (${gone.map((d) => d.name).join(', ')})`);
    scene.setDust(dust);
    draw(ev.changes);
    syncTickets(ev.snapshot, backend);
    addNotes(ev.notes, ev.snapshot.fetchedAt);
    loading(state, true, !!game, false);
    quests();
    // the first view of a day with deployments: the morning card, which leads with them
    // (counted as shown when a briefing is already up: it has them too)
    if (tourSeen() && !tourRunning() && deployPopupDue(ev.snapshot) && !document.querySelector('dialog.brief[open]')) showBriefing(ev.snapshot, game?.away ?? [], visit, true);
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
  // What Argus answered while this screen was starting was told before anyone
  // listened: ask once more now, and once the first sync has had time to end.
  const recheck = () => void backend.state().then((next) => (next.configVersion !== state.configVersion || next.serverNeeds !== state.serverNeeds || next.signedIn !== state.signedIn) && apply(next), () => {});
  recheck();
  window.setTimeout(recheck, 5000);
  const fed = (f: Parameters<typeof setServerFeed>[0]) => {
    setServerFeed(f);
    // the server room's lamps show how Argus says it is doing
    if (scene.system !== (f?.system ?? '')) {
      scene.system = f?.system ?? '';
      draw([]);
    }
    hud();
  };
  backend.onFeed(fed);
  // From the tray menu: the notices, or the briefing.
  backend.onTray((what) => {
    if (what === 'notices') {
      only('notices');
      toggleNotices(true);
      hud();
    } else if (what === 'brief') showBriefing(snap, game?.away ?? [], visit, true);
  });
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
    loading(state, true, !!game, false);
  }
  // The first time the centre opens on this computer, a guide shows the way round.
  const greet = () => !tourSeen() && !tourRunning() && snap && !document.querySelector('#setup:not([hidden])') && window.setTimeout(tour, 900);
  if (first) greet();
  else {
    const wait = window.setInterval(() => snap && (window.clearInterval(wait), greet()), 1000);
  }
  score(await backend.gameStats().catch(() => null));
  window.addEventListener('argusdesk:update', () => hud());
  initUpdates(backend);
  // Back after a long absence: what happened meanwhile, once the centre is in view.
  watchPresence(() => {
    const ready = () => snap && tourSeen() && !tourRunning() && !document.querySelector('#setup:not([hidden])');
    const show = () => showBriefing(snap, game?.away ?? [], visit);
    if (ready()) return show();
    const wait = window.setInterval(() => ready() && (window.clearInterval(wait), show()), 1000);
  });
}

boot().catch((e) => {
  document.body.textContent = `시작하지 못했습니다: ${errText(e)}`;
});
