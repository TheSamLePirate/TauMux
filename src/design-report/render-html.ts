/**
 * Renders the standalone HTML report. Pure — takes shots + summary,
 * returns a string. All assets reference relative paths (callers copy
 * them under the report root), all data is inlined via base64 so the
 * report works from file://.
 */
import type { ReportShot, ReportSummary } from "./types";

export function renderHtml(
  shots: ReportShot[],
  summary: ReportSummary,
): string {
  const payload = JSON.stringify({ shots, summary });
  const b64 = Buffer.from(payload, "utf8").toString("base64");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HyperTerm design report</title>
<style>
  :root {
    --bg: #0f1114;
    --bg-card: #181b21;
    --bg-elev: #21252d;
    --fg: #e7e9ee;
    --fg-muted: #8b92a0;
    --fg-dim: #5b6472;
    --accent: #6aa3ff;
    --ok: #5cc37d;
    --warn: #e5c172;
    --err: #e8706f;
    --new: #9a7cd4;
    --border: #272a33;
    --radius: 10px;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter",
      system-ui, sans-serif;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); }
  body.light {
    --bg: #f7f8fa; --bg-card: #ffffff; --bg-elev: #eef0f4;
    --fg: #18191d; --fg-muted: #5c6472; --fg-dim: #8a92a0;
    --border: #dee1e6;
  }
  header {
    position: sticky; top: 0; z-index: 10;
    background: var(--bg-card); border-bottom: 1px solid var(--border);
    padding: 14px 22px; display: flex; flex-wrap: wrap; align-items: center; gap: 14px;
  }
  h1 { font-size: 15px; margin: 0; font-weight: 600; letter-spacing: 0.3px; }
  h1 small { color: var(--fg-muted); font-weight: 400; margin-left: 8px; }
  .gate-banner {
    padding: 10px 22px; font-size: 12px; font-weight: 600;
    letter-spacing: 0.05em; text-transform: uppercase;
  }
  .gate-banner.pass { background: rgba(92,195,125,0.14); color: var(--ok); }
  .gate-banner.fail { background: rgba(232,112,111,0.18); color: var(--err); }
  .gate-banner.off  { background: var(--bg-elev); color: var(--fg-muted); }
  .summary { color: var(--fg-muted); font-size: 12px; display: flex; gap: 10px; flex-wrap: wrap; }
  .summary b { color: var(--fg); font-weight: 500; }
  .toolbar { margin-left: auto; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .toolbar input, .toolbar select, .toolbar button {
    background: var(--bg-elev); color: var(--fg); border: 1px solid var(--border);
    border-radius: 6px; padding: 6px 10px; font-size: 12px; font-family: inherit;
  }
  .toolbar input { min-width: 220px; }
  .toolbar button { cursor: pointer; }
  .toolbar button:hover { border-color: var(--accent); }
  .toolbar label { font-size: 12px; color: var(--fg-muted); display: flex; align-items: center; gap: 6px; }

  main { padding: 22px; max-width: 1600px; margin: 0 auto; }
  .group-title {
    font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em;
    color: var(--fg-muted); margin: 28px 0 10px 2px; font-weight: 600;
  }
  .group-title:first-child { margin-top: 0; }
  .grid {
    display: grid; gap: 16px;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  }
  .card {
    background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius);
    overflow: hidden; cursor: pointer; transition: transform 120ms, border-color 120ms;
    display: flex; flex-direction: column;
  }
  .card:hover { transform: translateY(-1px); border-color: var(--accent); }
  .thumb {
    background: #05070a; aspect-ratio: 16 / 10; width: 100%;
    display: flex; align-items: center; justify-content: center;
    border-bottom: 1px solid var(--border); overflow: hidden;
  }
  body.light .thumb { background: #e5e7eb; }
  .thumb img { width: 100%; height: 100%; object-fit: contain; }
  .thumb .missing { color: var(--fg-dim); font-size: 12px; }
  .card-body { padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .card-title { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card-sub { font-size: 11px; color: var(--fg-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .badges { display: flex; gap: 6px; margin-top: 2px; flex-wrap: wrap; }
  .badge {
    font-size: 10px; padding: 2px 7px; border-radius: 10px;
    text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;
    background: var(--bg-elev); color: var(--fg-muted);
  }
  .badge.suite-web { background: rgba(106,163,255,0.14); color: var(--accent); }
  .badge.suite-native { background: rgba(154,124,212,0.14); color: var(--new); }
  .badge.status-ok { background: rgba(92,195,125,0.14); color: var(--ok); }
  .badge.status-over { background: rgba(232,112,111,0.16); color: var(--err); }
  .badge.status-new { background: rgba(154,124,212,0.16); color: var(--new); }
  .badge.status-missing,
  .badge.status-dim-mismatch,
  .badge.status-baseline-only,
  .badge.status-corrupt { background: rgba(232,112,111,0.16); color: var(--err); }

  .overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.78); z-index: 100;
    display: none; align-items: stretch; justify-content: center; overflow-y: auto;
  }
  .overlay.open { display: flex; }
  .detail {
    background: var(--bg); color: var(--fg); width: 100%; max-width: 1400px;
    margin: 24px; border-radius: var(--radius); border: 1px solid var(--border);
    display: flex; flex-direction: column;
  }
  .detail-head {
    padding: 14px 22px; border-bottom: 1px solid var(--border);
    display: flex; align-items: center; gap: 12px;
  }
  .detail-head h2 { margin: 0; font-size: 15px; font-weight: 600; }
  .detail-head .sub { color: var(--fg-muted); font-size: 12px; }
  .detail-head button {
    margin-left: auto; background: var(--bg-elev); color: var(--fg);
    border: 1px solid var(--border); border-radius: 6px;
    padding: 6px 12px; cursor: pointer; font-size: 12px;
  }
  .detail-body { padding: 18px 22px; display: flex; flex-direction: column; gap: 18px; }
  .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border); }
  .tabs button {
    background: transparent; color: var(--fg-muted); border: 0;
    padding: 10px 14px; cursor: pointer; font-family: inherit; font-size: 12px;
    border-bottom: 2px solid transparent;
  }
  .tabs button.active { color: var(--fg); border-bottom-color: var(--accent); }
  .tab-panel { display: none; }
  .tab-panel.active { display: block; }
  .image-host {
    background: #05070a; border-radius: 8px; padding: 8px;
    display: flex; justify-content: center; align-items: center;
    min-height: 220px;
  }
  body.light .image-host { background: #e5e7eb; }
  .image-host img { max-width: 100%; max-height: 70vh; }
  details { background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; }
  details[open] summary { margin-bottom: 8px; }
  summary { font-size: 12px; cursor: pointer; color: var(--fg-muted); font-weight: 500; }
  pre { background: var(--bg-elev); color: var(--fg); padding: 10px 12px; border-radius: 8px; overflow: auto; font-size: 11px; line-height: 1.45; font-family: "JetBrains Mono", "SF Mono", Menlo, monospace; margin: 0; }
  pre.term {
    background: #05070a;
    color: #d6d9e0;
    max-height: 360px;
    white-space: pre-wrap;
    word-break: break-word;
    border: 1px solid var(--border);
    font-size: 12px;
    line-height: 1.5;
  }
  body.light pre.term { background: #1a1c20; color: #e7e9ee; }
  table.anno { border-collapse: collapse; width: 100%; font-size: 11px; }
  table.anno th, table.anno td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
  table.anno th { color: var(--fg-muted); font-weight: 500; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
  table.anno td.mono { font-family: "JetBrains Mono", monospace; }
  table.anno .swatch { display: inline-block; width: 12px; height: 12px; border-radius: 2px; vertical-align: middle; margin-right: 6px; border: 1px solid var(--border); }
  .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px 20px; font-size: 12px; color: var(--fg-muted); }
  .meta-grid b { color: var(--fg); font-weight: 500; }
  .hide { display: none !important; }

  @media (max-width: 720px) {
    header { padding: 10px 14px; }
    .toolbar { width: 100%; margin-left: 0; }
    .toolbar input { flex: 1; min-width: 0; }
    main { padding: 14px; }
    .detail { margin: 0; border-radius: 0; }
  }
</style>
</head>
<body>
<div id="gate-banner" class="gate-banner off"></div>
<header>
  <h1>HyperTerm design report <small id="summary-line"></small></h1>
  <div class="toolbar">
    <input id="q" type="search" placeholder="Filter (spec, test, step, state…)">
    <select id="suite">
      <option value="">All suites</option>
      <option value="web">Web mirror</option>
      <option value="native">Native</option>
    </select>
    <select id="status">
      <option value="">All statuses</option>
      <option value="over">Over threshold</option>
      <option value="new">New (no baseline)</option>
      <option value="ok">Within threshold</option>
      <option value="missing">Missing image</option>
      <option value="dim-mismatch">Dimension mismatch</option>
      <option value="baseline-only">Baseline-only (deleted)</option>
      <option value="corrupt">Corrupt PNG</option>
    </select>
    <label><input type="checkbox" id="fails-only"> Only failures</label>
    <button id="toggle-theme">Light</button>
  </div>
</header>
<main id="root"></main>

<div id="overlay" class="overlay" role="dialog" aria-modal="true">
  <div class="detail" id="detail"></div>
</div>

<script>
(function(){
  const payload = JSON.parse(atob(${JSON.stringify(b64)}));
  const shots = payload.shots;
  const summary = payload.summary;
  const FAIL_STATUSES = new Set(["over","dim-mismatch","missing","baseline-only","corrupt"]);

  const root = document.getElementById("root");
  const overlay = document.getElementById("overlay");
  const detail = document.getElementById("detail");
  const qEl = document.getElementById("q");
  const suiteEl = document.getElementById("suite");
  const statusEl = document.getElementById("status");
  const failsEl = document.getElementById("fails-only");
  const summaryEl = document.getElementById("summary-line");
  const themeBtn = document.getElementById("toggle-theme");
  const banner = document.getElementById("gate-banner");

  if (summary.gate && summary.gate.enabled) {
    if (summary.gate.failed) {
      banner.className = "gate-banner fail";
      banner.textContent = "Gate: FAIL — " + summary.gate.failingStatuses.join(", ");
    } else {
      banner.className = "gate-banner pass";
      banner.textContent = "Gate: pass";
    }
  } else {
    banner.className = "gate-banner off";
    banner.textContent = "Gate: advisory (run with --gate to enforce)";
  }

  summaryEl.innerHTML = "· " + shots.length + " shots · " +
    "<b>" + summary.overCount + "</b> over (> " + (summary.failThreshold * 100).toFixed(2) + "%) · " +
    "<b>" + summary.newCount + "</b> new · " +
    "<b>" + summary.missingCount + "</b> missing · " +
    "<b>" + (summary.baselineOnlyCount || 0) + "</b> baseline-only · " +
    "<b>" + (summary.corruptCount || 0) + "</b> corrupt · " +
    "generated " + new Date(summary.generatedAt).toLocaleString();

  themeBtn.addEventListener("click", () => {
    document.body.classList.toggle("light");
    themeBtn.textContent = document.body.classList.contains("light") ? "Dark" : "Light";
  });

  function matches(shot, q, suite, status, failsOnly) {
    if (suite && shot.suite !== suite) return false;
    if (status && shot.status !== status) return false;
    if (failsOnly && !FAIL_STATUSES.has(shot.status)) return false;
    if (!q) return true;
    const hay = [
      shot.spec, shot.test, shot.step, shot.suite,
      JSON.stringify(shot.state),
      (shot.annotations || []).map(a => a.selector).join(" "),
    ].join(" ").toLowerCase();
    return hay.includes(q.toLowerCase());
  }

  function statusBadge(status, frac) {
    const label = status === "ok"
      ? ((frac * 100).toFixed(2) + "% diff")
      : status === "over"
      ? ("diff " + (frac * 100).toFixed(2) + "% ⚠")
      : status === "dim-mismatch"
      ? "dimension mismatch"
      : status === "missing"
      ? "missing"
      : status === "baseline-only"
      ? "baseline-only"
      : status === "corrupt"
      ? "corrupt png"
      : "new";
    return '<span class="badge status-' + status + '">' + label + '</span>';
  }

  function render() {
    const q = qEl.value.trim();
    const suite = suiteEl.value;
    const status = statusEl.value;
    const failsOnly = failsEl.checked;
    const filtered = shots.filter(s => matches(s, q, suite, status, failsOnly));

    const groups = new Map();
    for (const s of filtered) {
      const key = s.suite + " · " + s.spec;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    }
    const html = [];
    if (filtered.length === 0) {
      html.push('<p style="color:var(--fg-muted)">No shots match the current filter.</p>');
    }
    for (const [title, list] of groups) {
      html.push('<div class="group-title">' + title + ' <span style="color:var(--fg-dim)">· ' + list.length + '</span></div>');
      html.push('<div class="grid">');
      for (const s of list) {
        const thumb = s.shotRel
          ? '<img src="' + s.shotRel + '" alt="" loading="lazy">'
          : (s.baselineRel
            ? '<img src="' + s.baselineRel + '" alt="" loading="lazy" style="opacity:0.5">'
            : '<span class="missing">no image</span>');
        html.push(
          '<div class="card" data-id="' + s.id + '">' +
            '<div class="thumb">' + thumb + '</div>' +
            '<div class="card-body">' +
              '<div class="card-title">' + escapeHtml(s.test) + '</div>' +
              '<div class="card-sub">' + escapeHtml(s.step) + ' · ' + s.width + '×' + s.height + '</div>' +
              '<div class="badges">' +
                '<span class="badge suite-' + s.suite + '">' + s.suite + '</span>' +
                statusBadge(s.status, s.diffFraction || 0) +
              '</div>' +
            '</div>' +
          '</div>'
        );
      }
      html.push('</div>');
    }
    root.innerHTML = html.join("");

    for (const card of root.querySelectorAll(".card")) {
      card.addEventListener("click", () => {
        const shot = shots.find(x => x.id === card.dataset.id);
        if (shot) openDetail(shot);
      });
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function openDetail(s) {
    const imgs = [];
    if (s.shotRel) imgs.push({ key: "current", label: "Current", src: s.shotRel });
    if (s.baselineRel) imgs.push({ key: "baseline", label: "Baseline", src: s.baselineRel });
    if (s.diffRel) imgs.push({ key: "diff", label: "Diff", src: s.diffRel });

    const tabButtons = imgs.map((i, idx) =>
      '<button data-tab="' + i.key + '"' + (idx === 0 ? ' class="active"' : '') + '>' + i.label + '</button>'
    ).join("");
    const tabPanels = imgs.map((i, idx) =>
      '<div class="tab-panel' + (idx === 0 ? ' active' : '') + '" data-tab="' + i.key + '">' +
        '<div class="image-host"><img src="' + i.src + '" alt=""></div>' +
      '</div>'
    ).join("");

    const annoRows = (s.annotations || []).map(a => {
      if (!a.found) {
        return '<tr><td class="mono">' + escapeHtml(a.selector) + '</td><td colspan="5" style="color:var(--fg-dim)">not found</td></tr>';
      }
      const r = a.rect || {x:0,y:0,width:0,height:0};
      const st = a.style || {};
      const color = st.color || "";
      const bg = st.backgroundColor || "";
      return '<tr>' +
        '<td class="mono">' + escapeHtml(a.selector) + '</td>' +
        '<td class="mono">' + Math.round(r.x) + ',' + Math.round(r.y) + ' ' + Math.round(r.width) + '×' + Math.round(r.height) + '</td>' +
        '<td class="mono"><span class="swatch" style="background:' + escapeHtml(color) + '"></span>' + escapeHtml(color) + '</td>' +
        '<td class="mono"><span class="swatch" style="background:' + escapeHtml(bg) + '"></span>' + escapeHtml(bg) + '</td>' +
        '<td class="mono">' + escapeHtml((st.fontFamily || "").split(",")[0]) + ' ' + escapeHtml(st.fontSize || "") + ' / ' + escapeHtml(st.fontWeight || "") + '</td>' +
        '<td class="mono">pad ' + escapeHtml(st.padding || "") + ' · radius ' + escapeHtml(st.borderRadius || "") + '</td>' +
      '</tr>';
    }).join("");

    const annoTable = (s.annotations && s.annotations.length > 0)
      ? '<table class="anno">' +
          '<thead><tr><th>Selector</th><th>Rect</th><th>Color</th><th>Background</th><th>Font</th><th>Spacing</th></tr></thead>' +
          '<tbody>' + annoRows + '</tbody>' +
        '</table>'
      : '<p style="color:var(--fg-muted); font-size: 12px;">No annotations captured for this shot.</p>';

    const fileLink = s.file
      ? '<code>' + escapeHtml(s.file) + (s.line ? ':' + s.line : '') + '</code>'
      : '<span style="color:var(--fg-muted)">(unknown)</span>';

    detail.innerHTML =
      '<div class="detail-head">' +
        '<h2>' + escapeHtml(s.test) + '</h2>' +
        '<span class="sub">· ' + escapeHtml(s.step) + ' · ' + s.suite + ' / ' + escapeHtml(s.spec) + '</span>' +
        '<button id="close-detail">Close (Esc)</button>' +
      '</div>' +
      '<div class="detail-body">' +
        (imgs.length > 0 ? '<div class="tabs">' + tabButtons + '</div><div>' + tabPanels + '</div>' : '') +
        '<div class="meta-grid">' +
          '<div><b>Status</b><br>' + statusBadge(s.status, s.diffFraction || 0) + '</div>' +
          '<div><b>Dimensions</b><br>' + s.width + ' × ' + s.height + '</div>' +
          '<div><b>Diff</b><br>' + (s.diffFraction !== null ? (s.diffFraction * 100).toFixed(3) + '% (' + s.diffPixels + ' px)' : '—') + '</div>' +
          '<div><b>Source</b><br>' + fileLink + '</div>' +
        '</div>' +
        (s.terminal
          ? '<details open><summary>Terminal output (' + s.terminal.split("\\n").length + ' lines)</summary><pre class="term">' + escapeHtml(s.terminal) + '</pre></details>'
          : '<details><summary>Terminal output</summary><p style="color:var(--fg-muted); font-size: 12px; margin: 0;">No terminal text captured for this shot.</p></details>'
        ) +
        '<details open><summary>Annotations (' + (s.annotations || []).length + ')</summary>' + annoTable + '</details>' +
        '<details><summary>State JSON</summary><pre>' + escapeHtml(JSON.stringify(s.state, null, 2)) + '</pre></details>' +
        '<details><summary>Raw shot metadata</summary><pre>' + escapeHtml(JSON.stringify({ suite: s.suite, spec: s.spec, test: s.test, step: s.step, timestamp: s.timestamp, shotRel: s.shotRel, baselineRel: s.baselineRel, diffRel: s.diffRel }, null, 2)) + '</pre></details>' +
      '</div>';
    overlay.classList.add("open");

    detail.querySelector("#close-detail").addEventListener("click", closeDetail);
    for (const btn of detail.querySelectorAll(".tabs button")) {
      btn.addEventListener("click", () => {
        for (const b of detail.querySelectorAll(".tabs button")) b.classList.toggle("active", b === btn);
        for (const p of detail.querySelectorAll(".tab-panel"))
          p.classList.toggle("active", p.dataset.tab === btn.dataset.tab);
      });
    }
  }
  function closeDetail() { overlay.classList.remove("open"); detail.innerHTML = ""; }

  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeDetail(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDetail(); });

  for (const el of [qEl, suiteEl, statusEl, failsEl]) el.addEventListener("input", render);
  render();
})();
</script>
</body>
</html>`;
}
