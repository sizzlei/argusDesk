// The two icon rails at the sides of the room: the left one chooses what is
// seen (floors, views, filters, today's deployments), the right one holds what
// comes to the user (notices, quests, the record) and the zoom. Icons are drawn
// here so nothing is loaded; a name shows beside an icon when it is pointed at.

const PATHS: Record<string, string> = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  all: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  mine: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  unassigned: '<path d="M12 3 21 8v8l-9 5-9-5V8z"/><path d="m3 8 9 5 9-5M12 13v8" stroke-dasharray="2 2.5"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  truck: '<path d="M2 6h12v10H2z"/><path d="M14 9h4.5L22 12.5V16h-8"/><circle cx="6.5" cy="17.5" r="1.9"/><circle cx="17.5" cy="17.5" r="1.9"/>',
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H4a3 3 0 0 0 4 4M16 6h4a3 3 0 0 1-4 4M12 13v4M8 21h8M9 17h6"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  legend: '<path d="M4 6h3M4 12h3M4 18h3M10 6h10M10 12h10M10 18h10"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/>',
};

/** An icon of the rails, drawn with the current text colour. */
export function icon(name: keyof typeof PATHS | string) {
  const el = document.createElement('span');
  el.className = 'ri';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${PATHS[name] ?? ''}</svg>`;
  return el;
}

/**
 * Names beside the icons. One floating label for both rails, so a rail that
 * scrolls in a short window does not cut its labels off. An element shows the
 * text of its data-tip attribute, on the side away from its rail.
 */
export function initRailTips() {
  const tip = document.createElement('div');
  tip.id = 'rail-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.getElementById('stage')!.append(tip);
  const show = (target: EventTarget | null) => {
    const el = target instanceof Element ? target.closest<HTMLElement>('.rail [data-tip]') : null;
    if (!el || !el.dataset.tip) return void (tip.hidden = true);
    const r = el.getBoundingClientRect();
    const host = tip.parentElement!.getBoundingClientRect();
    tip.textContent = el.dataset.tip;
    tip.hidden = false;
    const left = !!el.closest('#rail-left');
    tip.classList.toggle('from-right', !left);
    const y = r.top + r.height / 2 - host.top - tip.offsetHeight / 2;
    tip.style.top = `${Math.max(4, y)}px`;
    tip.style.left = left ? `${r.right - host.left + 10}px` : `${r.left - host.left - tip.offsetWidth - 10}px`;
  };
  for (const id of ['rail-left', 'rail-right']) {
    const rail = document.getElementById(id)!;
    rail.addEventListener('pointerover', (e) => show(e.target));
    rail.addEventListener('pointerleave', () => (tip.hidden = true));
    rail.addEventListener('focusin', (e) => (e.target as HTMLElement).matches(':focus-visible') && show(e.target));
    rail.addEventListener('focusout', () => (tip.hidden = true));
    rail.addEventListener('click', () => (tip.hidden = true));
  }
}
