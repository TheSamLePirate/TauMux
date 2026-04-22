// Mock TUI content snippets — terminal bodies that simulate lazygit, opencode, etc.
// Kept as stateless React components returning monospace text.

const T = window.TAU;

// ─── lazygit-ish panel ─────────────────────────────────────────────────────
function LazygitBody() {
  const c = {
    border: T.panelEdge,
    head: T.cyan,
    dim: T.textDim,
    mute: T.textMute,
    ok: T.ok,
    warn: T.warn,
  };
  const Row = ({ children, sel }) => (
    <div style={{
      background: sel ? 'rgba(111,233,255,0.10)' : 'transparent',
      color: sel ? T.text : T.text,
      padding: '0 6px',
    }}>{children}</div>
  );
  const Section = ({ n, title, open, children, count }) => (
    <div style={{ marginBottom: 4 }}>
      <div style={{
        color: T.cyan, fontWeight: 600,
        borderBottom: `1px solid ${T.panelEdge}`, padding: '2px 6px',
        display: 'flex', justifyContent: 'space-between',
      }}>
        <span>[{n}]─{title}</span>
        {count && <span style={{ color: T.textMute, fontWeight: 400 }}>{count}</span>}
      </div>
      {open && <div style={{ padding: '2px 0' }}>{children}</div>}
    </div>
  );
  return (
    <div style={{ padding: '6px 4px', lineHeight: 1.5 }}>
      <Section n="1" title="Status" />
      <Section n="2" title="Files · Worktrees · Submodules" open count="1 of 7">
        <Row sel>  /</Row>
        <Row>  ▾ .claude/worktrees</Row>
        <Row>    ?? upbeat-solomon-0da785</Row>
        <Row>  ▾ .superest</Row>
        <Row>    ?? config.json</Row>
        <Row>  ▾ code_reviews</Row>
        <Row>    ?? 2026-04-18T17-27-44.0322__f24debadd02b.md</Row>
      </Section>
      <Section n="3" title="Local branches · Remotes · Tags" count="1 of 11" />
      <Section n="4" title="Commits · Reflog" count="0 of 163" />
      <Section n="5" title="Stash" count="0 of 0" />
      <Section n="0" title="Unstaged changes" />
      <div style={{ borderTop: `1px solid ${T.panelEdge}`, marginTop: 8, padding: '6px 6px' }}>
        <div style={{ color: T.cyan, fontWeight: 600 }}>─Command log─</div>
        <div style={{ color: T.textDim }}>You can hide/focus this panel by pressing '@'</div>
        <div style={{ color: T.warn, marginTop: 4 }}>Random tip: Always read through the diff of your changes before assigning somebody</div>
        <div style={{ color: T.warn }}>to review your code. Better for you to catch any silly mistakes than your</div>
        <div style={{ color: T.warn }}>colleagues!</div>
      </div>
    </div>
  );
}

// ─── opencode-ish greeter ──────────────────────────────────────────────────
function OpencodeBody() {
  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
      padding: 20, gap: 16,
    }}>
      <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontFamily: T.mono, fontSize: 62, fontWeight: 800, letterSpacing: -2,
            color: '#5a6c72', lineHeight: 1,
          }}>open<span style={{ color: T.text }}>code</span></div>
        </div>
      </div>
      <div style={{
        border: `1px solid ${T.panelEdge}`, borderRadius: 4,
        padding: '10px 12px', background: T.panelHi,
      }}>
        <div style={{ color: T.textDim, fontFamily: T.mono, fontSize: 11.5 }}>
          <span style={{ color: T.cyan }}>▍</span> Ask anything… "Fix a TODO in this codebase"
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 10, fontSize: 10.5, fontFamily: T.mono, color: T.textMute }}>
          <span><span style={{ color: T.text }}>Build</span></span>
          <span style={{ color: T.textFaint }}>◆</span>
          <span>Gemini 3.1 Pro Preview (Google)</span>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, fontFamily: T.mono, fontSize: 10.5, color: T.textMute }}>
        <span><span style={{ color: T.text }}>tab</span> agents</span>
        <span><span style={{ color: T.text }}>ctrl+p</span> commands</span>
      </div>
      <div style={{ fontFamily: T.mono, fontSize: 10.5, color: T.textDim, textAlign: 'center' }}>
        <span style={{ color: T.ok }}>●</span> Tip: Toggle username display in chat via command palette <span style={{ color: T.text }}>(Ctrl+P)</span>
      </div>
    </div>
  );
}

