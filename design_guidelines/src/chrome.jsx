// Shared chrome primitives for all τ-mux variants.
// Each is a small, composable piece so the three variants can mix them.

const T = window.TAU;

// ─── Pixel T logo (SVG, recreated — never embed the raster) ───────────────
function TauLogo({ size = 18, glow = true }) {
  // A chunky "τ" shape on a pixel grid. Hand-crafted to feel like the icon.
  // Grid is 10x10; each "pixel" rendered as a <rect>.
  const px = size / 10;
  // 1 = filled white pixel
  const grid = [
    "..........",
    "..........",
    "..#######.",
    ".##....#..",
    ".#...###..",
    "....###...",
    "....##....",
    "....##....",
    "...####...",
    "..........",
  ];
  const rects = [];
  grid.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === '#') rects.push(<rect key={x+'-'+y} x={x*px} y={y*px} width={px} height={px} fill="#fff" />);
    }
  });
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      style={{ filter: glow ? `drop-shadow(0 0 ${size*0.35}px ${T.cyanGlow}) drop-shadow(0 0 ${size*0.12}px ${T.cyan})` : 'none' }}>
      {rects}
    </svg>
  );
}

// ─── Traffic lights (custom: matte, slightly darker rims) ──────────────────
function TrafficLights({ active = true, size = 12 }) {
  const dot = (bg) => (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: active ? bg : '#2a3238',
      boxShadow: active
        ? `inset 0 0 0 0.5px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.15)`
        : `inset 0 0 0 0.5px rgba(0,0,0,0.25)`,
    }} />
  );
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
      {dot(T.tlRed)}{dot(T.tlYel)}{dot(T.tlGrn)}
    </div>
  );
}

// ─── Outer window shell ────────────────────────────────────────────────────
function AppWindow({ title, children, toolbar, width = 1280, height = 820, accent = T.cyan }) {
  return (
    <div style={{
      width, height, borderRadius: 12, overflow: 'hidden',
      background: T.bg,
      boxShadow: `0 0 0 0.5px ${T.panelEdge}, 0 30px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(0,0,0,0.6)`,
      fontFamily: T.sans, color: T.text, position: 'relative', display: 'flex', flexDirection: 'column',
    }}>
      {/* Title bar */}
      <div style={{
        height: 38, display: 'flex', alignItems: 'center', gap: 12, padding: '0 12px',
        background: `linear-gradient(180deg, #0d1317 0%, #0a0e11 100%)`,
        borderBottom: `0.5px solid ${T.panelEdge}`,
        flexShrink: 0,
      }}>
        <TrafficLights />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 4 }}>
          <TauLogo size={14} />
          <span style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: 0.2, color: T.text }}>{title}</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>{toolbar}</div>
      </div>
      {/* Content */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        {children}
      </div>
    </div>
  );
}

