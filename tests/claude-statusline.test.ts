import { describe, test, expect } from "bun:test";
import {
  parseStatuslinePayload,
  renderStatusline,
  CONTEXT_WARN_PCT,
  CONTEXT_DANGER_PCT,
  RATE_LIMIT_SHOW_PCT,
} from "../src/shared/claude-statusline";
import type { ClaudeStatuslineData } from "../src/shared/claude-types";

/** Realistic payload per the Claude Code statusline docs (v2.1.x). */
const FULL_PAYLOAD: Record<string, unknown> = {
  cwd: "/Users/dev/project",
  session_id: "abc123",
  session_name: "Fix auth flow",
  transcript_path: "/Users/dev/.claude/projects/x/abc123.jsonl",
  model: { id: "claude-opus-5", display_name: "Opus" },
  workspace: {
    current_dir: "/Users/dev/project/sub",
    project_dir: "/Users/dev/project",
    added_dirs: [],
  },
  version: "2.1.216",
  output_style: { name: "default" },
  cost: {
    total_cost_usd: 0.31,
    total_duration_ms: 125_000,
    total_api_duration_ms: 42_000,
    total_lines_added: 156,
    total_lines_removed: 23,
  },
  context_window: {
    total_input_tokens: 80_000,
    total_output_tokens: 4_000,
    context_window_size: 200_000,
    used_percentage: 42.0,
    remaining_percentage: 58.0,
  },
  rate_limits: {
    five_hour: { used_percentage: 84, resets_at: 1_754_130_000 },
    seven_day: { used_percentage: 31, resets_at: 1_754_500_000 },
  },
  permission_mode: "acceptEdits",
  effort: { level: "high" },
  thinking: { enabled: true },
  exceeds_200k_tokens: false,
  pr: {
    number: 42,
    url: "https://github.com/x/y/pull/42",
    review_state: "pending",
  },
};

describe("parseStatuslinePayload", () => {
  test("maps the full payload", () => {
    const d = parseStatuslinePayload(FULL_PAYLOAD, "surface:5");
    expect(d).not.toBeNull();
    expect(d!.sessionId).toBe("abc123");
    expect(d!.surfaceId).toBe("surface:5");
    expect(d!.sessionName).toBe("Fix auth flow");
    expect(d!.modelDisplayName).toBe("Opus");
    expect(d!.cwd).toBe("/Users/dev/project/sub");
    expect(d!.projectDir).toBe("/Users/dev/project");
    expect(d!.costUsd).toBe(0.31);
    expect(d!.linesAdded).toBe(156);
    expect(d!.linesRemoved).toBe(23);
    expect(d!.contextUsedPct).toBe(42);
    expect(d!.contextTokens).toBe(84_000);
    expect(d!.contextWindowSize).toBe(200_000);
    expect(d!.rateLimits!.fiveHourPct).toBe(84);
    expect(d!.rateLimits!.fiveHourResetsAt).toBe(1_754_130_000);
    expect(d!.rateLimits!.sevenDayPct).toBe(31);
    expect(d!.permissionMode).toBe("acceptEdits");
    expect(d!.effortLevel).toBe("high");
    expect(d!.prNumber).toBe(42);
    expect(d!.prReviewState).toBe("pending");
    expect(d!.ccVersion).toBe("2.1.216");
  });

  test("returns null without session_id", () => {
    expect(parseStatuslinePayload({}, undefined)).toBeNull();
    expect(parseStatuslinePayload({ cwd: "/x" })).toBeNull();
  });

  test("tolerates missing sub-objects (old Claude Code versions)", () => {
    const d = parseStatuslinePayload({ session_id: "s", cwd: "/x" });
    expect(d).not.toBeNull();
    expect(d!.cwd).toBe("/x");
    expect(d!.costUsd).toBeUndefined();
    expect(d!.contextUsedPct).toBeUndefined();
    expect(d!.rateLimits!.fiveHourPct).toBeNull();
  });
});

describe("renderStatusline", () => {
  const base = parseStatuslinePayload(FULL_PAYLOAD, undefined)!;

  test("renders identity + meters (noColor)", () => {
    const out = renderStatusline(base, { noColor: true, gitBranch: "main" });
    const [line1, line2] = out.split("\n");
    expect(line1).toContain("Opus");
    expect(line1).toContain("high"); // non-default effort
    expect(line1).toContain("sub"); // short dir
    expect(line1).toContain("⎇ main");
    expect(line1).toContain("acceptEdits"); // non-default mode
    expect(line1).toContain("PR #42 pending");
    expect(line2).toContain("42%");
    expect(line2).toContain("$0.31");
    expect(line2).toContain("+156");
    expect(line2).toContain("-23");
    // 5h at 84% ≥ show threshold; 7d at 31% hidden
    expect(line2).toContain("5h 84%");
    expect(line2).not.toContain("7d");
  });

  test("default mode and medium effort drop out", () => {
    const d: ClaudeStatuslineData = {
      ...base,
      permissionMode: "default",
      effortLevel: "medium",
      prNumber: undefined,
    };
    const out = renderStatusline(d, { noColor: true });
    expect(out).not.toContain("default");
    expect(out).not.toContain("medium");
    expect(out).not.toContain("PR #");
  });

  test("empty data renders a non-empty fallback line", () => {
    const out = renderStatusline({ sessionId: "" }, { noColor: true });
    expect(out.trim().length).toBeGreaterThan(0);
    expect(out).toContain("Claude");
    expect(out).not.toContain("\n"); // no meters line
  });

  test("context bar colors follow the shared thresholds", () => {
    const at = (pct: number) =>
      renderStatusline({ ...base, contextUsedPct: pct }, {});
    expect(at(CONTEXT_WARN_PCT - 1)).toContain("\x1b[32m"); // green
    expect(at(CONTEXT_WARN_PCT)).toContain("\x1b[33m"); // yellow
    expect(at(CONTEXT_DANGER_PCT)).toContain("\x1b[31m"); // red
  });

  test("rate-limit segment respects the show threshold", () => {
    const d: ClaudeStatuslineData = {
      ...base,
      rateLimits: {
        fiveHourPct: RATE_LIMIT_SHOW_PCT - 1,
        fiveHourResetsAt: null,
        sevenDayPct: null,
        sevenDayResetsAt: null,
      },
    };
    expect(renderStatusline(d, { noColor: true })).not.toContain("5h");
  });
});
