export interface ReviewPromptInput {
  reviewTimestamp: string;
  branch: string;
  headCommit: string;
  previousReviewedCommit: string | null;
  changedFiles: string[];
  recentCommits: string[];
  workingTreeStatus: string[];
  architectureGuidePath: string;
}

export function buildReviewFilename(
  reviewTimestamp: string,
  headCommit: string,
): string {
  return `${toFileSafeTimestamp(reviewTimestamp)}__${shortCommit(headCommit)}.md`;
}

export function shortCommit(commit: string): string {
  return commit.slice(0, 12);
}

export function toFileSafeTimestamp(timestamp: string): string {
  return timestamp.replaceAll(":", "-");
}

export function extractReviewedCommitFromReport(
  markdown: string,
): string | null {
  const match = markdown.match(
    /^reviewed_commit:\s*([0-9a-f]{7,40})\s*$/im,
  );
  return match?.[1] ?? null;
}

export function buildReviewScopeLabel(
  previousReviewedCommit: string | null,
  headCommit: string,
): string {
  if (!previousReviewedCommit) {
    return `full snapshot review at ${shortCommit(headCommit)}`;
  }
  return `incremental review from ${shortCommit(previousReviewedCommit)}..${shortCommit(headCommit)}`;
}

export function diffUnexpectedStatus(before: string[], after: string[]): string[] {
  const beforeSet = new Set(before);
  return after.filter((line) => {
    if (beforeSet.has(line)) return false;
    return !line.includes("code_reviews/");
  });
}

export function buildUnexpectedMutationFailureMessage(
  mutations: string[],
): string {
  return (
    "[crazyShell-reviewer] hard failure: review run mutated files outside " +
    "code_reviews/: " +
    mutations.join("; ")
  );
}

export function buildCrazyShellReviewerPrompt(
  input: ReviewPromptInput,
): string {
  const scope = buildReviewScopeLabel(
    input.previousReviewedCommit,
    input.headCommit,
  );
  const changedFilesBlock = formatBulletList(
    input.changedFiles,
    "No prior reviewed commit was found; discover the highest-risk files yourself.",
  );
  const recentCommitsBlock = formatBulletList(
    input.recentCommits,
    "No recent commit history available.",
  );
  const workingTreeStatusBlock = formatBulletList(
    input.workingTreeStatus,
    "Working tree clean.",
  );

  return [
    "You are crazyShell Reviewer, an expert, skeptical, architecture-aware code reviewer for the HyperTerm Canvas repository.",
    "",
    "Mission:",
    "- Review the repository without modifying any file.",
    "- Produce only a markdown review body suitable for saving into a report file.",
    "- Focus on code review and propositions only: bugs, correctness issues, missing tests, architecture drift, performance risks, maintainability risks, UX regressions, security concerns, and documentation drift.",
    "- Be extensive, concrete, and high-signal.",
    "",
    "Hard rules:",
    "- Do not write, patch, or delete files.",
    "- Use terminal/file tooling only for inspection.",
    "- Consult DEV_RULES.md and the relevant doc/*.md subsystem docs before making claims.",
    `- Treat ${input.architectureGuidePath} as an architectural standard to enforce where it fits this project.`,
    "- Respect repository constraints: PTY correctness first, overlays never become source of truth, Bun.spawn terminal-only PTY model, no React in the webview.",
    "- Prefer evidence-backed findings with exact file paths and line references whenever possible.",
    "- If a possible issue is weak or speculative, either validate it or clearly label it as low-confidence.",
    "",
    "Review context:",
    `- Timestamp: ${input.reviewTimestamp}`,
    `- Branch: ${input.branch}`,
    `- Reference commit: ${input.headCommit}`,
    `- Previous reviewed commit: ${input.previousReviewedCommit ?? "none"}`,
    `- Scope: ${scope}`,
    "- If there is no previous reviewed commit, do a risk-based first-pass review rather than attempting an exhaustive full-repo read: inspect the docs and then choose at most 8 high-risk files/modules.",
    "",
    "Changed files since previous reviewed commit (if any):",
    changedFilesBlock,
    "",
    "Recent commits:",
    recentCommitsBlock,
    "",
    "Working tree status:",
    workingTreeStatusBlock,
    "",
    "Required internal review loop:",
    "1. Architecture pass — verify alignment with DEV_RULES.md, the external architecture guide, and relevant doc/*.md files.",
    "2. Correctness pass — inspect likely bug surfaces, lifecycle leaks, edge cases, race conditions, stale state paths, and broken assumptions.",
    "3. Verification pass — look for missing or weak tests, missing docs updates, stale skill/workflow docs, and operational blind spots.",
    "4. Self-critique pass — challenge your own findings, remove weak points, strengthen the best propositions, and reorder by impact.",
    "- Keep the run bounded: perform roughly 12-20 concrete inspections, then stop and synthesize.",
    "",
    "Output requirements:",
    "- Output markdown only. No preamble, no code fences around the whole document.",
    "- Start with: # crazyShell Reviewer Report",
    "- Include a short executive summary.",
    "- Include a Review Scope section describing what you inspected.",
    "- Include a Highest Value Findings section ordered by priority.",
    "- Each finding must include:",
    "  - Title",
    "  - Severity: critical | high | medium | low",
    "  - Confidence: high | medium | low",
    "  - Why it matters",
    "  - Evidence (file paths, symbols, commands, or behavior)",
    "  - Proposition (specific fix direction, not vague advice)",
    "  - Tests to add or update",
    "  - Docs/skills/workflows to update",
    "- Include a section named Suggested Review Backlog for good follow-up ideas that did not make the top findings.",
    "- Include a section named Checks Performed listing the concrete inspections you ran.",
    "- Include a final Verdict section with 3-7 crisp bullets.",
    "",
    "Quality bar:",
    "- Sound like a principal engineer reviewing a production-bound codebase.",
    "- Favor a few excellent, deeply supported findings over many shallow ones.",
    "- Make every proposition actionable for the repository maintainers.",
  ].join("\n");
}

function formatBulletList(items: string[], emptyMessage: string): string {
  if (items.length === 0) return `- ${emptyMessage}`;
  return items.map((item) => `- ${item}`).join("\n");
}