// ─── codex-ish input prompt ────────────────────────────────────────────────
function CodexPromptBody() {
  return (
    <div style={{ padding: 12, fontFamily: T.mono, fontSize: 11.5, color: T.text, lineHeight: 1.6 }}>
      <div style={{ color: T.textDim }}>▌ <span style={{ color: T.text }}>refactor the pane focus logic to derive focus from active session id instead of local state</span></div>
      <div style={{ marginTop: 10, color: T.cyan }}>● codex</div>
      <div style={{ color: T.textDim }}>  → analyzing src/chrome.jsx, src/variant-bridge.jsx</div>
      <div style={{ color: T.textDim }}>  → proposing patch <span style={{ color: T.ok }}>+34 −18</span> across 3 files</div>
      <div style={{ color: T.warn, marginTop: 6 }}>  ? apply? [y/n/r(eview)]</div>
      <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: T.cyan }}>❯</span>
        <span className="tau-cursor" />
      </div>
    </div>
  );
}

// ─── A simple editor / diff-ish pane ───────────────────────────────────────
function DiffBody() {
  const L = ({ n, add, del, children }) => (
    <div style={{
      display: 'flex', alignItems: 'flex-start',
      background: add ? 'rgba(140,233,154,0.07)' : del ? 'rgba(255,138,138,0.07)' : 'transparent',
    }}>
      <span style={{ color: T.textFaint, width: 32, textAlign: 'right', paddingRight: 10, flexShrink: 0 }}>{n}</span>
      <span style={{ color: add ? T.ok : del ? T.err : T.textDim, width: 12, flexShrink: 0 }}>{add ? '+' : del ? '−' : ' '}</span>
      <span style={{ color: add || del ? T.text : T.textDim, flex: 1 }}>{children}</span>
    </div>
  );
  return (
    <div style={{ padding: '8px 0', fontFamily: T.mono, fontSize: 11, lineHeight: 1.55 }}>
      <div style={{ color: T.cyan, padding: '0 10px', marginBottom: 6 }}>@@ src/chrome.jsx @@</div>
      <L n="101"> function Pane(props) {'{'}</L>
      <L n="102" del>  const [focused, setFocused] = useState(false);</L>
      <L n="103" add>  const focused = props.sessionId === active;</L>
      <L n="104"> </L>
      <L n="105">  return (</L>
      <L n="106">    &lt;div style={'{'} border: focused ? cyan : edge {'}'}&gt;</L>
      <L n="107">      {'{'}props.children{'}'}</L>
      <L n="108">    &lt;/div&gt;</L>
      <L n="109">  );</L>
      <L n="110"> {'}'}</L>
      <div style={{ color: T.cyan, padding: '0 10px', margin: '10px 0 6px' }}>@@ src/variant-bridge.jsx @@</div>
      <L n="42" del>  focusPane(id);</L>
      <L n="43" add>  setActive(id);</L>
      <L n="44" add>  postMessage({'{'} type: 'focus', id {'}'});</L>
    </div>
  );
}

