import { describe, test, expect } from "bun:test";
import { openNativeProc, resetNativeProcForTest } from "../src/bun/native-proc";
import { createDefaultRunners, walkTree } from "../src/bun/surface-metadata";

/**
 * These tests are the safety net under `src/bun/native-proc.ts`.
 *
 * That module reads kernel structs by hardcoded byte offset. The offsets
 * were derived by probing live memory against `ps` / `lsof` output rather
 * than from headers, so the thing that keeps them honest is checking them
 * back against those same tools. If a future macOS reshuffles
 * `kinfo_proc`, `proc_taskinfo`, or `socket_fdinfo`, these fail loudly —
 * and in production `openNativeProc()`'s self-validation catches the same
 * drift and falls back to the subprocess runners.
 *
 * Everything is skipped off Darwin, where the module returns null by
 * design.
 */

const isDarwin = process.platform === "darwin";
const d = isDarwin ? describe : describe.skip;

/** Ground truth from the real `ps`, keyed by pid. */
async function psSnapshot(): Promise<
  Map<number, { ppid: number; pgid: number; stat: string; comm: string }>
> {
  const proc = Bun.spawn(
    ["ps", "-axo", "pid=,ppid=,pgid=,stat=,comm=", "-ww"],
    { stdout: "pipe", stderr: "ignore", env: { ...process.env, LC_ALL: "C" } },
  );
  const out = await new Response(proc.stdout).text();
  await proc.exited;

  const rows = new Map<
    number,
    { ppid: number; pgid: number; stat: string; comm: string }
  >();
  for (const line of out.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    rows.set(Number(m[1]), {
      ppid: Number(m[2]),
      pgid: Number(m[3]),
      stat: m[4]!,
      comm: m[5]!,
    });
  }
  return rows;
}

d("openNativeProc", () => {
  test("self-validation passes on this machine", () => {
    resetNativeProcForTest();
    const api = openNativeProc();
    // If this fails, the FFI layer isn't being exercised at all and every
    // assertion below would vacuously pass — so assert it explicitly.
    expect(api).not.toBeNull();
  });

  test("memoises the probe", () => {
    resetNativeProcForTest();
    expect(openNativeProc()).toBe(openNativeProc());
  });
});

d("native process table", () => {
  test("pid / ppid / pgid agree with ps for every shared pid", async () => {
    const api = openNativeProc()!;
    const rows = api.listProcesses();
    const truth = await psSnapshot();

    expect(rows.size).toBeGreaterThan(10);

    let compared = 0;
    for (const [pid, row] of rows) {
      const ref = truth.get(pid);
      if (!ref) continue; // process started or exited between the two reads
      compared++;
      expect(row.pid).toBe(pid);
      expect(row.ppid).toBe(ref.ppid);
      expect(row.pgid).toBe(ref.pgid);
    }
    // Guard against a comparison that silently matched nothing.
    expect(compared).toBeGreaterThan(10);
  });

  test("reports our own process correctly", () => {
    const api = openNativeProc()!;
    const self = api.listProcesses().get(process.pid);

    expect(self).toBeDefined();
    expect(self!.ppid).toBe(process.ppid);
    expect(self!.rssKb).toBeGreaterThan(0);
    // `command` resolves argv lazily via KERN_PROCARGS2; our own argv is
    // always readable and always contains the running script.
    expect(self!.command).toContain("bun");
    expect(self!.stat).not.toContain("Z");
  });

  test("the '+' flag marks exactly the foreground process group", async () => {
    const api = openNativeProc()!;
    const rows = api.listProcesses();
    const truth = await psSnapshot();

    // `findForegroundPid` reads nothing out of STAT but "+", so that flag
    // is the only part of the string that has to match ps.
    let checked = 0;
    for (const [pid, row] of rows) {
      const ref = truth.get(pid);
      if (!ref) continue;
      checked++;
      expect(row.stat.includes("+")).toBe(ref.stat.includes("+"));
    }
    expect(checked).toBeGreaterThan(10);
  });

  test("marks zombies with Z so walkTree filters them", async () => {
    // perl forks a child that exits immediately and never reaps it.
    const parent = Bun.spawn(
      ["/usr/bin/perl", "-e", "my $p = fork(); exit 0 if $p == 0; sleep 5;"],
      { stdout: "ignore", stderr: "ignore" },
    );
    try {
      await Bun.sleep(900);
      const truth = await psSnapshot();
      const zombiePid = [...truth.entries()].find(
        ([, r]) => r.stat.startsWith("Z") && r.ppid === parent.pid,
      )?.[0];

      // Don't fail the suite if the OS reaped it faster than we looked;
      // the assertion below only runs when there is something to assert.
      if (zombiePid === undefined) return;

      const api = openNativeProc()!;
      const rows = api.listProcesses();
      expect(rows.get(zombiePid)?.stat).toContain("Z");

      // The point of the flag: a defunct child must not appear in a
      // surface's process tree.
      const tree = walkTree(parent.pid, rows);
      expect(tree.some((n) => n.pid === zombiePid)).toBe(false);
    } finally {
      parent.kill();
      await parent.exited;
    }
  });
});

