// H14 (full_app_review_2026-05.md §5.2) — `SurfaceMetadataPoller.tick()`
// orchestration tests. The pure parsers are covered in
// surface-metadata.test.ts; this file drives the 1 Hz orchestration
// (surface filtering, dead-snapshot eviction, tree/fg/port/cwd union,
// git resolution + TTL cache, prune-on-empty, emit decision incl. the
// cpu/rss delta gate) through the injectable `MetadataRunners` seam.

import { describe, test, expect } from "bun:test";
import {
  SurfaceMetadataPoller,
  type MetadataRunners,
  type PsRow,
} from "../src/bun/surface-metadata";
import type {
  GitInfo,
  ListeningPort,
  SurfaceMetadata,
} from "../src/shared/types";

// ── Fixtures ──────────────────────────────────────────────────

function psRow(over: Partial<PsRow> & { pid: number }): PsRow {
  return {
    pid: over.pid,
    ppid: over.ppid ?? 0,
    pgid: over.pgid ?? over.pid,
    stat: over.stat ?? "S",
    cpu: over.cpu ?? 0,
    rssKb: over.rssKb ?? 1024,
    command: over.command ?? "cmd",
  };
}

/** A shell (pid 100) with a foreground child (pid 200). The child is the
 *  process group leader with a "+" stat, so findForegroundPid picks it. */
function shellWithFg(
  opts: { cpu?: number; rssKb?: number; cmd?: string } = {},
) {
  return new Map<number, PsRow>([
    [100, psRow({ pid: 100, ppid: 1, pgid: 100, stat: "Ss", command: "-zsh" })],
    [
      200,
      psRow({
        pid: 200,
        ppid: 100,
        pgid: 200,
        stat: "S+",
        cpu: opts.cpu ?? 0,
        rssKb: opts.rssKb ?? 2048,
        command: opts.cmd ?? "node server.js",
      }),
    ],
  ]);
}

function sessionsOf(surfaces: { id: string; pid: number | null }[]) {
  return {
    getAllSurfaces: () =>
      surfaces.map((s) => ({ id: s.id, pty: { pid: s.pid } })),
  };
}

function runners(over: Partial<MetadataRunners> = {}): MetadataRunners {
  return {
    runPs: over.runPs ?? (async () => new Map()),
    runListeningPorts: over.runListeningPorts ?? (async () => new Map()),
    runCwds: over.runCwds ?? (async () => new Map()),
    runGit: over.runGit ?? (async () => null),
  };
}

function gitInfo(over: Partial<GitInfo> = {}): GitInfo {
  return {
    branch: "main",
    head: "abcdef012345",
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicts: 0,
    insertions: 0,
    deletions: 0,
    detached: false,
    ...over,
  };
}

/** Build a poller wired to capture every onMetadata emission. */
function makePoller(
  surfaces: { id: string; pid: number | null }[],
  r: MetadataRunners,
) {
  const poller = new SurfaceMetadataPoller(sessionsOf(surfaces), 1000, r);
  const emits: { id: string; md: SurfaceMetadata }[] = [];
  poller.onMetadata = (id, md) => emits.push({ id, md });
  return { poller, emits };
}

// ── Tests ─────────────────────────────────────────────────────

describe("SurfaceMetadataPoller.tick — emit on change", () => {
  test("first tick builds a full snapshot and emits it", async () => {
    const ports: ListeningPort[] = [
      { pid: 200, port: 3000, proto: "tcp", address: "127.0.0.1" },
    ];
    const { poller, emits } = makePoller(
      [{ id: "s1", pid: 100 }],
      runners({
        runPs: async () => shellWithFg(),
        runCwds: async () => new Map([[200, "/proj/a"]]),
        runListeningPorts: async () => new Map([[200, ports]]),
        runGit: async (cwd) => (cwd === "/proj/a" ? gitInfo() : null),
      }),
    );

    await poller.runTickForTest();

    expect(emits).toHaveLength(1);
    expect(emits[0].id).toBe("s1");
    const md = emits[0].md;
    expect(md.pid).toBe(100);
    expect(md.foregroundPid).toBe(200);
    expect(md.cwd).toBe("/proj/a");
    expect(md.tree.map((n) => n.pid)).toEqual([100, 200]);
    expect(md.listeningPorts).toHaveLength(1);
    expect(md.listeningPorts[0].port).toBe(3000);
    expect(md.git?.branch).toBe("main");
    // The snapshot is now cached for the CLI/getSnapshot.
    expect(poller.getSnapshot("s1")?.cwd).toBe("/proj/a");
  });

  test("a stable second tick does NOT re-emit", async () => {
    const r = runners({
      runPs: async () => shellWithFg(),
      runCwds: async () => new Map([[200, "/proj/a"]]),
      runGit: async () => gitInfo(),
    });
    const { poller, emits } = makePoller([{ id: "s1", pid: 100 }], r);

    await poller.runTickForTest();
    await poller.runTickForTest();

    expect(emits).toHaveLength(1); // only the first tick emitted
  });

  test("a changed foreground command re-emits", async () => {
    let cmd = "node a.js";
    const { poller, emits } = makePoller(
      [{ id: "s1", pid: 100 }],
      runners({
        runPs: async () => shellWithFg({ cmd }),
        runCwds: async () => new Map([[200, "/proj/a"]]),
      }),
    );

    await poller.runTickForTest();
    cmd = "node b.js";
    await poller.runTickForTest();

    expect(emits).toHaveLength(2);
    expect(emits[1].md.tree[1].command).toBe("node b.js");
  });
});

