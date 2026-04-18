#!/usr/bin/env bun

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  buildCrazyShellReviewerPrompt,
  buildReviewFilename,
  buildUnexpectedMutationFailureMessage,
  diffUnexpectedStatus,
  extractReviewedCommitFromReport,
  shortCommit,
} from "../src/shared/code-review-agent";

const REPO_ROOT = resolve(import.meta.dir, "..");
const REVIEWS_DIR = join(REPO_ROOT, "code_reviews");
const ARCHITECTURE_GUIDE_PATH =
  "/Users/olivierveinand/Documents/DEV/architecture-guide.md";

mkdirSync(REVIEWS_DIR, { recursive: true });

const beforeStatus = gitLines(["status", "--short"]);
const reviewTimestamp = new Date().toISOString();
const headCommit = git(["rev-parse", "HEAD"]);
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
const previousReviewedCommit = findLatestReviewedCommit();
const changedFiles = previousReviewedCommit
  ? gitLines(["diff", "--name-only", `${previousReviewedCommit}..${headCommit}`])
  : [];
const recentCommits = gitLines(["log", "--oneline", "-n", "12"]);
const workingTreeStatus = beforeStatus;
const prompt = buildCrazyShellReviewerPrompt({
  reviewTimestamp,
  branch,
  headCommit,
  previousReviewedCommit,
  changedFiles,
  recentCommits,
  workingTreeStatus,
  architectureGuidePath: ARCHITECTURE_GUIDE_PATH,
});

console.log(
  `[crazyShell-reviewer] reviewing ${shortCommit(headCommit)} on ${branch}`,
);

const hermes = spawnSync(
  "hermes",
  [
    "--yolo",
    "chat",
    "-Q",
    "-t",
    "terminal,file,todo,skills",
    "-q",
    prompt,
  ],
  {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  },
);

if (hermes.status !== 0) {
  console.error(hermes.stderr?.trim() || hermes.stdout?.trim() || "hermes failed");
  process.exit(1);
}

const reportBody = sanitizeMarkdown(hermes.stdout ?? "");
if (!reportBody.trim()) {
  console.error("[crazyShell-reviewer] empty report from hermes");
  process.exit(1);
}

const afterStatus = gitLines(["status", "--short"]);
const unexpectedMutations = diffUnexpectedStatus(beforeStatus, afterStatus);
if (unexpectedMutations.length > 0) {
  console.error(buildUnexpectedMutationFailureMessage(unexpectedMutations));
  process.exit(1);
}
const fileName = buildReviewFilename(reviewTimestamp, headCommit);
const outPath = join(REVIEWS_DIR, fileName);
const document = buildReviewDocument({
  reviewTimestamp,
  branch,
  headCommit,
  previousReviewedCommit,
  reportBody,
});

writeFileSync(outPath, document);
console.log(`[crazyShell-reviewer] wrote ${relative(REPO_ROOT, outPath)}`);

function buildReviewDocument(input: {
  reviewTimestamp: string;
  branch: string;
  headCommit: string;
  previousReviewedCommit: string | null;
  reportBody: string;
}): string {
  const lines = [
    "---",
    "agent: crazyShell Reviewer",
    `generated_at: ${input.reviewTimestamp}`,
    `reviewed_branch: ${input.branch}`,
    `reviewed_commit: ${input.headCommit}`,
    `reviewed_commit_short: ${shortCommit(input.headCommit)}`,
    `previous_reviewed_commit: ${input.previousReviewedCommit ?? "none"}`,
    `architecture_guide: ${ARCHITECTURE_GUIDE_PATH}`,
    "output_mode: propositions-only",
    "---",
    "",
  ];

  lines.push(input.reportBody.trim());
  lines.push("");
  return lines.join("\n");
}

function sanitizeMarkdown(markdown: string): string {
  const trimmed = markdown.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("```markdown") && trimmed.endsWith("```")) {
    return trimmed.slice("```markdown".length, -3).trim();
  }
  if (trimmed.startsWith("```") && trimmed.endsWith("```")) {
    return trimmed.slice(3, -3).trim();
  }
  return trimmed;
}

function findLatestReviewedCommit(): string | null {
  if (!existsSync(REVIEWS_DIR)) return null;
  const files = readdirSync(REVIEWS_DIR)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .sort();
  for (let index = files.length - 1; index >= 0; index -= 1) {
    const path = join(REVIEWS_DIR, files[index]);
    const markdown = readFileSync(path, "utf8");
    const commit = extractReviewedCommitFromReport(markdown);
    if (commit) return commit;
  }
  return null;
}

function diffUnexpectedStatus(before: string[], after: string[]): string[] {
  const beforeSet = new Set(before);
  return after.filter((line) => {
    if (beforeSet.has(line)) return false;
    return !line.includes("code_reviews/");
  });
}

function git(args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    console.error(result.stderr?.trim() || `git ${args.join(" ")} failed`);
    process.exit(1);
  }
  return result.stdout.trim();
}

function gitLines(args: string[]): string[] {
  const text = git(args);
  if (!text) return [];
  return text.split("\n").map((line) => line.trim()).filter(Boolean);
}