// ─── Terminal pane (shell for the uncontrolled TUI content) ────────────────
function Pane({
  title, subtitle, kind = 'agent', focused = false, icon, children,
  tabs, onTabClick, activeTab = 0, footer, actions,
  flex = 1, minWidth = 0,
}) {
  const accent = kind === 'agent' ? T.agent : T.cyan;
  const dim = kind === 'agent' ? T.agentDim : T.cyanDim;
  return (
    <div style={{
      flex, minWidth, display: 'flex', flexDirection: 'column',
      background: T.panel,
      border: `0.5px solid ${focused ? accent : T.panelEdge}`,
      boxShadow: focused ? `0 0 0 0.5px ${accent}, 0 0 24px ${dim}` : 'none',
      borderRadius: 8, overflow: 'hidden', position: 'relative', minHeight: 0,
    }}>
      {/* pane header */}
      <div style={{
        height: 28, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px',
        background: focused ? T.panelHi : T.panel,
        borderBottom: `0.5px solid ${T.panelEdge}`,
        flexShrink: 0, fontSize: 11.5,
      }}>
        <span className="tau-dot" style={{
          background: focused ? accent : T.textFaint,
          boxShadow: focused ? `0 0 6px ${accent}` : 'none',
        }} />
        {tabs ? (
          <div style={{ display: 'flex', gap: 2, minWidth: 0, flex: 1 }}>
            {tabs.map((t, i) => (
              <button key={i} onClick={() => onTabClick && onTabClick(i)}
                style={{
                  background: i === activeTab ? T.panelHi : 'transparent',
                  border: 'none', padding: '3px 10px', borderRadius: 5, cursor: 'pointer',
                  color: i === activeTab ? T.text : T.textDim,
                  fontFamily: T.sans, fontSize: 11.5, fontWeight: i === activeTab ? 600 : 500,
                  display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
                }}>
                {t.icon}
                <span>{t.label}</span>
                {t.badge && <span style={{
                  fontFamily: T.mono, fontSize: 9.5, fontWeight: 600,
                  color: t.badgeColor || T.textDim,
                  padding: '1px 5px', borderRadius: 3,
                  background: t.badgeBg || 'transparent',
                  border: `0.5px solid ${t.badgeColor || T.panelEdge}`,
                }}>{t.badge}</span>}
              </button>
            ))}
          </div>
        ) : (
          <>
            {icon}
            <span style={{ color: T.text, fontWeight: 600 }}>{title}</span>
            {subtitle && <span style={{ color: T.textDim, fontFamily: T.mono }}>{subtitle}</span>}
          </>
        )}
        <div style={{ flex: 1 }} />
        {actions || (
          <div style={{ display: 'flex', gap: 6, color: T.textMute }}>
            <IconBtn title="split">⌗</IconBtn>
            <IconBtn title="zen">◱</IconBtn>
            <IconBtn title="close">×</IconBtn>
          </div>
        )}
      </div>
      {/* pane body */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
        {children}
      </div>
      {footer}
    </div>
  );
}

function IconBtn({ children, title, onClick, active }) {
  return (
    <button title={title} onClick={onClick} style={{
      width: 18, height: 18, display: 'grid', placeItems: 'center',
      background: active ? T.cyanDim : 'transparent',
      border: 'none', borderRadius: 4, cursor: 'pointer',
      color: active ? T.cyan : T.textMute,
      fontFamily: T.mono, fontSize: 12, padding: 0,
    }}>{children}</button>
  );
}

// ─── Terminal body: pre-rendered TUI-ish content (uncontrolled) ────────────
function TerminalBody({ children, padding = 10, bg }) {
  return (
    <div className="tau-scrollbar" style={{
      position: 'absolute', inset: 0, background: bg || T.void,
      fontFamily: T.mono, fontSize: 11.5, lineHeight: 1.5, color: T.text,
      padding, overflow: 'auto', whiteSpace: 'pre',
    }}>
      {children}
    </div>
  );
}

// ─── Sidebar building blocks ───────────────────────────────────────────────
function SidebarSection({ title, count, children, open = true }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px',
        color: T.textMute, fontSize: 10, fontWeight: 600, letterSpacing: 1.2,
        textTransform: 'uppercase',
      }}>
        <span style={{ fontFamily: T.mono }}>{open ? '▾' : '▸'}</span>
        <span>{title}</span>
        {count != null && <span style={{ color: T.textFaint, fontFamily: T.mono }}>{count}</span>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function WorkspaceCard({ name, kind = 'mixed', active, sessions = [], branch, dir, compact }) {
  const accent = kind === 'agent' ? T.agent : kind === 'human' ? T.cyan : T.text;
  return (
    <div style={{
      margin: '0 8px 6px', padding: compact ? '6px 8px' : '8px 10px',
      borderRadius: 8,
      background: active ? T.panelHi : 'transparent',
      border: `0.5px solid ${active ? T.cyanDim : 'transparent'}`,
      cursor: 'pointer',
      position: 'relative',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="tau-dot" style={{
          background: accent,
          boxShadow: active ? `0 0 6px ${accent}` : 'none',
        }} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: active ? T.text : T.textDim, fontFamily: T.mono }}>{name}</span>
        <div style={{ flex: 1 }} />
        {branch && <BranchChip>{branch}</BranchChip>}
      </div>
      {!compact && sessions.length > 0 && (
        <div style={{ marginTop: 6, paddingLeft: 14, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {sessions.map((s, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 11, color: T.textDim, fontFamily: T.mono,
            }}>
              <span style={{ color: T.textFaint }}>{i === sessions.length - 1 ? '└' : '├'}</span>
              <span style={{
                width: 5, height: 5, borderRadius: 1,
                background: s.kind === 'agent' ? T.agent : T.cyan,
                opacity: s.idle ? 0.4 : 1,
              }} />
              <span style={{ color: s.active ? T.text : T.textDim }}>{s.name}</span>
              {s.running && <span style={{
                width: 4, height: 4, borderRadius: '50%',
                background: T.ok, animation: 'tauPulse 1.4s ease-in-out infinite',
              }} />}
            </div>
          ))}
        </div>
      )}
      {!compact && dir && (
        <div style={{ marginTop: 6, fontSize: 10.5, color: T.textMute, fontFamily: T.mono, letterSpacing: 0.1 }}>
          {dir}
        </div>
      )}
    </div>
  );
}

function BranchChip({ children, color }) {
  return (
    <span style={{
      fontFamily: T.mono, fontSize: 9.5, fontWeight: 600,
      color: color || T.cyan,
      padding: '2px 6px', borderRadius: 3,
      background: 'rgba(111,233,255,0.08)',
      border: `0.5px solid ${T.cyanDim}`,
      letterSpacing: 0.1,
    }}>{children}</span>
  );
}

// ─── Status bar items ──────────────────────────────────────────────────────
function StatusBar({ children, bg }) {
  return (
    <div style={{
      height: 26, display: 'flex', alignItems: 'center', gap: 14, padding: '0 12px',
      background: bg || T.panel,
      borderTop: `0.5px solid ${T.panelEdge}`,
      fontSize: 11, color: T.textDim, fontFamily: T.mono, flexShrink: 0,
    }}>
      {children}
    </div>
  );
}

function StatusItem({ label, value, color, meter }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {label && <span style={{ color: T.textMute, textTransform: 'uppercase', fontSize: 9.5, letterSpacing: 1 }}>{label}</span>}
      <span style={{ color: color || T.text }}>{value}</span>
      {meter != null && <Meter value={meter} color={color} />}
    </div>
  );
}

