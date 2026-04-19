export const ICON_TEMPLATES = {
  activity:
    '<path d="M4 12h3l2.2-4.4L14 16l2.2-4H20"/><circle cx="4" cy="12" r="1"/><circle cx="20" cy="12" r="1"/>',
  bell: '<path d="M8 17h8"/><path d="M9 17V11a3 3 0 1 1 6 0v6"/><path d="M6 17h12"/><path d="M10.5 20a1.5 1.5 0 0 0 3 0"/>',
  bolt: '<path d="M13 3 6 13h5l-1 8 8-11h-5l0-7Z"/>',
  chart:
    '<path d="M4 19h16"/><path d="M7 15.5 10.5 12l3 2 5-6"/><circle cx="7" cy="15.5" r="1"/><circle cx="10.5" cy="12" r="1"/><circle cx="13.5" cy="14" r="1"/><circle cx="18.5" cy="8" r="1"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  close: '<path d="m7 7 10 10M17 7 7 17"/>',
  cloud:
    '<path d="M7.5 18a4 4 0 1 1 .7-7.9 5.5 5.5 0 0 1 10.3 2.2A3.7 3.7 0 0 1 18.3 18H7.5Z"/>',
  command:
    '<path d="M9 9H7.5A2.5 2.5 0 1 1 10 6.5V17.5A2.5 2.5 0 1 1 7.5 15H17.5A2.5 2.5 0 1 1 15 17.5V6.5A2.5 2.5 0 1 1 17.5 9H9Zm6 0v6"/>',
  cpu: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4"/>',
  database:
    '<ellipse cx="12" cy="6" rx="6" ry="3"/><path d="M6 6v8c0 1.7 2.7 3 6 3s6-1.3 6-3V6"/><path d="M6 10c0 1.7 2.7 3 6 3s6-1.3 6-3"/>',
  error:
    '<circle cx="12" cy="12" r="8.5"/><path d="M12 8v5"/><circle cx="12" cy="16.5" r="1"/>',
  eye: '<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/>',
  folder:
    '<path d="M3.5 7.5h5l1.6 2H20a1.5 1.5 0 0 1 1.5 1.5v6.5A2.5 2.5 0 0 1 19 20H5a2.5 2.5 0 0 1-2.5-2.5V9A1.5 1.5 0 0 1 4 7.5Z"/>',
  gitBranch:
    '<circle cx="7" cy="5" r="2"/><circle cx="17" cy="19" r="2"/><circle cx="17" cy="7" r="2"/><path d="M7 7v7a5 5 0 0 0 5 5h3"/><path d="M7 7a5 5 0 0 0 5 5h3"/>',
  globe:
    '<circle cx="12" cy="12" r="8.5"/><path d="M3.8 9h16.4M3.8 15h16.4M12 3.5c2.3 2.3 3.5 5.3 3.5 8.5S14.3 18.2 12 20.5M12 3.5C9.7 5.8 8.5 8.8 8.5 12s1.2 6.2 3.5 8.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><circle cx="12" cy="8" r="1"/>',
  hammer:
    '<path d="m14 5 5 5"/><path d="m11 8 3-3 5 5-3 3"/><path d="M4 20 13 11"/>',
  key: '<circle cx="8" cy="12" r="3"/><path d="M11 12h9"/><path d="M17 12v3"/><path d="M20 12v2"/>',
  lock: '<rect x="6.5" y="10.5" width="11" height="9" rx="2"/><path d="M9 10.5V8a3 3 0 1 1 6 0v2.5"/>',
  logs: '<path d="M7 7h10M7 12h10M7 17h6"/><path d="M4 7h.01M4 12h.01M4 17h.01"/>',
  memory:
    '<rect x="4" y="7" width="16" height="10" rx="2"/><path d="M8 10h8M8 14h5"/>',
  moon: '<path d="M16.5 15.5A6.5 6.5 0 0 1 8.5 7.5a6.5 6.5 0 1 0 8 8Z"/>',
  network:
    '<path d="M4 18a10 10 0 0 1 16 0"/><path d="M7 14a6 6 0 0 1 10 0"/><path d="M10 10a2.5 2.5 0 0 1 4 0"/><circle cx="12" cy="18" r="1"/>',
  notification:
    '<path d="M8 17h8"/><path d="M9 17V11a3 3 0 1 1 6 0v6"/><path d="M6 17h12"/>',
  package:
    '<path d="m12 3 7 4-7 4-7-4 7-4Z"/><path d="m5 7v8l7 4 7-4V7"/><path d="M12 11v8"/>',
  pane: '<rect x="4.5" y="6" width="15" height="12" rx="1.5"/><path d="M12 6v12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  rocket:
    '<path d="M14 5c3.5 0 5 1.5 5 5-1.5 2.5-3.5 4.5-6 6-3.5 0-5-1.5-5-5 1.5-2.5 3.5-4.5 6-6Z"/><path d="m8 16-3 3M9 19l-4-1 1-4"/><circle cx="14.5" cy="9.5" r="1.2"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m16 16 4.5 4.5"/>',
  server:
    '<rect x="5" y="5.5" width="14" height="5" rx="1.5"/><rect x="5" y="13.5" width="14" height="5" rx="1.5"/><path d="M8 8h.01M8 16h.01"/>',
  shield:
    '<path d="M12 3.5 18.5 6v5.5c0 4-2.5 6.4-6.5 9-4-2.6-6.5-5-6.5-9V6L12 3.5Z"/>',
  sidebar:
    '<rect x="4.5" y="5.5" width="15" height="13" rx="1.5"/><path d="M10 5.5v13"/><path d="M7.5 8.5h0M7.5 12h0M7.5 15.5h0"/>',
  sparkles:
    '<path d="m12 4 1.2 3.3L16.5 8.5l-3.3 1.2L12 13l-1.2-3.3L7.5 8.5l3.3-1.2L12 4Z"/><path d="m18 14 .8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14Z"/><path d="m6 14 .6 1.6L8.2 16l-1.6.6L6 18.2l-.6-1.6L3.8 16l1.6-.4L6 14Z"/>',
  splitHorizontal:
    '<rect x="4.5" y="6" width="15" height="12" rx="1.5"/><path d="M12 6v12"/><path d="m10 10-2 2 2 2M14 10l2 2-2 2"/>',
  splitVertical:
    '<rect x="4.5" y="6" width="15" height="12" rx="1.5"/><path d="M4.5 12h15"/><path d="m9 10 3-2 3 2M9 14l3 2 3-2"/>',
  terminal:
    '<rect x="4.5" y="6" width="15" height="12" rx="1.5"/><path d="m8 10 3 2-3 2"/><path d="M13 15h3.5"/>',
  warning:
    '<path d="M12 4.5 20 19.5H4L12 4.5Z"/><path d="M12 9v4.5"/><circle cx="12" cy="16.5" r="1"/>',
  window:
    '<rect x="4.5" y="6" width="15" height="12" rx="1.5"/><path d="M4.5 9.5h15"/><path d="M7.5 7.75h0M10 7.75h0M12.5 7.75h0"/>',
  chevronUp: '<path d="m7 15 5-5 5 5"/>',
  chevronDown: '<path d="m7 9 5 5 5-5"/>',
  chevronLeft: '<path d="m15 7-5 5 5 5"/>',
  chevronRight: '<path d="m9 7 5 5-5 5"/>',
  reload: '<path d="M3.5 2v6h6"/><path d="M3.8 8A9 9 0 1 1 3 12"/>',
  code: '<path d="m8 18-6-6 6-6"/><path d="m16 6 6 6-6 6"/>',
  wrench:
    '<path d="m14 7 3-3a3 3 0 0 1-4 4l-7 7a2 2 0 1 1-3-3l7-7a3 3 0 0 1 4 4Z"/>',
  workspace:
    '<path d="M4.5 7.5A2.5 2.5 0 0 1 7 5h10a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 17 19H7a2.5 2.5 0 0 1-2.5-2.5v-9Z"/><path d="M8 9h8M8 13h5"/>',
  messageCircle:
    '<path d="M21 11.5a8.4 8.4 0 0 1-1.1 4.2 8.5 8.5 0 0 1-7.4 4.3 8.4 8.4 0 0 1-4.2-1.1L3 20l1.1-5.3a8.4 8.4 0 0 1-1.1-4.2 8.5 8.5 0 0 1 4.3-7.4A8.4 8.4 0 0 1 11.5 2h.5a8.5 8.5 0 0 1 8 8v.5Z"/>',
  send: '<path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4 20-7Z"/>',
} as const;

export type IconName = keyof typeof ICON_TEMPLATES;

export const FUTURE_STATUS_ICONS: IconName[] = [
  "activity",
  "bell",
  "bolt",
  "chart",
  "check",
  "cloud",
  "cpu",
  "database",
  "error",
  "eye",
  "gitBranch",
  "globe",
  "hammer",
  "key",
  "lock",
  "memory",
  "moon",
  "network",
  "package",
  "rocket",
  "server",
  "shield",
  "sparkles",
  "terminal",
  "warning",
  "wrench",
];

export function createIcon(
  name: IconName,
  className?: string,
  size = 14,
): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.classList.add("ht-icon");
  if (className) svg.classList.add(className);
  svg.innerHTML = ICON_TEMPLATES[name];
  return svg;
}
