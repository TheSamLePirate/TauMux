// Pane-chrome chip renderer.
//
// Originally a private function inside `src/views/terminal/surface-manager.ts`.
// M16 of the web-mirror parity plan moved it here so the browser
// mirror produces identical chip DOM. Pure DOM, signature-cached,
// `SurfaceMetadata` in / void out.
//
// Port-chip click semantics differ between surfaces:
//   - native:  dispatches `ht-open-external` window event so
//              electrobun routes the URL through `Utils.openExternal`
//   - web:     opens a new browser tab pointing at the
//              user-controlled host (`window.location.hostname`),
//              not localhost — the web user might be remote
// We expose the open-handler as an injected dep so each surface
// keeps its own behaviour without forking the chip renderer.

import type { SurfaceMetadata } from "./types";

export type PaneChipsPortHandler = (port: number, event: Event) => void;

export interface PaneChipsDeps {
  /** Called when the user clicks (or presses Enter on) a port chip.
   *  The handler receives the bare port number; surface decides how
   *  to convert it into a URL and how to open it. */
  onPortClick: PaneChipsPortHandler;
}

/** Render the chip row for a surface. The host element's
 *  `dataset.chipsSig` field is used as a signature cache so 1 Hz
 *  metadata ticks that don't change visible content skip the DOM
 *  rebuild entirely. */
export function renderSurfaceChips(
  host: HTMLElement,
  meta: SurfaceMetadata,
  deps: PaneChipsDeps,
): void {
  // Bail if the chips row would be byte-identical to the last render.
  // Metadata broadcasts at 1 Hz per surface and the poller already
  // de-dupes equivalent snapshots — but workspace switches, focus
  // changes, and web-mirror replays all trigger a re-render, so it's
  // still worth skipping the DOM churn when the visible data is
  // unchanged. Cheap hash, no JSON.stringify.
  const sig = chipsSignature(meta);
  if (host.dataset["chipsSig"] === sig) return;
  host.dataset["chipsSig"] = sig;

  host.replaceChildren();
  // P7 S3 — the chip row aggregates derived telemetry that's otherwise
  // invisible to assistive tech (icons + numbers without text context).
  // Mark the host as a status region so screen readers announce changes
  // politely; per-chip `aria-label`s below carry the human-readable
  // version of each chip's value.
  host.setAttribute("role", "status");
  host.setAttribute("aria-live", "polite");
  host.setAttribute("aria-atomic", "false");

  const fg = meta.tree.find((n) => n.pid === meta.foregroundPid);
  // Hide command chip when the foreground IS the shell itself —
  // rendering "zsh" / "bash" forever is noise.
  const showCommand =
    fg && meta.foregroundPid !== meta.pid && fg.command.length > 0;
  if (showCommand) {
    const chip = buildChip("chip-command", truncate(fg.command, 48));
    chip.setAttribute("aria-label", `Foreground command: ${fg.command}`);
    host.appendChild(chip);
  }

  if (meta.cwd) {
    const chip = buildChip("chip-cwd", shortenCwd(meta.cwd));
    chip.title = meta.cwd;
    chip.setAttribute("aria-label", `Working directory: ${meta.cwd}`);
    host.appendChild(chip);
  }

  if (meta.git) {
    const chip = document.createElement("span");
    chip.className = "surface-chip chip-git";
    if (isDirtyGit(meta.git)) chip.classList.add("dirty");
    chip.title = formatGitTooltip(meta.git);
    chip.setAttribute("aria-label", `Git: ${formatGitAria(meta.git)}`);
    fillGitChip(chip, meta.git);
    host.appendChild(chip);
  }

  // Dedup ports shown in the chip row by port number (a single proc
  // often binds both v4 and v6 for the same port).
  const seen = new Set<number>();
  for (const p of meta.listeningPorts) {
    if (seen.has(p.port)) continue;
    seen.add(p.port);
    const chip = buildChip("chip-port", `:${p.port}`);
    chip.title = `${p.proto} ${p.address}:${p.port} (pid ${p.pid}) — click to open`;
    chip.setAttribute("role", "button");
    chip.setAttribute(
      "aria-label",
      `Open port ${p.port} (${p.proto} ${p.address}, pid ${p.pid})`,
    );
    chip.tabIndex = 0;
    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      deps.onPortClick(p.port, e);
    });
    chip.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        deps.onPortClick(p.port, e);
      }
    });
    host.appendChild(chip);
  }
}

/** Human-readable git state for screen readers — folds the
 *  branch/ahead/behind/dirty counts into a single comma-separated
 *  sentence. Keeps the visible chip terse while assistive tech still
 *  hears the full picture. */