d("native cwd", () => {
  test("round-trips our own working directory", () => {
    const api = openNativeProc()!;
    expect(api.cwdOf(process.pid)).toBe(process.cwd());
  });

  test("tracks a child's cwd, not the parent's", async () => {
    const child = Bun.spawn(["/bin/sh", "-c", "cd /tmp && sleep 5"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    try {
      await Bun.sleep(400);
      const api = openNativeProc()!;
      const cwd = api.cwdOf(child.pid);
      // /tmp is a symlink to /private/tmp; the kernel reports the target.
      expect(cwd === "/tmp" || cwd === "/private/tmp").toBe(true);
    } finally {
      child.kill();
      await child.exited;
    }
  });

  test("returns null for a pid that does not exist", () => {
    const api = openNativeProc()!;
    expect(api.cwdOf(0x7ffffff)).toBeNull();
  });
});

d("native listening ports", () => {
  test("finds an IPv4 listener with the right address and proto", () => {
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: { data() {} },
    });
    try {
      const api = openNativeProc()!;
      const ports = api.listenersOf([process.pid]).get(process.pid) ?? [];
      const hit = ports.find((p) => p.port === server.port);

      expect(hit).toBeDefined();
      expect(hit!.address).toBe("127.0.0.1");
      expect(hit!.proto).toBe("tcp");
      expect(hit!.pid).toBe(process.pid);
    } finally {
      server.stop(true);
    }
  });

  test("renders a wildcard bind as '*', matching lsof", () => {
    const server = Bun.listen({
      hostname: "0.0.0.0",
      port: 0,
      socket: { data() {} },
    });
    try {
      const api = openNativeProc()!;
      const ports = api.listenersOf([process.pid]).get(process.pid) ?? [];
      expect(ports.find((p) => p.port === server.port)?.address).toBe("*");
    } finally {
      server.stop(true);
    }
  });

  test("ignores established connections — only LISTEN sockets count", async () => {
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: { data() {} },
    });
    try {
      await new Promise<void>((resolve) => {
        void Bun.connect({
          hostname: "127.0.0.1",
          port: server.port,
          socket: { open: () => resolve(), data() {} },
        });
      });
      await Bun.sleep(100);

      const api = openNativeProc()!;
      const ports = api.listenersOf([process.pid]).get(process.pid) ?? [];
      // The listener itself is reported exactly once; neither end of the
      // established pair adds an entry (the client's ephemeral port in
      // particular must not show up as a "listening" port).
      expect(ports.filter((p) => p.port === server.port).length).toBe(1);
    } finally {
      server.stop(true);
    }
  });

  test("returns an empty map for pids with no listeners", () => {
    const api = openNativeProc()!;
    expect(api.listenersOf([]).size).toBe(0);
    expect(api.listenersOf([0x7ffffff]).size).toBe(0);
  });
});

