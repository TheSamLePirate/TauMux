// Variant 2 · "Cockpit"
// Radical collapse of the sidebar into an icon rail + workspace switcher.
// Prominent command bar; each pane has a heads-up "HUD" strip showing agent
// state, tokens/sec, and diff count. Works well on smaller screens.

const T = window.TAU;

function VariantCockpit() {
  const [focus, setFocus] = React.useState('mid');

  const IconRail = (
    <div style={{
      width: 52, background: T.void,
      borderRight: `0.5px solid ${T.panelEdge}`,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '10px 0', gap: 4, flexShrink: 0,
    }}>
      <div style={{ marginBottom: 6 }}><TauLogo size={22} /></div>
      <div style={{ width: 28, height: 1, background: T.panelEdge, margin: '2px 0 4px' }} />
      {WORKSPACES.map((w, i) => (
        <div key={w.name} title={w.name} style={{
          width: 36, height: 36, borderRadius: 8,
          display: 'grid', placeItems: 'center',
          background: i === 0 ? T.panelHi : 'transparent',
          border: `0.5px solid ${i === 0 ? T.cyanDim : 'transparent'}`,
          position: 'relative', cursor: 'pointer',
          color: i === 0 ? T.text : T.textDim,
          fontFamily: T.mono, fontSize: 12.5, fontWeight: 700,
        }}>
          {w.name[0].toUpperCase() === 'Τ' || w.name.startsWith('τ') ? <TauLogo size={14} /> : w.name[0].toUpperCase()}
          {w.sessions.some(s => s.running) && (
            <span style={{
              position: 'absolute', top: 4, right: 4,
              width: 6, height: 6, borderRadius: '50%',
              background: T.agent, boxShadow: `0 0 6px ${T.agent}`,
              animation: 'tauPulse 1.4s ease-in-out infinite',
            }} />
          )}
        </div>
      ))}
      <div style={{ flex: 1 }} />
      <div style={{ width: 36, height: 36, borderRadius: 8, border: `1px dashed ${T.panelEdge}`, display: 'grid', placeItems: 'center', color: T.textMute, cursor: 'pointer' }}>+</div>
    </div>
  );

  const HUD = ({ kind, model, tokens, cost, diff, state }) => {
    const c = kind === 'agent' ? T.agent : T.cyan;
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '0 10px', height: 22,
        borderBottom: `0.5px solid ${T.panelEdgeSoft}`,
        background: T.panel, fontFamily: T.mono, fontSize: 10.5,
      }}>
        <span style={{ color: c, fontWeight: 700 }}>{kind === 'agent' ? 'AGENT' : 'HUMAN'}</span>
        {model && <><span style={{ color: T.textFaint }}>·</span><span style={{ color: T.text }}>{model}</span></>}
        {state && <><span style={{ color: T.textFaint }}>·</span>
          <span style={{ color: state === 'running' ? T.ok : state === 'waiting' ? T.warn : T.textDim, display:'flex', alignItems:'center', gap:4 }}>
            <span className="tau-dot" style={{ background: 'currentColor', animation: state==='running' ? 'tauPulse 1.4s ease-in-out infinite' : 'none' }} />
            {state}
          </span>
        </>}
        <div style={{ flex: 1 }} />
        {tokens != null && <span style={{ color: T.textDim }}>{tokens}<span style={{ color: T.textMute }}> tok/s</span></span>}
        {cost && <span style={{ color: T.textDim }}>${cost}</span>}
        {diff != null && <span style={{ color: T.textDim }}>Δ <span style={{ color: T.ok }}>+{diff.add}</span> <span style={{ color: T.err }}>−{diff.del}</span></span>}
      </div>
    );
  };

  const toolbar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: '100%' }}>
      <div style={{ display:'flex', alignItems:'center', gap: 6, fontSize: 11, fontFamily: T.mono, color: T.textDim }}>
        <span style={{ color: T.cyan }}>τ-mux</span>
        <span style={{ color: T.textFaint }}>/</span>
        <span>crazyShell</span>
        <span style={{ color: T.textFaint }}>/</span>
        <span style={{ color: T.text }}>Workspace 01</span>
      </div>
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
        <CommandBar placeholder='Type ":" to route · "@" to mention agent · "/" commands' />
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <IconBtn title="search">⌕</IconBtn>
        <IconBtn title="bell">◉</IconBtn>
        <IconBtn title="settings">⚙</IconBtn>
      </div>
    </div>
  );

  return (
    <AppWindow title="τ-mux · cockpit" toolbar={toolbar} width={1280} height={800}>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {IconRail}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: T.bg, padding: 8, gap: 8 }}>
          <div style={{ flex: 1, display: 'flex', gap: 8, minHeight: 0 }}>
            <Pane kind="human" focused={focus==='left'}
              tabs={[{ label: 'lazygit', icon: Ico.git, badge: 'main', badgeColor: T.cyan }]}
              actions={<div onMouseDown={() => setFocus('left')} style={{ display: 'flex', gap: 4, color: T.textMute }}>
                <IconBtn>⌗</IconBtn><IconBtn>×</IconBtn>
              </div>}
              flex={1}
            >
              <HUD kind="human" state="idle" model="zsh · git 2.43" />
              <TerminalBody bg={T.void}><LazygitBody /></TerminalBody>
            </Pane>
            <Pane kind="agent" focused={focus==='mid'}
              tabs={[
                { label: 'claude-code', icon: Ico.agent, badge: 'editing', badgeColor: T.agent, badgeBg: T.agentDim },
                { label: 'codex', icon: Ico.agent },
              ]}
              actions={<div onMouseDown={() => setFocus('mid')} style={{ display: 'flex', gap: 4, color: T.textMute }}>
                <IconBtn>⌗</IconBtn><IconBtn active>◱</IconBtn><IconBtn>×</IconBtn>
              </div>}
              flex={1.4}
            >
              <HUD kind="agent" model="sonnet-4.5" tokens="142" cost="0.81" diff={{ add: 34, del: 18 }} state="running" />
              <TerminalBody bg={T.void}><DiffBody /></TerminalBody>
            </Pane>
          </div>
          <div style={{ flex: 0.55, display: 'flex', gap: 8, minHeight: 0 }}>
            <Pane kind="agent" focused={focus==='bl'}
              tabs={[{ label: 'opencode', icon: Ico.spark, badge: 'gemini-3.1', badgeColor: T.cyan }]}
              actions={<div onMouseDown={() => setFocus('bl')} style={{ display: 'flex', gap: 4, color: T.textMute }}>
                <IconBtn>⌗</IconBtn><IconBtn>×</IconBtn>
              </div>}
              flex={1}
            >
              <HUD kind="agent" model="gemini-3.1-pro" state="waiting" tokens="—" cost="0.00" />
              <TerminalBody bg={T.void}><CodexPromptBody /></TerminalBody>
            </Pane>
            <Pane kind="human" focused={focus==='br'}
              tabs={[{ label: 'τ · tau-mux logs', icon: <TauLogo size={10} />, badge: 'tail -f', badgeColor: T.cyan }]}
              actions={<div onMouseDown={() => setFocus('br')} style={{ display: 'flex', gap: 4, color: T.textMute }}>
                <IconBtn>⌗</IconBtn><IconBtn>×</IconBtn>
              </div>}
              flex={1}
            >
              <HUD kind="human" state="streaming" model="tau-mux 0.1.2" />
              <TerminalBody bg={T.void}><ZshBody /></TerminalBody>
            </Pane>
          </div>
        </div>
      </div>

      <StatusBar>
        <span style={{ color: T.cyan, fontWeight: 700 }}>τ</span>
        <span>4 panes</span>
        <span style={{ color: T.textFaint }}>·</span>
        <span>2 agents</span>
        <span className="tau-dot" style={{ background: T.agent, boxShadow: `0 0 6px ${T.agent}`, animation: 'tauPulse 1.4s ease-in-out infinite' }} />
        <span style={{ color: T.textFaint }}>·</span>
        <StatusItem label="codex" value="86%" color={T.warn} meter={0.86} />
        <StatusItem label="week" value="13%" color={T.ok} meter={0.13} />
        <div style={{ flex: 1 }} />
        <span>⌘K palette</span>
        <span style={{ color: T.textFaint }}>·</span>
        <span>⌘⇧P agents</span>
        <span style={{ color: T.textFaint }}>·</span>
        <span style={{ color: T.text }}>$0.809 today</span>
      </StatusBar>
    </AppWindow>
  );
}

window.VariantCockpit = VariantCockpit;