function formatGitAria(g: NonNullable<SurfaceMetadata["git"]>): string {
  const parts: string[] = [`branch ${g.branch}`];
  if (g.ahead > 0) parts.push(`${g.ahead} ahead`);
  if (g.behind > 0) parts.push(`${g.behind} behind`);
  if (g.conflicts > 0) parts.push(`${g.conflicts} conflicts`);
  if (g.insertions > 0) parts.push(`+${g.insertions} lines`);
  if (g.deletions > 0) parts.push(`-${g.deletions} lines`);
  if (!isDirtyGit(g)) parts.push("clean");
  return parts.join(", ");
}

function buildChip(cls: string, text: string): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = `surface-chip ${cls}`;
  el.textContent = text;
  return el;
}

/** Terse signature of the rendered chip row. Any change in the inputs
 *  that renderSurfaceChips actually reads produces a different string;
 *  unchanged inputs produce the same string. Used to skip redundant
 *  DOM rebuilds. */
export function chipsSignature(meta: SurfaceMetadata): string {
  const fg = meta.tree.find((n) => n.pid === meta.foregroundPid);
  const cmd = fg && meta.foregroundPid !== meta.pid ? fg.command : "";
  const ports = meta.listeningPorts
    .map((p) => p.port)
    .filter((p, i, a) => a.indexOf(p) === i)
    .join(",");
  const git = meta.git
    ? `${meta.git.branch ?? ""}|${meta.git.ahead}|${meta.git.behind}|` +
      `${meta.git.staged}|${meta.git.unstaged}|${meta.git.untracked}|` +
      `${meta.git.conflicts}|${meta.git.insertions}|${meta.git.deletions}`
    : "";
  return `${cmd}${meta.cwd ?? ""}${git}${ports}`;
}

/** Compact cwd for the chip — last 2 path segments are almost always
 *  enough context. Full absolute path lives on the chip's title. */
function shortenCwd(cwd: string): string {
  if (cwd === "/") return "/";
  const parts = cwd.replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts.length <= 2)
    return cwd.startsWith("/") ? "/" + parts.join("/") : parts.join("/");
  return "…/" + parts.slice(-2).join("/");
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function isDirtyGit(g: NonNullable<SurfaceMetadata["git"]>): boolean {
  return (
    g.staged > 0 ||
    g.unstaged > 0 ||
    g.untracked > 0 ||
    g.conflicts > 0 ||
    g.insertions > 0 ||
    g.deletions > 0
  );
}

/** Build the git chip DOM: branch (neutral), optional ahead/behind +
 *  conflicts, then green `+insertions` and red `-deletions` (from
 *  `git diff HEAD`). Line counts > file counts because that's what
 *  most prompts use and the most at-a-glance useful signal; the full
 *  file-count breakdown lives in the hover tooltip. */
function fillGitChip(
  el: HTMLSpanElement,
  g: NonNullable<SurfaceMetadata["git"]>,
): void {
  el.replaceChildren();

  const branch = document.createElement("span");
  branch.className = "chip-git-branch";
  branch.textContent = "⎇ " + g.branch;
  el.appendChild(branch);

  if (g.ahead > 0) el.appendChild(gitSpan("chip-git-ahead", `↑${g.ahead}`));
  if (g.behind > 0) el.appendChild(gitSpan("chip-git-behind", `↓${g.behind}`));
  if (g.conflicts > 0)
    el.appendChild(gitSpan("chip-git-conflicts", `!${g.conflicts}`));
  if (g.insertions > 0)
    el.appendChild(gitSpan("chip-git-add", `+${g.insertions}`));
  if (g.deletions > 0)
    el.appendChild(gitSpan("chip-git-del", `−${g.deletions}`));
}

function gitSpan(cls: string, text: string): HTMLSpanElement {
  const s = document.createElement("span");
  s.className = cls;
  s.textContent = text;
  return s;
}

function formatGitTooltip(g: NonNullable<SurfaceMetadata["git"]>): string {
  const lines: string[] = [];
  lines.push(`branch: ${g.branch}${g.head ? " @ " + g.head : ""}`);
  if (g.upstream) {
    const ab: string[] = [];
    if (g.ahead > 0) ab.push(`↑${g.ahead}`);
    if (g.behind > 0) ab.push(`↓${g.behind}`);
    lines.push(
      `upstream: ${g.upstream}${ab.length ? " (" + ab.join(" ") + ")" : ""}`,
    );
  }
  if (g.staged || g.unstaged || g.untracked || g.conflicts) {
    lines.push(
      `files: ${g.staged} staged, ${g.unstaged} unstaged, ${g.untracked} untracked${g.conflicts ? `, ${g.conflicts} conflicts` : ""}`,
    );
  }
  if (g.insertions || g.deletions) {
    lines.push(`diff vs HEAD: +${g.insertions} -${g.deletions}`);
  }
  return lines.join("\n");
}
