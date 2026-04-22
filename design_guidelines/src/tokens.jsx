// Shared tokens for the τ-mux revamp.
// Palette: the app icon is a pixel T with cyan glow on pure black.
// We keep the glow as the sole primary accent, plus a warm amber for agents.

const TAU = {
  // surface
  void:      '#000000',
  bg:        '#07090b',   // app window background
  panel:     '#0b1013',   // default pane
  panelHi:   '#0f161a',   // slightly lifted
  panelEdge: '#1a2328',   // 1px borders
  panelEdgeSoft: '#121a1e',

  // text
  text:      '#d6e2e8',
  textDim:   '#8a9aa3',
  textMute:  '#55646c',
  textFaint: '#38434a',

  // accent — cyan from the logo glow
  cyan:      '#6fe9ff',
  cyanSoft:  '#33b8d6',
  cyanDim:   'rgba(111,233,255,0.18)',
  cyanGlow:  'rgba(111,233,255,0.55)',

  // agents (warm amber) + humans (cyan)
  agent:     '#ffc56b',
  agentSoft: '#d59a45',
  agentDim:  'rgba(255,197,107,0.14)',

  // states
  ok:        '#8ce99a',
  warn:      '#ffc56b',
  err:       '#ff8a8a',

  // macOS traffic lights
  tlRed:     '#ff5f57',
  tlYel:     '#febc2e',
  tlGrn:     '#28c93f',

  // fonts
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  sans: "'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
};

// Inject one-time keyframes + utility classes
if (typeof document !== 'undefined' && !document.getElementById('tau-base-styles')) {
  const s = document.createElement('style');
  s.id = 'tau-base-styles';
  s.textContent = `
    @keyframes tauBlink { 0%,49%{opacity:1} 50%,100%{opacity:0} }
    @keyframes tauPulse { 0%,100%{opacity:.35;transform:scale(1)} 50%{opacity:.75;transform:scale(1.15)} }
    @keyframes tauGlowPulse { 0%,100%{filter:drop-shadow(0 0 6px ${TAU.cyanGlow})} 50%{filter:drop-shadow(0 0 14px ${TAU.cyanGlow})} }
    @keyframes tauScan { 0%{transform:translateX(-100%)} 100%{transform:translateX(300%)} }
    @keyframes tauBar { 0%,100%{transform:scaleY(.35)} 50%{transform:scaleY(1)} }
    .tau-cursor{display:inline-block;width:.55em;height:1.05em;background:${TAU.cyan};vertical-align:-2px;animation:tauBlink 1.1s steps(2,end) infinite;box-shadow:0 0 8px ${TAU.cyanGlow}}
    .tau-dot{width:7px;height:7px;border-radius:50%;display:inline-block}
    .tau-scrollbar::-webkit-scrollbar{width:6px;height:6px}
    .tau-scrollbar::-webkit-scrollbar-thumb{background:${TAU.panelEdge};border-radius:3px}
  `;
  document.head.appendChild(s);
}

window.TAU = TAU;
