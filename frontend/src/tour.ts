// The first visit: a short tour of the centre, told the way a game teaches
// its first level. A guide points at one thing at a time; the room stays
// usable underneath, and one step waits for the player to open a box.
// It is shown once on a computer and can be played again from "내 상태".

import { keyLabel } from './keys';
import { h } from './ui';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TourHost {
  /** Where a thing of the room is on the screen (null = not there). */
  rect(what: 'box' | 'bench'): Rect | null;
  /** Shows the floor where tickets are written; false when there is none. */
  toWritingFloor(): boolean;
  /** Back to the floor the tour started on. */
  toFirstFloor(): void;
  /** Shuts the ticket windows the tour had opened. */
  closeWindows(): void;
  celebrate(): void;
}

interface Step {
  title: string;
  text: string;
  /** What is pointed at: a selector, a thing of the room, or nothing (the card stands in the middle). */
  at?: string | { room: 'box' | 'bench' };
  /** Run when the step is reached; false skips the step. */
  enter?(host: TourHost): boolean | void;
  /** The step is done by itself when this turns true. */
  until?(): boolean;
  next?: string;
  /** The tour version that brought this step: someone who saw an older tour is shown the newer steps. */
  since?: number;
}

const STORE = 'argusdesk.tour';
/** Raise when steps are added (and mark them with `since`), so they are shown to those who saw the tour before. */
const VERSION = 5;
const key = (a: Parameters<typeof keyLabel>[0]) => keyLabel(a) || '단축키 없음';

