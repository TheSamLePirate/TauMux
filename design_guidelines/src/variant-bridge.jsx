// Variant 1 · "Bridge"
// A respectful refinement of the current τ-mux layout.
// • Workspace sidebar retained but cleaner: typographic hierarchy, no dotted borders,
//   cyan dots for focus, amber dots for active agents.
// • Three panes, each with its own tab strip; focused pane gets a soft cyan halo.
// • Top bar adds a global command bar (⌘K) + workspace switcher.
// • Bottom status bar splits into zones: git · usage · quota — each with live meters.

const T = window.TAU;

function VariantBridge() {
  const [focus, setFocus] = React.useState('mid');
  const wsIdx = 0;

  const Sidebar = (
    <div style={{
      width: 240, background: T.bg,
      borderRight: `0.5px solid ${T.panelEdge}`,
      display: 'flex', flexDirection: 'column', flexShrink: 0, minHeight: 0,
    }}>
      <div style={{
        padding: '12px 12px 8px', display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: T.textDim, textTransform: 'uppercase' }}>Workspaces</div>
        <div style={{ flex: 1 }} />
        <IconBtn title="new"><span style={{ fontSize: 13 }}>+</span></IconBtn>
      </div>
      <div style={{ padding: '0 12px 10px', fontSize: 10.5, color: T.textMute }}>
        Navigation, context and live activity
      </div>
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }} className="tau-scrollbar">
        {WORKSPACES.map((w, i) => (
          <WorkspaceCard key={w.name} {...w} active={i === wsIdx} />
        ))}
      </div>
      <div style={{
        padding: '8px 12px', borderTop: `0.5px solid ${T.panelEdge}`,
        display: 'flex', alignItems: 'center', gap: 10, fontSize: 10.5, color: T.textMute,
      }}>
        <span className="tau-dot" style={{ background: T.cyan, boxShadow: `0 0 6px ${T.cyan}` }} />
        <span style={{ color: T.textDim }}>Telegram</span>
        <span style={{ color: T.textFaint }}>·</span>
        <span className="tau-dot" style={{ background: T.ok }} />
        <span style={{ color: T.textDim }}>Web Mirror</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: T.mono }}>:auth</span>
      </div>
    </div>
  );

  const toolbar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: '100%' }}>
      <CommandBar placeholder="⌕ lazygit · opencode · new agent · attach tmux…" />
      <div style={{ flex: 1 }} />
      <div style={{
        display: 'flex', alignItems: 'center', gap: 0,
        background: T.panelHi, border: `0.5px solid ${T.panelEdge}`, borderRadius: 6,
        padding: 2, height: 24,
      }}>
        {['Workspace 01', 'Workspace 02', 'Workspace 03'].map((w, i) => (
          <div key={w} style={{
            padding: '2px 10px', borderRadius: 4, fontSize: 10.5,
            background: i === 0 ? T.panel : 'transparent',
            color: i === 0 ? T.text : T.textMute,
            fontWeight: i === 0 ? 600 : 500,
            border: i === 0 ? `0.5px solid ${T.cyanDim}` : 'none',
          }}>{w}</div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: T.textDim, fontSize: 11 }}>
        <span style={{ color: T.textMute }}>5 workspaces</span>
        <span style={{ color: T.textFaint }}>·</span>
        <span style={{ color: T.textMute }}>3 panes</span>
      </div>
      <div style={{ display: 'flex', gap: 2 }}>
        <IconBtn title="split" active>{Ico.split}</IconBtn>
        <IconBtn title="grid">{Ico.grid}</IconBtn>
        <IconBtn title="new">{Ico.plus}</IconBtn>
      </div>
    </div>
  );

  return (
    <AppWindow title="τ-mux" toolbar={toolbar} width={1280} height={800}>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {Sidebar}
        {/* Panes area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: T.bg, padding: 6, gap: 6 }}>
          {/* top row — 2 panes */}
          <div style={{ flex: 1, display: 'flex', gap: 6, minHeight: 0 }}>
            {/* Pane A — lazygit */}
            <Pane
              kind="human"
              focused={focus === 'left'}
              tabs={[{ label: 'Claude Code', icon: <span className="tau-dot" style={{ background: T.agent }} /> , badge: 'lazygit', badgeColor: T.agent }]}
              actions={<div onMouseDown={() => setFocus('left')} style={{ display: 'flex', gap: 6, color: T.textMute }}>
                <span style={{ fontFamily: T.mono, fontSize: 10 }}>./DEV/crazyShell</span>
                <span style={{ color: T.textFaint }}>·</span>
                <span style={{ fontFamily: T.mono, fontSize: 10, color: T.cyan }}>main</span>
                <IconBtn>⌗</IconBtn><IconBtn>◱</IconBtn><IconBtn>×</IconBtn>
              </div>}
              flex={1.05}
            >
              <TerminalBody bg={T.void}><LazygitBody /></TerminalBody>
            </Pane>
            {/* Pane B — opencode */}
            <Pane
              kind="agent"
              focused={focus === 'mid'}
              tabs={[{ label: 'OpenCode', icon: <span className="tau-dot" style={{ background: T.cyan }} />, badge: 'opencode', badgeColor: T.cyan }]}
              actions={<div onMouseDown={() => setFocus('mid')} style={{ display: 'flex', gap: 6, color: T.textMute }}>
                <span style={{ fontFamily: T.mono, fontSize: 10 }}>./DEV/crazyShell</span>
                <span style={{ color: T.textFaint }}>·</span>
                <span style={{ fontFamily: T.mono, fontSize: 10, color: T.cyan }}>main</span>
                <IconBtn>⌗</IconBtn><IconBtn>◱</IconBtn><IconBtn>×</IconBtn>
              </div>}
              flex={1.3}
              footer={
                <StatusBar bg={T.panel}>
                  <span>~/Documents/DEV/crazyShell</span>
                  <span style={{ color: T.textFaint }}>·</span>
                  <span className="tau-dot" style={{ background: T.ok }} />
                  <span>1 MCP</span>
                  <span style={{ color: T.textFaint }}>·</span>
                  <span>/status</span>
                  <div style={{ flex: 1 }} />
                  <span style={{ color: T.textDim }}>1.14.19</span>
                </StatusBar>
              }
            >
              <TerminalBody bg={T.void}><OpencodeBody /></TerminalBody>
            </Pane>
          </div>
          {/* bottom row — wide τ-mux pane */}
          <Pane
            kind="human"
            focused={focus === 'bot'}
            tabs={[{ label: 'τ · tau-mux', icon: <TauLogo size={11} />, badge: './Logs/tau-mux', badgeColor: T.cyan }]}
            actions={<div onMouseDown={() => setFocus('bot')} style={{ display: 'flex', gap: 6, color: T.textMute }}>
              <IconBtn>⌗</IconBtn><IconBtn>◱</IconBtn><IconBtn>×</IconBtn>
            </div>}
            flex={0.55}
          >
            <TerminalBody bg={T.void}>
              <div style={{ padding: '10px 12px', fontFamily: T.mono, fontSize: 11.5, color: T.textDim, lineHeight: 1.6 }}>
                <div>[<span style={{color:T.ok}}>14:03:21</span>] <span style={{color:T.cyan}}>τ-mux</span> attached to session <span style={{color:T.text}}>crazyShell</span></div>
                <div>[<span style={{color:T.ok}}>14:03:22</span>] spawning pane <span style={{color:T.agent}}>claude-code</span> · model <span style={{color:T.text}}>sonnet-4.5</span></div>
                <div>[<span style={{color:T.ok}}>14:03:22</span>] spawning pane <span style={{color:T.agent}}>opencode</span> · model <span style={{color:T.text}}>gemini-3.1-pro</span></div>
                <div>[<span style={{color:T.ok}}>14:03:24</span>] sync <span style={{color:T.cyan}}>lazygit</span> ↔ worktree <span style={{color:T.text}}>.claude/worktrees/upbeat-solomon</span></div>
                <div>[<span style={{color:T.ok}}>14:05:11</span>] <span style={{color:T.agent}}>claude-code</span> edit +18 −2 <span style={{color:T.text}}>src/chrome.jsx</span></div>
                <div>[<span style={{color:T.ok}}>14:05:42</span>] diff summary propagated to <span style={{color:T.cyan}}>lazygit</span></div>
                <div style={{ marginTop: 8, display:'flex', gap:6, alignItems:'center' }}>
                  <span style={{color:T.cyan}}>❯</span><span className="tau-cursor" />
                </div>
              </div>
            </TerminalBody>
          </Pane>
        </div>
      </div>

      {/* Global status bar */}
      <StatusBar>
        <span style={{ color: T.cyan, fontWeight: 600 }}>Codex</span>
        <StatusItem value="5h 1m52s left" color={T.warn} meter={0.14} />
        <span style={{ color: T.textFaint }}>·</span>
        <StatusItem label="used" value="86.0%" color={T.warn} />
        <span style={{ color: T.textFaint }}>·</span>
        <StatusItem value="Week 6d 20h left" meter={0.87} color={T.ok} />
        <span style={{ color: T.textFaint }}>·</span>
        <StatusItem label="used" value="13%" color={T.ok} />
        <div style={{ flex: 1 }} />
        <span>$0.809 (sub) · 3.0%/272k (auto)</span>
        <span style={{ color: T.textFaint }}>·</span>
        <span style={{ color: T.agent }}>openai-codex</span>
        <span style={{ color: T.text }}>gpt-5.4</span>
        <span style={{ color: T.ok }}>· high</span>
      </StatusBar>
    </AppWindow>
  );
}

window.VariantBridge = VariantBridge;