// ─── Claude Code-ish conversation ──────────────────────────────────────────
function ClaudeCodeBody() {
  return (
    <div style={{ padding: 12, fontFamily: T.mono, fontSize: 11.5, lineHeight: 1.6 }}>
      <div style={{ color: T.agent, fontWeight: 600 }}>● claude-code <span style={{ color: T.textMute, fontWeight: 400 }}>sonnet-4.5 · 184k ctx</span></div>
      <div style={{ color: T.textDim, marginTop: 4 }}>  I'll add pane activity indicators. Let me read the current chrome file first.</div>
      <div style={{ color: T.textMute, marginTop: 8 }}>  ⎿ Read src/chrome.jsx <span style={{ color: T.ok }}>(312 lines)</span></div>
      <div style={{ color: T.textMute }}>  ⎿ Edit src/chrome.jsx <span style={{ color: T.ok }}>+18 −2</span></div>
      <div style={{ color: T.textDim, marginTop: 8 }}>  Added <span style={{ color: T.cyan }}>activity</span> prop on <span style={{ color: T.cyan }}>Pane</span>: renders a pulsing dot</div>
      <div style={{ color: T.textDim }}>  next to the title when a tool call is in-flight.</div>
      <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: T.textMute }}>❯</span>
        <span style={{ color: T.textDim }}>now wire it to the bridge variant</span>
        <span className="tau-cursor" />
      </div>
    </div>
  );
}

// ─── Generic zsh prompt ────────────────────────────────────────────────────
function ZshBody({ lines }) {
  const defaults = [
    { t: 'ls -1 src', color: T.text, prompt: true },
    { t: 'app.jsx', color: T.textDim },
    { t: 'chrome.jsx', color: T.textDim },
    { t: 'mock-data.jsx', color: T.textDim },
    { t: 'tokens.jsx', color: T.textDim },
    { t: 'variant-atlas.jsx', color: T.textDim },
    { t: 'variant-bridge.jsx', color: T.textDim },
    { t: 'variant-cockpit.jsx', color: T.textDim },
    { t: 'git status -sb', color: T.text, prompt: true },
    { t: '## main...origin/main [ahead 2]', color: T.textDim },
    { t: ' M src/chrome.jsx', color: T.warn },
    { t: '?? src/tokens.jsx', color: T.err },
    { t: '', cursor: true, prompt: true },
  ];
  const ls = lines || defaults;
  return (
    <div style={{ padding: '10px 12px', fontFamily: T.mono, fontSize: 11.5, lineHeight: 1.55 }}>
      {ls.map((l, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, color: l.color || T.textDim }}>
          {l.prompt && <span style={{ color: T.cyan }}>❯</span>}
          <span>{l.t}</span>
          {l.cursor && <span className="tau-cursor" />}
        </div>
      ))}
    </div>
  );
}

// Data for sidebar workspaces
const WORKSPACES = [
  { name: 'τ-mux', kind: 'mixed', active: true, branch: 'module', dir: 'tau-mux v0.1.2',
    sessions: [
      { name: 'claude-code', kind: 'agent', running: true, active: true },
      { name: 'lazygit', kind: 'human' },
      { name: 'zsh', kind: 'human' },
    ] },
  { name: 'Telegram', kind: 'agent', branch: null,
    sessions: [{ name: 'codex', kind: 'agent', idle: true }] },
  { name: 'MultiTau', kind: 'mixed',
    sessions: [
      { name: 'claude-code', kind: 'agent' },
      { name: 'zsh', kind: 'human' },
    ] },
  { name: 'rataPI', kind: 'mixed', branch: 'edition 2026',
    sessions: [
      { name: 'claude-code', kind: 'agent', running: true },
      { name: 'zsh', kind: 'human' },
    ], dir: '~/rataPi/rata-pi' },
  { name: 't3code', kind: 'human', branch: 'main',
    sessions: [
      { name: 'Merge to main', kind: 'human' },
      { name: 'zsh', kind: 'human' },
    ] },
];

Object.assign(window, {
  LazygitBody, OpencodeBody, CodexPromptBody, DiffBody, ClaudeCodeBody, ZshBody,
  WORKSPACES,
});