function Meter({ value = 0.5, width = 50, color = T.cyan }) {
  return (
    <div style={{
      width, height: 4, background: T.panelEdge, borderRadius: 2, overflow: 'hidden',
    }}>
      <div style={{ width: `${Math.min(100, value*100)}%`, height: '100%', background: color, boxShadow: `0 0 6px ${color}` }} />
    </div>
  );
}

// ─── Command bar / palette trigger ─────────────────────────────────────────
function CommandBar({ placeholder = 'Run command, switch pane, attach agent…', accent = T.cyan }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      height: 26, padding: '0 10px',
      background: T.panelHi, border: `0.5px solid ${T.panelEdge}`,
      borderRadius: 6, flex: 1, maxWidth: 520, minWidth: 0,
    }}>
      <span style={{ color: T.textMute, fontFamily: T.mono, fontSize: 11 }}>⌘K</span>
      <span style={{ color: T.textDim, fontSize: 12, flex: 1, fontFamily: T.sans }}>{placeholder}</span>
      <span style={{ color: accent, fontFamily: T.mono, fontSize: 10 }}>τ</span>
    </div>
  );
}

// ─── SVG helper icons (kept geometric, no illustrations) ───────────────────
const Ico = {
  split: <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><rect x=".5" y=".5" width="10" height="10" stroke="currentColor" strokeWidth=".7"/><line x1="5.5" y1="1" x2="5.5" y2="10" stroke="currentColor" strokeWidth=".7"/></svg>,
  grid: <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x=".5" y=".5" width="4" height="4" stroke="currentColor" strokeWidth=".7"/><rect x="5.5" y=".5" width="4" height="4" stroke="currentColor" strokeWidth=".7"/><rect x=".5" y="5.5" width="4" height="4" stroke="currentColor" strokeWidth=".7"/><rect x="5.5" y="5.5" width="4" height="4" stroke="currentColor" strokeWidth=".7"/></svg>,
  agent: <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><circle cx="5.5" cy="5.5" r="3" stroke="currentColor" strokeWidth=".7"/><circle cx="5.5" cy="5.5" r="1" fill="currentColor"/></svg>,
  human: <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><circle cx="5.5" cy="3.5" r="1.8" stroke="currentColor" strokeWidth=".7"/><path d="M2 10c.3-2.2 1.8-3.2 3.5-3.2S8.7 7.8 9 10" stroke="currentColor" strokeWidth=".7" fill="none"/></svg>,
  plus: <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth=".9" strokeLinecap="round"/></svg>,
  git: <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><circle cx="2" cy="2" r="1.2" stroke="currentColor" strokeWidth=".7"/><circle cx="2" cy="8" r="1.2" stroke="currentColor" strokeWidth=".7"/><circle cx="8" cy="5" r="1.2" stroke="currentColor" strokeWidth=".7"/><path d="M2 3.2v3.6M3 2.5c3 .2 4 1.2 4 2.5" stroke="currentColor" strokeWidth=".7" fill="none"/></svg>,
  spark: <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M5.5 1L6.5 4.5L10 5.5L6.5 6.5L5.5 10L4.5 6.5L1 5.5L4.5 4.5Z" fill="currentColor"/></svg>,
};

// Export to window so other files can use them
Object.assign(window, {
  TauLogo, TrafficLights, AppWindow, Pane, IconBtn, TerminalBody,
  SidebarSection, WorkspaceCard, BranchChip,
  StatusBar, StatusItem, Meter, CommandBar, Ico,
});
