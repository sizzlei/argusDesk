// The game: levels and badges worked out from finished tickets. The team's
// total and the user's own numbers are shown; nobody else's are.

import type { Badge, GameStats, Tally } from './types';
import { fill, h } from './ui';

const SEEN = 'argusdesk.badges'; // badges already celebrated on this computer

function seen(): Set<string> | null {
  try {
    const raw = localStorage.getItem(SEEN);
    return raw ? new Set(JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}

function remember(ids: string[]) {
  try {
    localStorage.setItem(SEEN, JSON.stringify(ids));
  } catch {
    // no storage: badges are simply celebrated again next time
  }
}

/** What is new between two readings, for the celebration. */
export function news(prev: GameStats | null, next: GameStats) {
  const earned = next.badges.filter((b) => b.earned);
  const known = prev ? new Set(prev.badges.filter((b) => b.earned).map((b) => b.id)) : seen();
  remember(earned.map((b) => b.id));
  return {
    // The first reading on a computer celebrates nothing: those were earned before.
    badges: known ? earned.filter((b) => !known.has(b.id)) : [],
    myLevel: prev && next.me.level > prev.me.level ? next.me.level : 0,
    teamLevel: prev && next.team.level > prev.team.level ? next.team.level : 0,
  };
}

const pct = (t: Tally) => Math.round(((t.xp - t.levelXp) / Math.max(1, t.nextXp - t.levelXp)) * 100);

function bar(t: Tally, label: string) {
  return h(
    'div',
    { class: 'xp', role: 'progressbar', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct(t)) },
    h('i', { style: `width:${pct(t)}%` }),
  );
}

function card(title: string, t: Tally, cls: string) {
  return h(
    'section',
    { class: `tally ${cls}` },
    h('p', { class: 'who' }, title, h('b', {}, `Lv.${t.level}`)),
    bar(t, `${title} 경험치`),
    h('p', { class: 'quiet' }, `${t.xp.toLocaleString()} / ${t.nextXp.toLocaleString()} XP`),
    h(
      'dl',
      {},
      h('div', {}, h('dt', {}, '오늘'), h('dd', {}, String(t.today))),
      h('div', {}, h('dt', {}, '이번 주'), h('dd', {}, String(t.week))),
      h('div', {}, h('dt', {}, '시즌'), h('dd', {}, t.done.toLocaleString())),
    ),
  );
}

function badge(b: Badge) {
  return h(
    'li',
    { class: b.earned ? 'earned' : 'locked', title: b.desc },
    h('span', { class: 'medal', 'aria-hidden': 'true' }, b.earned ? '★' : '☆'),
    h('span', { class: 'name' }, b.name),
    h('span', { class: 'quiet' }, b.earned ? b.desc : `${b.desc} · ${b.have}/${b.need}`),
  );
}

/** The chip in the HUD: the centre's level and mine. */
export function gameChip(stats: GameStats | null, open: boolean, toggle: () => void) {
  if (!stats) return null;
  return h(
    'button',
    { class: 'game-chip', 'aria-expanded': String(open), 'aria-controls': 'game', title: '레벨과 배지', onclick: toggle },
    h('span', { class: 'lv team' }, `센터 Lv.${stats.team.level}`),
    bar(stats.team, '센터 경험치'),
    h('span', { class: 'lv' }, `나 Lv.${stats.me.level}`),
  );
}

/** The panel behind the chip. */
export function renderGame(stats: GameStats | null, open: boolean, close: () => void) {
  const el = document.getElementById('game')!;
  el.hidden = !open || !stats;
  if (el.hidden || !stats) return;
  const mine = stats.badges.filter((b) => b.scope === 'me');
  const team = stats.badges.filter((b) => b.scope === 'team');
  const since = new Date(stats.since);
  fill(
    el,
    h(
      'div',
      { class: 'panel-head' },
      h('strong', {}, '기록'),
      h('button', { class: 'close', 'aria-label': '기록 닫기', onclick: close }, '×'),
    ),
    h('p', { class: 'quiet' }, `${since.getFullYear()}년 ${since.getMonth() + 1}월 ${since.getDate()}일부터의 시즌 · 출고한 상자로 계산합니다`),
    h('div', { class: 'tallies' }, card('센터 (팀 합계)', stats.team, 'team'), card('나', stats.me, 'me')),
    h('h3', {}, `내 배지 ${mine.filter((b) => b.earned).length}/${mine.length}`),
    h('ul', { class: 'badges' }, ...mine.map(badge)),
    h('h3', {}, `팀 배지 ${team.filter((b) => b.earned).length}/${team.length}`),
    h('ul', { class: 'badges' }, ...team.map(badge)),
  );
}
