import { describe, expect, test } from "bun:test";
import {
  buildCrazyShellReviewerPrompt,
  buildReviewFilename,
  buildReviewScopeLabel,
  extractReviewedCommitFromReport,
  shortCommit,
  toFileSafeTimestamp,
} from "../src/shared/code-review-agent";

describe("code review agent helpers", () => {
  test("buildReviewFilename uses a file-safe timestamp and short commit", () => {
    expect(
      buildReviewFilename(
        "2026-04-18T08:10:00.000Z",
        "ec7bc7aa8a10c55731acfdd07d213848ea29dd98",
      ),
    ).toBe("2026-04-18T08-10-00.000Z__ec7bc7aa8a10.md");
  });

  test("extractReviewedCommitFromReport reads frontmatter metadata", () => {
    expect(
      extractReviewedCommitFromReport(`---\nreviewed_commit: ec7bc7aa8a10c55731acfdd07d213848ea29dd98\n---`),
    ).toBe("ec7bc7aa8a10c55731acfdd07d213848ea29dd98");
  });

  test("extractReviewedCommitFromReport returns null when metadata is absent", () => {
    expect(extractReviewedCommitFromReport("# report")).toBeNull();
  });

  test("buildReviewScopeLabel reports full snapshot mode without prior review", () => {
    expect(buildReviewScopeLabel(null, "ec7bc7aa8a10c55731acfdd07d213848ea29dd98")).toBe(
      "full snapshot review at ec7bc7aa8a10",
    );
  });

  test("buildReviewScopeLabel reports incremental mode with prior review", () => {
    expect(
      buildReviewScopeLabel(
        "145a8f7c2df4b6f9f50afbfaa235ecce14f9e402",
        "ec7bc7aa8a10c55731acfdd07d213848ea29dd98",
      ),
    ).toBe("incremental review from 145a8f7c2df4..ec7bc7aa8a10");
  });

  test("buildCrazyShellReviewerPrompt embeds the review context and required sections", () => {
    const prompt = buildCrazyShellReviewerPrompt({
      reviewTimestamp: "2026-04-18T08:10:00.000Z",
      branch: "main",
      headCommit: "ec7bc7aa8a10c55731acfdd07d213848ea29dd98",
      previousReviewedCommit: "145a8f7c2df4b6f9f50afbfaa235ecce14f9e402",
      changedFiles: ["src/bun/index.ts", "doc/system-browser-pane.md"],
      recentCommits: ["ec7bc7a Fix example", "145a8f7 Add example"],
      workingTreeStatus: ["M package.json"],
      architectureGuidePath:
        "/Users/olivierveinand/Documents/DEV/architecture-guide.md",
    });

    expect(prompt).toContain("You are crazyShell Reviewer");
    expect(prompt).toContain("Reference commit: ec7bc7aa8a10c55731acfdd07d213848ea29dd98");
    expect(prompt).toContain("- src/bun/index.ts");
    expect(prompt).toContain("- doc/system-browser-pane.md");
    expect(prompt).toContain("- M package.json");
    expect(prompt).toContain("# crazyShell Reviewer Report");
    expect(prompt).toContain("Suggested Review Backlog");
    expect(prompt).toContain("Checks Performed");
  });

  test("utility helpers stay stable", () => {
    expect(shortCommit("ec7bc7aa8a10c55731acfdd07d213848ea29dd98")).toBe(
      "ec7bc7aa8a10",
    );
    expect(toFileSafeTimestamp("2026-04-18T08:10:00.000Z")).toBe(
      "2026-04-18T08-10-00.000Z",
    );
  });
});