const steps = (): Step[] => [
  { title: '센터에 오신 걸 환영합니다', text: '여기는 팀의 Jira 티켓이 상자로 도착하는 곳입니다. 1분이면 한 바퀴 돕니다.', next: '둘러보기' },
  {
    title: '상자 하나가 티켓 하나',
    text: '송장 띠의 색은 유형, 상자의 색은 얼마나 오래 머물렀는지입니다. 붉을수록 묵은 상자예요. 아무 상자나 눌러 보세요. 누르면 내 아바타도 그 방으로 걸어갑니다.',
    at: { room: 'box' },
    until: () => !!document.querySelector('#windows .tw'),
  },
  {
    title: '티켓 창',
    text: '담당자 지정, 상태 이동, 승인, 댓글을 여기서 처리합니다. 창은 여러 개 열어 둘 수 있고, Esc를 누르면 맨 앞의 창이 닫힙니다.',
    at: '#windows .tw',
    enter: () => !!document.querySelector('#windows .tw'),
  },
  {
    title: '끌어다 놓기',
    text: '상자를 끌어 다른 방에 놓으면 그 상태로 옮기고, 작업장의 책상 줄에 놓으면 그 사람에게 배정합니다. 놓기 전에 한 번 확인하니 안심하고 끌어 보세요.',
    at: { room: 'box' },
    enter: (host) => void host.closeWindows(),
    since: 2,
  },
  {
    title: '요청자 답변',
    text: '상자 위에 "요청자 답변" 말풍선이 뜨면 요청자가 마지막으로 댓글을 단 것입니다. 공개 댓글로 답하면 말풍선이 사라집니다.',
    since: 2,
  },
  {
    title: '먼지 괴물',
    text: '묵은 상자가 두 개 넘게 쌓인 방에는 먼지 괴물이 나타납니다. 쌓일수록 커지고, 치울수록 쭈그러들다가 사라져요.',
    since: 2,
  },
  {
    title: '긴급 상자',
    text: '우선순위가 높은 상자는 뚜껑에 경광등이 돌고, 들어올 때 화면 가장자리가 붉게 깜빡입니다. 알림도 다른 것보다 먼저 갑니다.',
    since: 2,
  },
  // the window opened two steps ago would stand in front of what comes next
  { title: '층', text: '층마다 Jira 프로젝트가 하나씩 있습니다. 숫자는 열린 상자 수, 빨간 점은 묵은 상자가 있다는 뜻이에요. 지하 숙소에는 휴가 중인 사람이 쉬고 있어요.', at: '#floors', enter: (host) => void host.closeWindows() },
  {
    title: '양쪽 레일',
    text: '왼쪽 레일은 무엇을 볼지 고르는 곳(층, 찾기, 보기, 필터, 오늘 배포, 송장 쓰기), 오른쪽 레일은 나에게 오는 것(알림, 퀘스트, 기록, 새로 고침, 확대)입니다. 아이콘에 마우스를 올리면 이름과 단축키가 나옵니다.',
    at: '#rail-left',
    since: 4,
  },
  {
    title: '송장 작성대',
    text: `팀이 직접 만드는 티켓은 여기서 송장을 써서 보냅니다. 어느 층에서든 ${key('write')} 키로도 열립니다.`,
    at: { room: 'bench' },
    enter: (host) => host.toWritingFloor(),
  },
  {
    title: '골라 보기',
    text: `전체, 내 작업, 미배정으로 좁혀 봅니다. ${key('mine')}을 누를 때마다 차례로 바뀌고, 찾는 상자가 있으면 ${key('search')}로 바로 갑니다.`,
    at: '#rail-left .scope',
    enter: (host) => void host.toFirstFloor(),
    since: 2,
  },
  { title: '알림', text: '내 승인을 기다리는 상자와 Argus가 보낸 알림이 여기에 모입니다. 읽은 Argus 알림은 접혀 들어갑니다.', at: '#rail-right .bell' },
  {
    title: '오늘 배포',
    text: '운영 배포일이 오늘인 티켓이 있으면 왼쪽 레일에 트럭이 나타납니다. 트럭은 내가 맡은 것, 그 아래 "전체"는 팀 전체를 한 번에 엽니다. 내 배포가 있는 날은 처음 센터를 열 때 아침 카드로도 알려 드려요.',
    at: '#rail-left .deploy',
    since: 3,
  },
  {
    title: '주간 배포 일정판',
    text: '작업장의 화이트보드(또는 왼쪽 레일의 달력)를 누르면 이번 주 운영 배포가 요일별로 펼쳐집니다. 같은 시간대에 겹치거나 일정이 미정인 건은 따로 표시되고, 카드를 누르면 그 티켓이 열립니다.',
    at: '#rail-left .week-btn',
    since: 5,
  },
  {
    title: '출근 브리핑',
    text: '두 시간 넘게 자리를 비웠다 돌아오면, 그사이 들어온 상자와 내 승인 대기, 요청자 답변을 한 장으로 정리해 드립니다. 내 상태에서 언제든 다시 볼 수 있어요.',
    since: 2,
  },
  {
    title: '오늘의 퀘스트',
    text: '매일 아침 그날 센터에 필요한 일로 퀘스트 세 개가 나옵니다. 오른쪽 레일의 깃발을 누르면 목록이 열려요. 상자를 처리하면 저절로 체크되고, 다 끝내면 연속 달성 일수가 쌓입니다.',
    at: '#rail-right .quest-btn',
    since: 2,
  },
  { title: '내 상태', text: '내 아바타를 누르면 피로도와 가진 작업이 보입니다. 휴가 등록, 출근 브리핑, 아바타는 맨 위에 있어요. 피로도가 0이 되면 그 주에는 상자를 더 가져올 수 없습니다.', at: '#hud .team .member.me, #hud [aria-controls="profile"]' },
  {
    title: '설정',
    text: '이름 옆 톱니바퀴에는 날씨·조명, 단축키, OS 알림, Argus 연결, 진단 정보와 업데이트 확인이 있습니다.',
    at: '#hud .gear',
    since: 3,
  },
  { title: '기록', text: '끝낸 작업은 경험치와 배지로 쌓입니다. 센터 레벨은 팀이 함께 올립니다. 상단 레벨이나 오른쪽 레일의 트로피로 열어요.', at: '#hud .game-chip' },
  {
    title: '창을 닫아도',
    text: '창을 닫아도 센터는 메뉴 막대(Windows는 작업 표시줄 알림 영역)의 상자 아이콘으로 계속 돌며 알림을 보냅니다. 아이콘 옆 숫자는 내 승인 대기와 요청자 답변의 수이고, 오늘 내 운영 배포가 있으면 "배포 N"이 함께 붙습니다. 메뉴에서 오늘 배포 티켓을 바로 열 수도 있어요. 끄려면 아이콘 메뉴의 "종료"를 고릅니다.',
    since: 2,
  },
  { title: '준비 끝', text: '이제 센터를 맡깁니다. 이 안내는 내 상태에서 다시 볼 수 있습니다.', next: '시작하기' },
];

/** The version of the tour seen on this computer (0 = never; "done" was the first). */
function seenVersion(): number {
  try {
    const v = localStorage.getItem(STORE);
    return v === 'done' ? 1 : Number(v?.replace(/^v/, '')) || 0;
  } catch {
    return VERSION; // nowhere to remember it: do not show it on every start
  }
}

/** Whether the latest tour, or what is new in it, has been seen here. */
export function tourSeen() {
  return seenVersion() >= VERSION;
}

let running = false;
export const tourRunning = () => running;

/** The guide: a box with a face, drawn here so the page loads nothing. */
function guide() {
  const el = h('span', { class: 'tour-guide', 'aria-hidden': 'true' });
  el.innerHTML =
    '<svg viewBox="0 0 64 64"><path d="M32 14 54 24.5 32 35 10 24.5Z" fill="#edc68d"/><path d="M10 24.5 32 35V56L10 45.5Z" fill="#dcab69"/><path d="M54 24.5 32 35V56L54 45.5Z" fill="#bd8a49"/><path d="M28 15.9 50 26.4 44 29.3 22 18.8Z" fill="#f8e7c9"/><circle cx="17.5" cy="36" r="2.4" fill="#1f2a44"/><circle cx="25.5" cy="39.8" r="2.4" fill="#1f2a44"/><path d="M17.5 43.5q3.6 4.6 8 3.8" fill="none" stroke="#1f2a44" stroke-width="2" stroke-linecap="round"/></svg>';
  return el;
}

