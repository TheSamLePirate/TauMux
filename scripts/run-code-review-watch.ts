#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { shortCommit } from "../src/shared/code-review-agent";

const REPO_ROOT = resolve(import.meta.dir, "..");
const REVIEWS_DIR = join(REPO_ROOT, "code_reviews");
const pollSeconds = readPollSeconds(process.argv.slice(2));
let lastSeenCommit = currentHeadCommit();

console.log(
  `[crazyShell-reviewer] watch mode started on ${shortCommit(lastSeenCommit)} — polling every ${pollSeconds}s`,
);

for (;;) {
  const headCommit = currentHeadCommit();
  const hasReview = hasReviewForCommit(headCommit);

  if (headCommit !== lastSeenCommit) {
    console.log(
      `[crazyShell-reviewer] detected new commit ${shortCommit(headCommit)}`,
    );
  }

  if (!hasReview) {
    runReview();
  }

  lastSeenCommit = headCommit;
  await sleep(pollSeconds * 1000);
}

function currentHeadCommit(): string {
  return run(["git", "rev-parse", "HEAD"]);
}

function hasReviewForCommit(commit: string): boolean {
  if (!existsSync(REVIEWS_DIR)) return false;
  const short = shortCommit(commit);
  return readdirSync(REVIEWS_DIR).some(
    (name) => name.endsWith(`__${short}.md`) || name.includes(commit),
  );
}

function runReview(): void {
  console.log("[crazyShell-reviewer] running review agent");
  const result = spawnSync("bun", ["scripts/run-code-review-agent.ts"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error("[crazyShell-reviewer] review run failed; will retry on next poll");
  }
}

function run(command: string[]): string {
  const [bin, ...args] = command;
  const result = spawnSync(bin, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    console.error(result.stderr?.trim() || `${command.join(" ")} failed`);
    process.exit(1);
  }
  return result.stdout.trim();
}

function readPollSeconds(args: string[]): number {
  const fromArg = args.find((arg) => /^--poll-seconds=\d+$/.test(arg));
  const fromEnv = process.env["CRAZYSHELL_REVIEW_POLL_SECONDS"];
  const raw = fromArg?.split("=", 2)[1] ?? fromEnv ?? "300";
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
