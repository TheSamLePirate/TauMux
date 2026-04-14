// Inline 16×16 SVG icons, consumed by the toolbar and pane-bar. The
// strokes use currentColor so token-driven theming (M6) flows through
// automatically. Keep these tight — no drop shadows, no gradients.

export const ICONS = {
  sidebar:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1.5"/><line x1="6" y1="3" x2="6" y2="13"/></svg>',

  back: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9,3 4,8 9,13"/><line x1="4" y1="8" x2="13" y2="8"/></svg>',

  fullscreen:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3,6 3,3 6,3"/><polyline points="13,6 13,3 10,3"/><polyline points="3,10 3,13 6,13"/><polyline points="13,10 13,13 10,13"/></svg>',

  close:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>',

  settings:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="2"/><path d="M13 8a5 5 0 0 0-.12-1.1l1.1-.84-1-1.72-1.3.48a5 5 0 0 0-1.9-1.1L9.5 2h-2l-.3 1.72a5 5 0 0 0-1.9 1.1l-1.3-.48-1 1.72 1.1.84A5 5 0 0 0 4 8a5 5 0 0 0 .12 1.1l-1.1.84 1 1.72 1.3-.48a5 5 0 0 0 1.9 1.1L7.5 14h2l.3-1.72a5 5 0 0 0 1.9-1.1l1.3.48 1-1.72-1.1-.84A5 5 0 0 0 13 8z"/></svg>',

  signal:
    '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7" cy="7" r="3" fill="currentColor" stroke="none"/></svg>',
};

export type IconName = keyof typeof ICONS;
