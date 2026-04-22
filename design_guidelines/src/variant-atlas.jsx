// Variant 3 · "Atlas"
// Bold: replaces the list sidebar with a workspace GRAPH — nodes connected
// by session edges — and moves tabs to a vertical rail between the graph and
// the pane stack. Bottom "ticker" streams every agent event.

const T = window.TAU;

function VariantAtlas() {
  const [focus, setFocus] = React.useState('top');

  // nodes on a 200×560 canvas
  const nodes = [
    { id: 'crazy', x: 90,  y:  60, label: 'crazyShell', kind: 'repo', active: true },
    { id: 'cc',    x: 150, y: 140, label: 'claude-code', kind: 'agent', running: true },
    { id: 'lz',    x:  40, y: 160, label: 'lazygit',   kind: 'tool' },
    { id: 'oc',    x: 110, y: 230, label: 'opencode',  kind: 'agent' },
    { id: 'cx',    x:  50, y: 300, label: 'codex',     kind: 'agent', running: true },
    { id: 'tau',   x: 140, y: 360, label: 'τ-mux',     kind: 'self' },
    { id: 'rata',  x:  60, y: 430, label: 'rataPI',    kind: 'repo' },
    { id: 't3',    x: 140, y: 500, label: 't3code',    kind: 'repo' },
  ];
  const edges = [
    ['crazy','cc'], ['crazy','lz'], ['cc','oc'], ['crazy','oc'],
    ['oc','cx'], ['tau','cx'], ['tau','cc'],
    ['rata','tau'], ['t3','rata'],
  ];
  const nodeById = Object.fromEntries(nodes.map(n => [n.id, n]));
  const colorFor = (k) => k==='agent'?T.agent : k==='self'?T.cyan : k==='tool'?T.textDim : T.text;

  const Graph = (
    <div style={{
      width: 220, background: T.void, borderRight: `0.5px solid ${T.panelEdge}`,
      position: 'relative', flexShrink: 0, overflow: 'hidden',
    }}>
      <div style={{
        padding: '10px 12px 6px', fontSize: 10, fontWeight: 700,
        letterSpacing: 1.5, color: T.textDim, textTransform: 'uppercase',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <TauLogo size={12} />
        <span>Atlas</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: T.mono, fontWeight: 400, color: T.textMute }}>graph</span>
      </div>
      <svg width="220" height="580" style={{ display: 'block' }}>
        <defs>
          <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke={T.panelEdgeSoft} strokeWidth="0.5"/>
          </pattern>
        </defs>
        <rect width="220" height="580" fill="url(#grid)" />
        {edges.map(([a, b], i) => {
          const A = nodeById[a], B = nodeById[b];
          const running = A.running || B.running;
          return (
            <line key={i} x1={A.x} y1={A.y} x2={B.x} y2={B.y}
              stroke={running ? T.cyan : T.panelEdge} strokeWidth={running ? 1 : 0.6}
              strokeOpacity={running ? 0.55 : 1}
              strokeDasharray={running ? "3 3" : "0"}>
              {running && <animate attributeName="stroke-dashoffset" from="0" to="-6" dur="0.6s" repeatCount="indefinite" />}
            </line>
          );
        })}
        {nodes.map(n => {
          const c = colorFor(n.kind);
          return (
            <g key={n.id}>
              {n.running && <circle cx={n.x} cy={n.y} r="11" fill="none" stroke={c} strokeOpacity="0.35">
                <animate attributeName="r" values="8;14;8" dur="1.8s" repeatCount="indefinite"/>
                <animate attributeName="stroke-opacity" values="0.4;0;0.4" dur="1.8s" repeatCount="indefinite"/>
              </circle>}
              <circle cx={n.x} cy={n.y} r={n.active ? 6 : 4.5}
                fill={n.active ? c : T.panel}
                stroke={c} strokeWidth={n.active ? 0 : 1}
                style={{ filter: n.active ? `drop-shadow(0 0 6px ${c})` : 'none' }} />
              <text x={n.x + 10} y={n.y + 3} fontFamily={T.mono} fontSize="10"
                fill={n.active ? T.text : T.textDim}>{n.label}</text>
            </g>
          );
        })}
      </svg>
      <div style={{
        position: 'absolute', left: 10, right: 10, bottom: 10,
        padding: '8px 10px', borderRadius: 6,
        background: T.panelHi, border: `0.5px solid ${T.panelEdge}`,
        fontFamily: T.mono, fontSize: 10, color: T.textDim,
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
          <span className="tau-dot" style={{ background: T.agent, boxShadow: `0 0 6px ${T.agent}`, animation: 'tauPulse 1.4s ease-in-out infinite' }} />
          <span style={{ color: T.text, fontWeight: 600 }}>claude-code</span>
        </div>
        <div style={{ color: T.textMute }}>src/chrome.jsx +18 −2</div>
        <div style={{ color: T.textMute }}>sonnet-4.5 · 142 tok/s</div>
      </div>
    </div>
  );

  // Vertical tab rail — 32px
  const TabRail = (
    <div style={{
      width: 36, background: T.bg,
      borderRight: `0.5px solid ${T.panelEdge}`,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '8px 0', gap: 4, flexShrink: 0,
    }}>
      {[
        { c: T.agent, l: 'CC', running: true },
        { c: T.cyan,  l: 'OC' },
        { c: T.cyan,  l: 'LZ' },
        { c: T.agent, l: 'CX' },
        { c: T.cyan,  l: 'ZS' },
      ].map((t, i) => (
        <div key={i} style={{
          width: 26, height: 26, borderRadius: 6,
          display: 'grid', placeItems: 'center',
          background: i === 0 ? T.panelHi : 'transparent',
          border: `0.5px solid ${i === 0 ? t.c : 'transparent'}`,
          boxShadow: i === 0 ? `0 0 10px ${t.c}55` : 'none',
          color: i === 0 ? t.c : T.textDim,
          fontFamily: T.mono, fontSize: 9.5, fontWeight: 700,
          position: 'relative', cursor: 'pointer',
        }}>
          {t.l}
          {t.running && <span style={{
            position: 'absolute', top: -2, right: -2, width: 6, height: 6,
            borderRadius: '50%', background: T.ok,
            boxShadow: `0 0 4px ${T.ok}`,
          }} />}
        </div>
      ))}
      <div style={{ width: 20, height: 0.5, background: T.panelEdge, margin: '4px 0' }} />
      <div style={{ width: 26, height: 26, borderRadius: 6, border: `1px dashed ${T.panelEdge}`, display:'grid', placeItems:'center', color: T.textMute, cursor: 'pointer', fontSize: 14 }}>+</div>
    </div>
  );

  const toolbar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: '100%' }}>
      <div style={{ display:'flex', alignItems:'center', gap: 6, fontSize: 11, fontFamily: T.mono }}>
        <span style={{ color: T.textDim }}>atlas</span>
        <span style={{ color: T.textFaint }}>·</span>
        <span style={{ color: T.text }}>8 nodes</span>
        <span style={{ color: T.textFaint }}>·</span>
        <span style={{ color: T.agent }}>2 running</span>
      </div>
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
        <CommandBar placeholder="Jump to node, query graph, e.g. 'running agents on crazyShell'" />
      </div>
      <div style={{ display:'flex', alignItems:'center', gap: 8, fontSize: 10.5, color: T.textMute }}>
        <span>⌘\ collapse</span>
        <span>⌘G graph</span>
      </div>
    </div>
  );

  return (
    <AppWindow title="τ-mux · atlas" toolbar={toolbar} width={1280} height={800}>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {Graph}
        {TabRail}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: T.bg, padding: 6, gap: 6 }}>
          <div style={{ flex: 1.2, minHeight: 0, display:'flex', gap: 6 }}>
            <Pane kind="agent" focused={focus==='top'}
              tabs={[{ label: 'claude-code', icon: Ico.agent, badge: '+18 −2', badgeColor: T.ok }]}
              actions={<div onMouseDown={()=>setFocus('top')} style={{ display:'flex', gap:4, color:T.textMute }}><IconBtn active>◱</IconBtn><IconBtn>×</IconBtn></div>}
            >
              <TerminalBody bg={T.void}><ClaudeCodeBody /></TerminalBody>
            </Pane>
            <Pane kind="human" focused={focus==='tr'}
              tabs={[{ label: 'lazygit', icon: Ico.git, badge: 'main', badgeColor: T.cyan }]}
              actions={<div onMouseDown={()=>setFocus('tr')} style={{ display:'flex', gap:4, color:T.textMute }}><IconBtn>×</IconBtn></div>}
              flex={0.9}
            >
              <TerminalBody bg={T.void}><LazygitBody /></TerminalBody>
            </Pane>
          </div>
          <div style={{ flex: 1, minHeight: 0, display:'flex', gap: 6 }}>
            <Pane kind="agent" focused={focus==='bot'}
              tabs={[{ label: 'opencode', icon: Ico.spark, badge: 'gemini-3.1', badgeColor: T.cyan }]}
              actions={<div onMouseDown={()=>setFocus('bot')} style={{ display:'flex', gap:4, color:T.textMute }}><IconBtn>×</IconBtn></div>}
            >
              <TerminalBody bg={T.void}><OpencodeBody /></TerminalBody>
            </Pane>
          </div>
        </div>
      </div>

      {/* Activity ticker — the atlas signature */}
      <div style={{
        height: 32, display: 'flex', alignItems: 'center', gap: 0,
        background: T.panel, borderTop: `0.5px solid ${T.panelEdge}`,
        fontFamily: T.mono, fontSize: 10.5, color: T.textDim,
        overflow: 'hidden', position: 'relative',
      }}>
        <div style={{
          padding: '0 14px', height: '100%', display: 'flex', alignItems: 'center', gap: 6,
          background: T.void, borderRight: `0.5px solid ${T.panelEdge}`,
          color: T.cyan, fontWeight: 700, letterSpacing: 1.5, fontSize: 10,
        }}>
          <TauLogo size={12} /> TICKER
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '0 16px', flex: 1, overflow: 'hidden' }}>
          <span><span style={{ color: T.agent }}>● claude-code</span> edit <span style={{ color: T.text }}>src/chrome.jsx</span> <span style={{ color: T.ok }}>+18 −2</span></span>
          <span style={{ color: T.textFaint }}>│</span>
          <span><span style={{ color: T.agent }}>● codex</span> review waiting on input</span>
          <span style={{ color: T.textFaint }}>│</span>
          <span><span style={{ color: T.cyan }}>● you</span> lazygit · staged 1 file</span>
          <span style={{ color: T.textFaint }}>│</span>
          <span><span style={{ color: T.ok }}>✓</span> opencode built in 4.2s</span>
        </div>
        <div style={{ padding: '0 14px', display: 'flex', gap: 10, color: T.textMute, borderLeft: `0.5px solid ${T.panelEdge}`, alignItems: 'center', height: '100%' }}>
          <StatusItem label="codex" value="86%" color={T.warn} meter={0.86} />
          <StatusItem label="week" value="13%" color={T.ok} meter={0.13} />
          <span style={{ color: T.text }}>$0.809</span>
        </div>
      </div>
    </AppWindow>
  );
}

window.VariantAtlas = VariantAtlas;
