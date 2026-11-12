// One icon set for the whole UI: 24x24, rounded 2.5 px strokes, currentColor. No emoji anywhere.
const S = (body, fill = false) => `<svg class="ico-svg" viewBox="0 0 24 24" aria-hidden="true" fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
export const ICONS = {
  pause: S('<rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor"/>'),
  menu: S('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  flag: S('<path d="M5 21V4"/><path d="M5 4h13l-2.5 4L18 12H5" fill="currentColor"/>'),
  skull: S('<path d="M12 3a8 8 0 0 0-5 14.2V20h10v-2.8A8 8 0 0 0 12 3z" fill="currentColor" stroke="none"/><circle cx="9" cy="11.5" r="1.9" fill="#20263a" stroke="none"/><circle cx="15" cy="11.5" r="1.9" fill="#20263a" stroke="none"/><path d="M10.5 20v-2M13.5 20v-2" stroke="#20263a" stroke-width="1.6"/>'),
  car: S('<path d="M3 15v-3l2.5-4.5h9L18 12h2.5a1 1 0 0 1 1 1v2" /><path d="M3 15h18.5"/><circle cx="7.5" cy="16.5" r="2.2" fill="currentColor"/><circle cx="17" cy="16.5" r="2.2" fill="currentColor"/>'),
  gift: S('<rect x="3.5" y="9" width="17" height="11" rx="1.5"/><path d="M2.5 9h19M12 9v11"/><path d="M12 9c-1.5-4-6-4-5.5-1.2C7 9.5 12 9 12 9zm0 0c1.5-4 6-4 5.5-1.2C17 9.5 12 9 12 9z"/>'),
  gear: S('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8"/>'),
  close: S('<path d="M6 6l12 12M18 6L6 18"/>'),
  check: S('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  lock: S('<rect x="5" y="10.5" width="14" height="10" rx="2" fill="currentColor"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>'),
  star: S('<path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z" stroke-width="1.5"/>', true),
  run: S('<path d="M4 18h3l3-5 3 2 2 5"/><path d="M10 13l2-5h4l2 3h3"/><circle cx="15" cy="4.5" r="1.8" fill="currentColor"/>'),
  retry: S('<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4 4.5v4h4"/>'),
  trophy: S('<path d="M7 4h10v5a5 5 0 0 1-10 0z" fill="currentColor"/><path d="M7 6H4v1.5A3.5 3.5 0 0 0 7.5 11M17 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5M12 14v4M8 20.5h8"/>'),
  video: S('<rect x="3" y="6" width="13" height="12" rx="2" fill="currentColor"/><path d="M16 10.5l5-3v9l-5-3z" fill="currentColor"/>'),
  play: S('<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>'),
  next: S('<path d="M5 12h13M13 6l6 6-6 6"/>'),
};
export const icon = (n) => ICONS[n] || '';
export function fillIcons(root = document) { root.querySelectorAll('[data-ic]').forEach((el) => { el.innerHTML = icon(el.dataset.ic); }); }
