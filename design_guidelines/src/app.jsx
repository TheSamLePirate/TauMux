// App — mounts the design canvas with all three τ-mux variants as artboards.

const { useState, useEffect } = React;
const T = window.TAU;

function Intro() {
  return (
    <div style={{
      width: 1280, padding: '48px 56px',
      background: 'linear-gradient(180deg, #0a0e11 0%, #07090b 100%)',
      color: T.text, fontFamily: T.sans,
      border: `0.5px solid ${T.panelEdge}`, borderRadius: 12,
      display: 'flex', gap: 48, alignItems: 'center',
    }}>
      <div style={{ width: 180, height: 180, background: T.void, borderRadius: 28,
        display: 'grid', placeItems: 'center', flexShrink: 0,
        boxShadow: `0 0 60px ${T.cyanDim}, inset 0 0 0 0.5px ${T.panelEdge}` }}>
        <TauLogo size={110} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: T.cyan, textTransform: 'uppercase', marginBottom: 10 }}>
          τ-mux · macOS · revamp proposal
        </div>
        <h1 style={{ fontSize: 42, fontWeight: 700, margin: 0, letterSpacing: -1, lineHeight: 1.05 }}>
          A multiplexer where <span style={{ color: T.cyan }}>agents</span> and <span style={{ color: T.agent }}>humans</span>
          <br/>can actually share a room.
        </h1>
        <p style={{ fontSize: 15, lineHeight: 1.6, color: T.textDim, maxWidth: 720, marginTop: 18 }}>
          Three full-window directions — same content, different chrome. Every pane still hosts whatever
          TUI you run (lazygit, opencode, codex, zsh…); we only own the shell around it. Focus is signalled with
          a soft cyan halo, agent panes get an amber identity dot, and the top command bar is always a <span style={{ fontFamily: T.mono, color: T.text }}>⌘K</span> away.
        </p>
        <div style={{ display: 'flex', gap: 24, marginTop: 24 }}>
          {[
            { n: '01', t: 'Bridge', d: 'Refined current layout' },
            { n: '02', t: 'Cockpit', d: 'Icon rail + per-pane HUD' },
            { n: '03', t: 'Atlas',   d: 'Workspace graph + ticker' },
          ].map(v => (
            <div key={v.n} style={{
              padding: '14px 18px', borderRadius: 8,
              background: T.panel, border: `0.5px solid ${T.panelEdge}`,
              minWidth: 160,
            }}>
              <div style={{ fontFamily: T.mono, color: T.cyan, fontSize: 11, letterSpacing: 1 }}>{v.n}</div>
              <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>{v.t}</div>
              <div style={{ color: T.textMute, fontSize: 12, marginTop: 2 }}>{v.d}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <DesignCanvas>
      <DCSection id="intro" title="τ-mux revamp" subtitle="A macOS multiplexer for agents and humans — three proposals on one canvas">
        <DCArtboard id="intro" label="Brief" width={1280} height={280}>
          <Intro />
        </DCArtboard>
      </DCSection>

      <DCSection id="variants" title="Window variants" subtitle="Drag to reorder · click the ⤢ corner to focus any artboard">
        <DCArtboard id="bridge" label="01 · Bridge — refined current layout" width={1280} height={800}>
          <VariantBridge />
        </DCArtboard>
        <DCArtboard id="cockpit" label="02 · Cockpit — icon rail + per-pane HUD" width={1280} height={800}>
          <VariantCockpit />
        </DCArtboard>
        <DCArtboard id="atlas" label="03 · Atlas — workspace graph + activity ticker" width={1280} height={800}>
          <VariantAtlas />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