/**
 * Plays the tour. `done` is told when it ends, finished or skipped. Someone
 * who saw an older tour is shown only what is new, unless `full`.
 */
export function startTour(host: TourHost, done: () => void = () => {}, full = false) {
  if (running) return;
  running = true;
  const seen = seenVersion();
  const all = steps();
  const list: Step[] =
    !full && seen > 0 && seen < VERSION
      ? [
          { title: '새로 생긴 것이 있어요', text: '지난번 둘러보기 이후에 생긴 것만 짧게 보여 드릴게요.', next: '보기' },
          ...all.filter((s) => (s.since ?? 1) > seen),
          { title: '여기까지입니다', text: '처음부터 다시 보려면 내 상태의 "둘러보기 다시 보기"를 누르세요.', next: '닫기' },
        ]
      : all;
  let at = 0;
  const hole = h('div', { class: 'tour-hole' });
  const title = h('strong', {});
  const text = h('p', {});
  const dots = h('span', { class: 'tour-dots', 'aria-hidden': 'true' });
  const back = h('button', { type: 'button' }, '이전');
  const next = h('button', { type: 'button', class: 'primary' }, '다음');
  const skip = h('button', { type: 'button', class: 'link' }, '건너뛰기');
  const card = h('div', { class: 'tour-card', role: 'dialog', 'aria-live': 'polite', 'aria-label': '둘러보기' }, guide(), h('div', { class: 'tour-say' }, title, text), h('div', { class: 'tour-foot' }, dots, skip, back, next));
  const root = h('div', { class: 'tour' }, hole, card);

  const target = (): Rect | null => {
    const s = list[at].at;
    if (!s) return null;
    if (typeof s !== 'string') return host.rect(s.room);
    const el = document.querySelector<HTMLElement>(s);
    if (!el || el.hidden) return null;
    const r = el.getBoundingClientRect();
    return r.width && r.height ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
  };

  /** Puts the light on the target and the card beside it. Called on a timer: the screen underneath redraws itself. */
  const place = () => {
    const r = target();
    const W = window.innerWidth;
    const H = window.innerHeight;
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    root.classList.toggle('free', !r);
    if (!r) {
      card.style.left = `${Math.max(12, (W - cw) / 2)}px`;
      card.style.top = `${Math.max(12, (H - ch) / 2)}px`;
      return;
    }
    const pad = 8;
    Object.assign(hole.style, { left: `${r.x - pad}px`, top: `${r.y - pad}px`, width: `${r.w + pad * 2}px`, height: `${r.h + pad * 2}px` });
    // below the target when there is room, else above; kept inside the window
    const below = r.y + r.h + pad + 14;
    const top = below + ch < H - 12 ? below : Math.max(12, r.y - pad - 14 - ch);
    card.style.top = `${top}px`;
    card.style.left = `${Math.min(W - cw - 12, Math.max(12, r.x + r.w / 2 - cw / 2))}px`;
  };

  const end = (finished: boolean) => {
    running = false;
    window.clearInterval(timer);
    window.removeEventListener('keydown', keys, true);
    window.removeEventListener('resize', place);
    root.remove();
    try {
      localStorage.setItem(STORE, `v${VERSION}`);
    } catch {
      // it will be offered again next time
    }
    host.toFirstFloor();
    if (finished) host.celebrate();
    done();
  };

  const show = (dir: 1 | -1) => {
    // steps that do not apply here (no floor to write on, no window open) are passed over
    while (at >= 0 && at < list.length && list[at].enter?.(host) === false) at += dir;
    if (at >= list.length) return end(true);
    if (at < 0) at = 0;
    const s = list[at];
    title.textContent = s.title;
    text.textContent = s.text;
    next.textContent = s.next ?? (s.until ? '넘어가기' : '다음');
    back.hidden = at === 0;
    skip.hidden = at === list.length - 1;
    dots.replaceChildren(...list.map((_, i) => h('i', { class: i === at ? 'on' : i < at ? 'done' : '' })));
    place();
    // twice more: the floor underneath may still be sliding into place
    window.setTimeout(place, 350);
    window.setTimeout(place, 800);
  };
  const go = (dir: 1 | -1) => {
    at += dir;
    show(dir);
  };

  next.addEventListener('click', () => go(1));
  back.addEventListener('click', () => go(-1));
  skip.addEventListener('click', () => end(false));
  // While the tour runs the keys are its own: nothing underneath answers to them.
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Tab' || e.isComposing) return;
    if (document.querySelector('dialog[open]')) return;
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      end(false);
    } else if (e.key === 'Enter' || e.key === 'ArrowRight' || e.key === ' ') {
      e.preventDefault();
      go(1);
    } else if (e.key === 'ArrowLeft' && at > 0) {
      e.preventDefault();
      go(-1);
    }
  };
  window.addEventListener('keydown', keys, true);
  window.addEventListener('resize', place);
  const timer = window.setInterval(() => {
    if (list[at].until?.()) return go(1);
    place();
  }, 300);

  document.body.append(root);
  show(1);
  next.focus();
}
