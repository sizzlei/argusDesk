// Daily quests: three small goals each morning, picked from what the centre
// needs today (old boxes, waiting requesters, boxes nobody holds). Progress
// is read from the centre itself, so nothing has to be ticked off by hand.
// Kept on this computer only; the team's experience points are not touched.

import type { Box, GameStats, Snapshot } from './types';
import { h } from './ui';

const STORE = 'argusdesk.quests';

type QuestId = 'ship' | 'stale' | 'reply' | 'claim' | 'approve' | 'urgent';

interface Quest {
  id: QuestId;
  title: string;
  goal: number;
  progress: number;
  done: boolean;
}

interface Day {
  day: string; // "2026-11-27", local
  me: string;
  // what the centre looked like when the day's quests were set
  base: { stale: string[]; reply: string[]; loose: string[]; approvals: number; urgent: string[]; shipped: number };
  quests: Quest[];
  streak: { last: string; count: number }; // days in a row with every quest done
}

let today: Day | null = null;
let open = true;

const dayOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function load(): Day | null {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? 'null') as Day | null;
  } catch {
    return null;
  }
}
function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify(today));
  } catch {
    /* kept for this run only */
  }
}

/** A small seeded shuffle, so the day's pick is the same after a restart. */
function shuffle<T>(list: T[], seed: string): T[] {
  let x = [...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    x = (x * 1103515245 + 12345) >>> 0;
    const j = x % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const mineOpen = (b: Box) => b.mine;
const waiting = (b: Box) => !!b.reply && (b.mine || !b.assigneeId);

/** Sets the day's quests from the centre as it is now. */
function roll(snap: Snapshot, game: GameStats, me: string, prev: Day | null): Day {
  const boxes = snap.boxes;
  const base: Day['base'] = {
    stale: boxes.filter((b) => mineOpen(b) && b.stale).map((b) => b.key),
    reply: boxes.filter(waiting).map((b) => b.key),
    loose: boxes.filter((b) => !b.assigneeId && !b.myApproval).map((b) => b.key),
    approvals: boxes.filter((b) => b.myApproval).length,
    urgent: boxes.filter((b) => b.urgent && (b.mine || !b.assigneeId)).map((b) => b.key),
    shipped: game.me.today,
  };
  const day = dayOf();
  const offers: Quest[] = [];
  const q = (id: QuestId, title: string, goal: number) => offers.push({ id, title, goal, progress: 0, done: false });
  if (base.stale.length) q('stale', `내 묵은 상자 ${Math.min(2, base.stale.length)}개 치우기`, Math.min(2, base.stale.length));
  if (base.reply.length) q('reply', '기다리는 요청자에게 답하기', 1);
  if (base.loose.length) q('claim', '미배정 상자 1개 맡기', 1);
  if (base.approvals) q('approve', '내 승인 대기 모두 처리하기', 1);
  if (base.urgent.length) q('urgent', '긴급 상자 1개 처리하기', 1);
  // shipping is always one of them, the day's work whatever else is going on;
  // two more from what the centre needs today (fewer on a quiet day)
  const quests: Quest[] = [{ id: 'ship', title: '오늘 상자 3개 출고하기', goal: 3, progress: 0, done: false }, ...shuffle(offers, day + me).slice(0, 2)];
  const streak = prev?.me === me ? prev.streak : { last: '', count: 0 };
  return { day, me, base, quests, streak };
}

/** How far each quest has come, from the centre as it is now. */
function measure(d: Day, snap: Snapshot, game: GameStats) {
  const byKey = new Map(snap.boxes.map((b) => [b.key, b]));
  for (const q of d.quests) {
    let p = 0;
    switch (q.id) {
      case 'ship':
        p = game.me.today;
        break;
      case 'stale':
        // an old box of mine that is no longer old, or gone from the floor (done)
        p = d.base.stale.filter((k) => !byKey.get(k)?.stale || !byKey.get(k)?.mine).length;
        break;
      case 'reply':
        p = d.base.reply.filter((k) => !byKey.get(k)?.reply).length;
        break;
      case 'claim':
        p = d.base.loose.filter((k) => byKey.get(k)?.mine).length;
        break;
      case 'approve':
        p = snap.boxes.some((b) => b.myApproval) ? 0 : 1;
        break;
      case 'urgent':
        p = d.base.urgent.filter((k) => !byKey.get(k)?.urgent).length;
        break;
    }
    q.progress = Math.min(q.goal, p);
  }
}

/**
 * Takes a new view of the centre. Returns what was just achieved, for the
 * screen to celebrate: a quest, or the whole day.
 */
export function updateQuests(snap: Snapshot | null, game: GameStats | null, me: string): { quest?: string; day?: number } {
  if (!snap || !game || !me) return {};
  const prev = today ?? load();
  if (!prev || prev.day !== dayOf() || prev.me !== me) {
    today = roll(snap, game, me, prev);
    // what is already done when the day's quests are set is ticked without a fuss
    measure(today, snap, game);
    for (const q of today.quests) q.done = q.progress >= q.goal;
    save();
    return {};
  }
  today = prev;
  const before = new Set(today.quests.filter((q) => q.done).map((q) => q.id + q.title));
  measure(today, snap, game);
  let quest: string | undefined;
  for (const q of today.quests) {
    if (!q.done && q.progress >= q.goal) {
      q.done = true;
      if (!before.has(q.id + q.title)) quest = q.title;
    }
  }
  let day: number | undefined;
  if (today.quests.every((q) => q.done) && today.streak.last !== today.day) {
    const yesterday = dayOf(new Date(Date.now() - 86_400_000));
    today.streak = { last: today.day, count: today.streak.last === yesterday ? today.streak.count + 1 : 1 };
    day = today.streak.count;
  }
  save();
  return { quest, day };
}

/** The quest card, under the floors. */
export function renderQuests(el: HTMLElement, below: HTMLElement | null) {
  const d = today;
  el.hidden = !d || !d.quests.length;
  if (!d) return;
  if (below && !below.hidden) {
    el.style.top = `${below.offsetTop + below.offsetHeight + 10}px`;
    el.style.width = `${below.offsetWidth}px`; // the same width as the floor list above it
  }
  const done = d.quests.filter((q) => q.done).length;
  const streak = d.streak.last && d.streak.count ? d.streak.count : 0;
  const parts: (Node | null)[] = [
    h(
      'button',
      { class: 'quest-head', 'aria-expanded': String(open), onclick: () => ((open = !open), renderQuests(el, below)) },
      h('span', { class: 'quest-title' }, '오늘의 퀘스트'),
      h('span', { class: `quest-count${done === d.quests.length ? ' all' : ''}` }, `${done}/${d.quests.length}`),
    ),
    open
      ? h(
          'ul',
          {},
          ...d.quests.map((q) =>
            h(
              'li',
              { class: q.done ? 'done' : '' },
              h('span', { class: 'check', 'aria-hidden': 'true' }, q.done ? '✓' : ''),
              h('span', { class: 'what' }, q.title),
              q.goal > 1 && !q.done ? h('span', { class: 'n' }, `${q.progress}/${q.goal}`) : null,
            ),
          ),
        )
      : null,
    open && streak ? h('p', { class: 'quest-streak' }, `연속 달성 ${streak}일`) : null,
  ];
  el.replaceChildren(...parts.filter((p): p is Node => !!p));
}

/** The day's quests, for the briefing. */
export const questsToday = () => today?.quests ?? [];