d("native CPU sampling", () => {
  test("reports a plausible share for a busy process after two samples", async () => {
    const api = openNativeProc()!;
    const busy = Bun.spawn(["/bin/sh", "-c", "while :; do :; done"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    try {
      await Bun.sleep(200);
      // First read establishes the baseline; CPU% needs a delta.
      expect(api.listProcesses().get(busy.pid)?.cpu).toBe(0);

      await Bun.sleep(600);
      const cpu = api.listProcesses().get(busy.pid)?.cpu ?? 0;
      // A spin loop pins one core. Allow slack for a loaded CI box but
      // require it to be clearly non-trivial.
      expect(cpu).toBeGreaterThan(20);
      expect(cpu).toBeLessThan(1000);
    } finally {
      busy.kill();
      await busy.exited;
    }
  });

  test("prunes samples for pids that have gone away", () => {
    const api = openNativeProc()!;
    api.listProcesses();
    // Pruning against a set containing only our own pid must not throw
    // and must leave our own accounting intact.
    api.pruneCpuSamples(new Set([process.pid]));
    expect(api.listProcesses().get(process.pid)).toBeDefined();
  });

  /**
   * §2.2 (full_app_review_2026-08.md) — regression test.
   *
   * `pruneCpuSamples` used to open with
   * `if (cpuSamples.size <= livePids.size) return`. That reads like a
   * cheap fast path but was true on every real tick and made the whole
   * function a no-op: the poller passes the WHOLE system process table
   * (~1000 pids) as `livePids`, while `cpuSamples` only gains entries for
   * pids whose lazy `.cpu`/`.rssKb` getter fired — a few dozen. So the
   * test has to prune against a LARGE live set, which is precisely the
   * shape the old guard short-circuited on.
   */
  test("prunes a dead pid even when the live set is the whole process table", async () => {
    const api = openNativeProc()!;

    const child = Bun.spawn(["sleep", "30"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    const childPid = child.pid;

    // Touch the lazy getter so a CPU sample is actually retained for it.
    const before = api.listProcesses();
    expect(before.get(childPid)).toBeDefined();
    void before.get(childPid)!.cpu;
    const sampledCount = api.cpuSampleCountForTest();
    expect(sampledCount).toBeGreaterThan(0);

    child.kill();
    await child.exited;

    // The real caller's argument: every live pid on the machine. This is
    // far larger than the sample map, so the old guard returned here.
    const rows = api.listProcesses();
    const livePids = new Set(rows.keys());
    expect(livePids.size).toBeGreaterThan(sampledCount);
    expect(livePids.has(childPid)).toBe(false);

    api.pruneCpuSamples(livePids);
    expect(api.cpuSampleCountForTest()).toBeLessThan(sampledCount);
  });
});

d("createDefaultRunners", () => {
  test("produces the same shape of data as the subprocess runners", async () => {
    const runners = createDefaultRunners();
    const rows = await runners.runPs();

    expect(rows).not.toBeNull();
    const self = rows!.get(process.pid);
    expect(self).toBeDefined();
    expect(typeof self!.command).toBe("string");
    expect(typeof self!.cpu).toBe("number");
    expect(typeof self!.rssKb).toBe("number");
    expect(typeof self!.stat).toBe("string");

    const cwds = await runners.runCwds([process.pid]);
    expect(cwds.get(process.pid)).toBe(process.cwd());

    expect((await runners.runCwds([])).size).toBe(0);
    expect((await runners.runListeningPorts([])).size).toBe(0);
  });

  test("walkTree over the native table finds our own spawned child", async () => {
    const child = Bun.spawn(["/bin/sh", "-c", "sleep 5"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    try {
      await Bun.sleep(300);
      const runners = createDefaultRunners();
      const rows = (await runners.runPs())!;
      const tree = walkTree(process.pid, rows);

      const node = tree.find((n) => n.pid === child.pid);
      expect(node).toBeDefined();
      expect(node!.ppid).toBe(process.pid);
      expect(node!.command).toContain("sleep");
    } finally {
      child.kill();
      await child.exited;
    }
  });
});
