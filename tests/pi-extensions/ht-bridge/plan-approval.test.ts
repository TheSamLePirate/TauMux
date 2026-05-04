import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  buildDetailedPlanMarkdown,
  buildPlanApprovalBody,
  formatPlanForApproval,
  planApprovalResultText,
  requestPlanApproval,
  sanitizePlanName,
  writeDetailedPlanFile,
} from "../../../pi-extensions/ht-bridge/tools/plan-approval";

const surface = {
  inTauMux: true,
  surfaceId: "surface:1",
  agentId: "pi:1",
  cwd: null,
  fg: null,
  workspaceId: null,
};

const steps = [
  { id: "M1", title: "Explore", state: "active" },
  { id: "M2", title: "Implement", state: "waiting" },
] as const;

function fakeHt(responses: any[]) {
  const calls: any[] = [];
  return {
    calls,
    ht: {
      async call(method: string, params: object, opts: object) {
        calls.push({ method, params, opts });
        const next = responses.shift();
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
}

describe("plan approval helper", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ht-plan-approval-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("formats the proposed plan with compact state glyphs", () => {
    expect(formatPlanForApproval(steps)).toBe(
      "● M1 — Explore\n○ M2 — Implement",
    );
  });

  test("sanitizes plan names for .pi/plans filenames", () => {
    expect(sanitizePlanName("Fix Login Redirect!!")).toBe(
      "fix-login-redirect",
    );
    expect(sanitizePlanName("   ")).toBe("plan");
  });

  test("builds detailed markdown with sidebar steps and supplied details", () => {
    const md = buildDetailedPlanMarkdown({
      planName: "Auth Fix",
      steps,
      detailedPlanMarkdown: "## Approach\n\nInspect auth middleware.",
      source: "test",
      now: () => new Date("2026-01-02T03:04:05.000Z"),
    });
    expect(md).toContain("# Auth Fix");
    expect(md).toContain("- Source: test");
    expect(md).toContain("- Created: 2026-01-02T03:04:05.000Z");
    expect(md).toContain("**M1** — Explore");
    expect(md).toContain("Inspect auth middleware");
  });

  test("writes detailed plans under .pi/plans/<name>.md", async () => {
    const info = await writeDetailedPlanFile({
      cwd: dir,
      planName: "Fix Login Redirect!!",
      steps,
      detailedPlanMarkdown: "Detailed body",
      source: "unit-test",
    });
    expect(info.relativePath).toBe(".pi/plans/fix-login-redirect.md");
    const written = readFileSync(info.absolutePath, "utf8");
    expect(written).toContain("Detailed body");
    expect(written).toContain("## Sidebar steps");
  });

  test("approval body includes source, plan, saved file, and available actions", async () => {
    const planFile = await writeDetailedPlanFile({ cwd: dir, steps });
    const body = buildPlanApprovalBody({
      steps,
      source: "ht_plan_set",
      planFile,
    });
    expect(body).toContain("from ht_plan_set");
    expect(body).toContain("● M1 — Explore");
    expect(body).toContain(".pi/plans/explore.md");
    expect(body).toContain("Review the markdown file");
    expect(body).toContain("decline");
    expect(body).toContain("talk about it");
  });

  test("accept writes the plan file and returns accept after one choice prompt", async () => {
    const { ht, calls } = fakeHt([{ action: "ok", value: "accept" }]);
    const decision = await requestPlanApproval({
      ht,
      surface,
      cwd: dir,
      planName: "My Plan",
      detailedPlanMarkdown: "Full detail",
      steps,
    });
    expect(decision.action).toBe("accept");
    expect(decision.planFile?.relativePath).toBe(".pi/plans/my-plan.md");
    expect(readFileSync(decision.planFile!.absolutePath, "utf8")).toContain(
      "Full detail",
    );
    expect(calls.length).toBe(1);
    expect(calls[0].method).toBe("agent.ask_user");
    expect((calls[0].params as any).kind).toBe("choice");
    expect((calls[0].params as any).body).toContain(".pi/plans/my-plan.md");
    expect((calls[0].params as any).choices.map((c: any) => c.id)).toEqual([
      "accept",
      "decline",
      "discuss",
    ]);
  });

  test("decline does not ask for feedback", async () => {
    const { ht, calls } = fakeHt([{ action: "ok", value: "decline" }]);
    const decision = await requestPlanApproval({ ht, surface, cwd: dir, steps });
    expect(decision.action).toBe("decline");
    expect(decision.planFile?.relativePath).toBe(".pi/plans/explore.md");
    expect(calls.length).toBe(1);
  });

  test("discuss asks a second text prompt and returns feedback", async () => {
    const { ht, calls } = fakeHt([
      { action: "ok", value: "discuss" },
      { action: "ok", value: "Test first, then implement." },
    ]);
    const decision = await requestPlanApproval({ ht, surface, cwd: dir, steps });
    expect(decision.action).toBe("discuss");
    expect(decision).toMatchObject({
      feedback: "Test first, then implement.",
    });
    expect(decision.planFile?.relativePath).toBe(".pi/plans/explore.md");
    expect(calls.length).toBe(2);
    expect((calls[1].params as any).kind).toBe("text");
    expect((calls[1].params as any).body).toContain(".pi/plans/explore.md");
  });

  test("timeout is treated as a declined publication", async () => {
    const { ht } = fakeHt([{ action: "timeout" }]);
    const decision = await requestPlanApproval({ ht, surface, cwd: dir, steps });
    expect(decision).toMatchObject({
      action: "decline",
      reason: "Plan approval timed out.",
    });
    expect(decision.planFile?.relativePath).toBe(".pi/plans/explore.md");
  });

  test("missing surface id declines instead of writing or publishing silently", async () => {
    const { ht, calls } = fakeHt([]);
    const decision = await requestPlanApproval({
      ht,
      surface: { ...surface, surfaceId: "" },
      cwd: dir,
      steps,
    });
    expect(decision.action).toBe("decline");
    expect(decision.planFile).toBeUndefined();
    expect(calls.length).toBe(0);
  });

  test("result text carries discussion feedback and plan file path", () => {
    expect(
      planApprovalResultText({
        action: "discuss",
        feedback: "Move tests earlier.",
        planFile: {
          planName: "x",
          relativePath: ".pi/plans/x.md",
          absolutePath: join(dir, ".pi/plans/x.md"),
        },
      }),
    ).toContain(".pi/plans/x.md");
  });
});
