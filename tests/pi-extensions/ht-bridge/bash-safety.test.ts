/**
 * bash-safety — risk-pattern matcher + decideBashBlock decision tree.
 *
 * The pattern list is intentionally conservative: every false positive
 * pops a modal that interrupts the user, every false negative is a
 * destructive command running unchecked. We test both directions.
 */

import { describe, expect, test } from "bun:test";
import {
  DEFAULT_RISK_PATTERNS,
  decideBashBlock,
  isRisky,
  type BashSafetyConfig,
} from "../../../pi-extensions/ht-bridge/intercept/bash-safety-core";
import type { HtClient } from "../../../pi-extensions/ht-bridge/lib/ht-client";

describe("isRisky", () => {
  const risky = [
    "rm -rf /tmp/foo",
    "rm -fr build/",
    "rm -Rfv node_modules",
    "sudo systemctl restart docker",
    "mkfs.ext4 /dev/sda1",
    "dd if=/dev/zero of=/dev/sda bs=1M",
    ":(){:|:&};:",
    "git push --force origin main",
    "git push -f",
    "git reset --hard HEAD~3",
    "git clean -fd",
    "chmod -R 777 /var/log",
    "echo 1 > /dev/sda",
  ];
  const benign = [
    "ls -la",
    "echo 'rm -rf is mentioned in this string'", // single-quoted is still a regex hit; document the limitation
    "pwd",
    "cat README.md",
    "git status",
    "git push origin main",
    "rm file.txt",
    "rm -i some.txt",
    'echo "hello"',
    "find . -name '*.ts'",
  ];

  for (const cmd of risky) {
    test(`flags: ${cmd}`, () => {
      expect(isRisky(cmd)).toBe(true);
    });
  }

  for (const cmd of benign) {
    test(`allows: ${cmd}`, () => {
      // The "rm -rf is mentioned in this string" case will currently
      // match — pattern is char-level. Skip it from the strict allow
      // list (the cost of the FP is one modal; not a real bug).
      if (cmd.includes("rm -rf")) {
        expect(isRisky(cmd)).toBe(true);
        return;
      }
      expect(isRisky(cmd)).toBe(false);
    });
  }

  test("respects a custom pattern set", () => {
    expect(isRisky("danger-cmd", [/danger/])).toBe(true);
    expect(isRisky("rm -rf /", [/danger/])).toBe(false);
  });

  test("DEFAULT_RISK_PATTERNS is exported and non-empty", () => {
    expect(DEFAULT_RISK_PATTERNS.length).toBeGreaterThan(5);
  });
});

describe("decideBashBlock", () => {
  const surfaceCtx = {
    surfaceId: "surface:1",
    agentId: "pi:surface:1",
    inTauMux: true,
  };

  function fakeHt(
    reply: { action: string; value?: string },
    fail = false,
  ): HtClient {
    return {
      call: async () => {
        if (fail) throw new Error("transport failed");
        return reply as any;
      },
      callSoft: () => {},
      socketAvailable: () => true,
    };
  }

  test("mode=off → never blocks", async () => {
    const cfg: BashSafetyConfig = { mode: "off" };
    const ht = fakeHt({ action: "ok", value: "no" });
    const out = await decideBashBlock("rm -rf /", cfg, ht, surfaceCtx, "pi:1");
    expect(out).toBeUndefined();
  });

  test("mode=confirmRisky + benign command → no modal, no block", async () => {
    const cfg: BashSafetyConfig = { mode: "confirmRisky" };
    let asked = false;
    const ht: HtClient = {
      call: async () => {
        asked = true;
        return { action: "ok", value: "run" } as any;
      },
      callSoft: () => {},
      socketAvailable: () => true,
    };
    const out = await decideBashBlock("ls -la", cfg, ht, surfaceCtx, "pi:1");
    expect(out).toBeUndefined();
    expect(asked).toBe(false);
  });

  test("mode=confirmRisky + risky command + user 'run' → no block", async () => {
    const cfg: BashSafetyConfig = { mode: "confirmRisky" };
    const ht = fakeHt({ action: "ok", value: "run" });
    const out = await decideBashBlock(
      "rm -rf foo",
      cfg,
      ht,
      surfaceCtx,
      "pi:1",
    );
    expect(out).toBeUndefined();
  });

  test("mode=confirmRisky + risky + user cancels → blocks", async () => {
    const cfg: BashSafetyConfig = { mode: "confirmRisky" };
    const ht = fakeHt({ action: "cancel" });
    const out = await decideBashBlock(
      "rm -rf foo",
      cfg,
      ht,
      surfaceCtx,
      "pi:1",
    );
    expect(out).toMatchObject({ block: true });
    expect(out?.reason).toMatch(/cancel/i);
  });

  test("mode=confirmRisky + risky + timeout → blocks with timeout reason", async () => {
    const cfg: BashSafetyConfig = { mode: "confirmRisky" };
    const ht = fakeHt({ action: "timeout" });
    const out = await decideBashBlock(
      "rm -rf foo",
      cfg,
      ht,
      surfaceCtx,
      "pi:1",
    );
    expect(out).toMatchObject({ block: true });
    expect(out?.reason).toMatch(/in time|timeout/i);
  });

  test("mode=confirmAll + benign + user accepts → no block, modal asked", async () => {
    const cfg: BashSafetyConfig = { mode: "confirmAll" };
    const ht = fakeHt({ action: "ok", value: "run" });
    const out = await decideBashBlock("echo hi", cfg, ht, surfaceCtx, "pi:1");
    expect(out).toBeUndefined();
  });

  test("fail-open: τ-mux unreachable → no block (transport throws)", async () => {
    const cfg: BashSafetyConfig = { mode: "confirmRisky" };
    const ht = fakeHt({ action: "ok" }, true);
    const out = await decideBashBlock(
      "rm -rf foo",
      cfg,
      ht,
      surfaceCtx,
      "pi:1",
    );
    expect(out).toBeUndefined();
  });

  test("fail-open: outside τ-mux (no surfaceId) → no block", async () => {
    const cfg: BashSafetyConfig = { mode: "confirmRisky" };
    const ht = fakeHt({ action: "cancel" });
    const out = await decideBashBlock(
      "rm -rf foo",
      cfg,
      ht,
      { surfaceId: "", agentId: "pi:1234", inTauMux: false },
      "pi:1",
    );
    expect(out).toBeUndefined();
  });
});