describe("SurfaceMetadataPoller.tick — cpu/rss delta gate (H7/5.1)", () => {
  test("a sub-threshold cpu wiggle does not re-emit; a big jump does", async () => {
    let cpu = 1.0;
    const { poller, emits } = makePoller(
      [{ id: "s1", pid: 100 }],
      runners({
        runPs: async () => shellWithFg({ cpu }),
        runCwds: async () => new Map([[200, "/proj/a"]]),
      }),
    );

    await poller.runTickForTest(); // emit #1 (cpu 1.0)
    cpu = 1.4; // +0.4 < CPU_EMIT_DELTA (1.0)
    await poller.runTickForTest(); // no emit
    expect(emits).toHaveLength(1);

    cpu = 3.0; // +2.0 vs last emitted (1.0) >= 1.0
    await poller.runTickForTest(); // emit #2
    expect(emits).toHaveLength(2);
    expect(emits[1].md.tree[1].cpu).toBe(3.0);
  });

  test("a >=4 MiB rss jump re-emits", async () => {
    let rssKb = 2048;
    const { poller, emits } = makePoller(
      [{ id: "s1", pid: 100 }],
      runners({
        runPs: async () => shellWithFg({ rssKb }),
        runCwds: async () => new Map([[200, "/proj/a"]]),
      }),
    );

    await poller.runTickForTest(); // emit #1
    rssKb = 2048 + 4096; // +4 MiB
    await poller.runTickForTest(); // emit #2
    expect(emits).toHaveLength(2);
  });
});

describe("SurfaceMetadataPoller.tick — lifecycle & pruning", () => {
  test("a surface that disappears has its cached snapshot evicted", async () => {
    let live = [
      { id: "s1", pid: 100 },
      { id: "s2", pid: 300 },
    ];
    const r = runners({
      runPs: async () =>
        new Map<number, PsRow>([
          ...shellWithFg(),
          [300, psRow({ pid: 300, ppid: 1, pgid: 300, stat: "Ss" })],
        ]),
      runCwds: async () => new Map([[200, "/proj/a"]]),
    });
    const poller = new SurfaceMetadataPoller(
      {
        getAllSurfaces: () =>
          live.map((s) => ({ id: s.id, pty: { pid: s.pid } })),
      },
      1000,
      r,
    );

    await poller.runTickForTest();
    expect(poller.getSnapshot("s1")).not.toBeNull();
    expect(poller.getSnapshot("s2")).not.toBeNull();

    // s2 closes.
    live = [{ id: "s1", pid: 100 }];
    await poller.runTickForTest();
    expect(poller.getSnapshot("s2")).toBeNull();
    expect(poller.getSnapshot("s1")).not.toBeNull();
  });

  test("surfaces without a pid are skipped", async () => {
    const { poller, emits } = makePoller(
      [{ id: "s1", pid: null }],
      runners({ runPs: async () => shellWithFg() }),
    );
    await poller.runTickForTest();
    expect(emits).toHaveLength(0);
    expect(poller.getSnapshot("s1")).toBeNull();
  });

  test("runPs returning null aborts the tick without emitting", async () => {
    const { poller, emits } = makePoller(
      [{ id: "s1", pid: 100 }],
      runners({ runPs: async () => null }),
    );
    await poller.runTickForTest();
    expect(emits).toHaveLength(0);
  });

  test("no live surfaces → early return, nothing emitted", async () => {
    let called = false;
    const { poller, emits } = makePoller(
      [],
      runners({
        runPs: async () => {
          called = true;
          return shellWithFg();
        },
      }),
    );
    await poller.runTickForTest();
    expect(emits).toHaveLength(0);
    expect(called).toBe(false); // bailed before spawning ps
  });
});

describe("SurfaceMetadataPoller.tick — git TTL + multi-repo", () => {
  test("resolves git per distinct cwd in one tick", async () => {
    const seen: string[] = [];
    const { poller, emits } = makePoller(
      [
        { id: "s1", pid: 100 },
        { id: "s2", pid: 300 },
      ],
      runners({
        runPs: async () =>
          new Map<number, PsRow>([
            ...shellWithFg(),
            [300, psRow({ pid: 300, ppid: 1, pgid: 300, stat: "Ss" })],
            [
              400,
              psRow({
                pid: 400,
                ppid: 300,
                pgid: 400,
                stat: "S+",
                command: "vim",
              }),
            ],
          ]),
        runCwds: async () =>
          new Map([
            [200, "/proj/a"],
            [400, "/proj/b"],
          ]),
        runGit: async (cwd) => {
          seen.push(cwd);
          return gitInfo({ branch: cwd === "/proj/a" ? "main" : "dev" });
        },
      }),
    );

    await poller.runTickForTest();
    expect(seen.sort()).toEqual(["/proj/a", "/proj/b"]);
    const byId = Object.fromEntries(emits.map((e) => [e.id, e.md]));
    expect(byId["s1"].git?.branch).toBe("main");
    expect(byId["s2"].git?.branch).toBe("dev");
  });

  test("git result is TTL-cached — not re-probed on the very next tick", async () => {
    let gitCalls = 0;
    const { poller } = makePoller(
      [{ id: "s1", pid: 100 }],
      runners({
        runPs: async () => shellWithFg(),
        runCwds: async () => new Map([[200, "/proj/a"]]),
        runGit: async () => {
          gitCalls++;
          return gitInfo();
        },
      }),
    );

    await poller.runTickForTest();
    await poller.runTickForTest();
    // Two ticks well inside the 3 s gitTtlMs → exactly one probe.
    expect(gitCalls).toBe(1);
  });
});
