import { describe, test, expect } from "bun:test";
import {
  findForegroundPid,
  metadataEqual,
  parseCwds,
  parseGitStatusV2,
  parseListenAddress,
  parseListeningPorts,
  parsePs,
  parseShortstat,
  walkTree,
  type PsRow,
} from "../src/bun/surface-metadata";
import type { SurfaceMetadata } from "../src/shared/types";

describe("parsePs", () => {
  test("parses macOS-style ps output with header and leading whitespace", () => {
    const out = [
      "  PID  PPID  PGID STAT  %CPU    RSS ARGS",
      "    1     0     1 Ss     0.0   5120 /sbin/launchd",
      "  123     1   123 Ss     0.3   4096 -zsh",
      "  456   123   456 S+    12.4  52480 python3 -m http.server 8765",
    ].join("\n");
    const map = parsePs(out);
    expect(map.size).toBe(3);
    expect(map.get(1)?.command).toBe("/sbin/launchd");
    expect(map.get(456)?.command).toBe("python3 -m http.server 8765");
    expect(map.get(456)?.stat).toBe("S+");
    expect(map.get(456)?.pgid).toBe(456);
    expect(map.get(456)?.cpu).toBeCloseTo(12.4);
    expect(map.get(456)?.rssKb).toBe(52480);
  });

  test("accepts both '.' and ',' as decimal separator (locale-robust)", () => {
    const out = [
      "  PID  PPID  PGID STAT  %CPU    RSS ARGS",
      "  123     1   123 Ss     0,4  21440 /sbin/launchd",
      "  456     1   456 R+    12.75 52480 python3 -m http.server",
    ].join("\n");
    const map = parsePs(out);
    expect(map.get(123)?.cpu).toBeCloseTo(0.4);
    expect(map.get(456)?.cpu).toBeCloseTo(12.75);
  });

  test("ignores malformed lines", () => {
    const out = [
      "not a ps line",
      "  42    1    42 S     0.1   1024 ok",
      "another garbage line",
    ].join("\n");
    const map = parsePs(out);
    expect(map.size).toBe(1);
    expect(map.get(42)?.command).toBe("ok");
  });
});

describe("parseListenAddress", () => {
  test("IPv4 wildcard", () => {
    expect(parseListenAddress("*:8080")).toEqual({ address: "*", port: 8080 });
  });
  test("IPv4 specific", () => {
    expect(parseListenAddress("127.0.0.1:3000")).toEqual({
      address: "127.0.0.1",
      port: 3000,
    });
  });
  test("IPv6 wildcard with brackets stripped", () => {
    expect(parseListenAddress("[::]:8080")).toEqual({
      address: "::",
      port: 8080,
    });
  });
  test("IPv6 loopback with brackets stripped", () => {
    expect(parseListenAddress("[::1]:443")).toEqual({
      address: "::1",
      port: 443,
    });
  });
  test("invalid input returns null", () => {
    expect(parseListenAddress("garbage")).toBeNull();
    expect(parseListenAddress(":99999")).toBeNull();
  });
});

describe("parseListeningPorts", () => {
  test("groups multiple ports per pid, distinguishes v4/v6 by address", () => {
    const out = ["p1234", "PTCP", "n*:3000", "PTCP", "n[::1]:8080"].join("\n");
    const map = parseListeningPorts(out);
    const entries = map.get(1234) ?? [];
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      pid: 1234,
      port: 3000,
      proto: "tcp",
      address: "*",
    });
    expect(entries[1]).toEqual({
      pid: 1234,
      port: 8080,
      proto: "tcp6",
      address: "::1",
    });
  });

  test("handles multiple pids", () => {
    const out = ["p111", "PTCP", "n*:5000", "p222", "PTCP", "n*:6000"].join(
      "\n",
    );
    const map = parseListeningPorts(out);
    expect(map.get(111)?.[0].port).toBe(5000);
    expect(map.get(222)?.[0].port).toBe(6000);
  });

  test("empty output yields empty map", () => {
    expect(parseListeningPorts("").size).toBe(0);
  });

  test("real lsof output with f<fd> separators dedupes inherited sockets", () => {
    // lsof emits an f<fd> line per file descriptor, so a socket shared across
    // a fork appears as two records for the same port.
    const out = ["p649", "f8", "n*:7000", "f11", "n*:7000", "f12"].join("\n");
    const entries = parseListeningPorts(out).get(649) ?? [];
    expect(entries).toHaveLength(1);
    expect(entries[0].port).toBe(7000);
  });
});

describe("parseCwds", () => {
  test("one cwd per pid", () => {
    const out = ["p100", "n/home/alice", "p200", "n/tmp"].join("\n");
    const map = parseCwds(out);
    expect(map.get(100)).toBe("/home/alice");
    expect(map.get(200)).toBe("/tmp");
  });

  test("takes first n line per pid if repeated", () => {
    const out = ["p1", "n/first", "n/second"].join("\n");
    expect(parseCwds(out).get(1)).toBe("/first");
  });
});

describe("walkTree", () => {
  function makePs(rows: Partial<PsRow>[]): Map<number, PsRow> {
    const m = new Map<number, PsRow>();
    for (const r of rows) {
      const row: PsRow = {
        pid: r.pid!,
        ppid: r.ppid ?? 1,
        pgid: r.pgid ?? r.pid!,
        stat: r.stat ?? "S",
        cpu: r.cpu ?? 0,
        rssKb: r.rssKb ?? 0,
        command: r.command ?? "cmd",
      };
      m.set(row.pid, row);
    }
    return m;
  }

  test("pre-order traversal from root", () => {
    const ps = makePs([
      { pid: 10, ppid: 1, command: "zsh" },
      { pid: 20, ppid: 10, command: "node" },
      { pid: 30, ppid: 20, command: "child" },
      { pid: 40, ppid: 10, command: "vim" },
      { pid: 99, ppid: 2, command: "unrelated" },
    ]);
    const tree = walkTree(10, ps);
    expect(tree.map((n) => n.pid)).toEqual([10, 20, 30, 40]);
    expect(tree.map((n) => n.command)).toContain("node");
    expect(tree.find((n) => n.pid === 99)).toBeUndefined();
  });

  test("skips zombies from the tree", () => {
    const ps = makePs([
      { pid: 10, ppid: 1, stat: "Ss" },
      { pid: 20, ppid: 10, stat: "Z+", command: "defunct" },
      { pid: 30, ppid: 10, stat: "R", command: "alive" },
    ]);
    const tree = walkTree(10, ps);
    expect(tree.find((n) => n.pid === 20)).toBeUndefined();
    expect(tree.find((n) => n.pid === 30)).toBeDefined();
  });

  test("missing root yields empty tree", () => {
    expect(walkTree(999, makePs([{ pid: 1 }]))).toEqual([]);
  });
});

describe("findForegroundPid", () => {
  test("picks the '+' pgrp leader", () => {
    const ps = new Map<number, PsRow>([
      [
        10,
        {
          pid: 10,
          ppid: 1,
          pgid: 10,
          stat: "Ss",
          cpu: 0,
          rssKb: 0,
          command: "zsh",
        },
      ],
      [
        20,
        {
          pid: 20,
          ppid: 10,
          pgid: 20,
          stat: "S+",
          cpu: 0,
          rssKb: 0,
          command: "bun run dev",
        },
      ],
    ]);
    const tree = walkTree(10, ps);
    expect(findForegroundPid(tree, ps)).toBe(20);
  });

  test("falls back to shell pid when nothing is in the foreground", () => {
    const ps = new Map<number, PsRow>([
      [
        10,
        {
          pid: 10,
          ppid: 1,
          pgid: 10,
          stat: "Ss",
          cpu: 0,
          rssKb: 0,
          command: "zsh",
        },
      ],
    ]);
    expect(findForegroundPid(walkTree(10, ps), ps)).toBe(10);
  });
});

describe("metadataEqual", () => {
  const base: SurfaceMetadata = {
    pid: 10,
    foregroundPid: 10,
    cwd: "/tmp",
    tree: [{ pid: 10, ppid: 1, command: "zsh", cpu: 0, rssKb: 0 }],
    listeningPorts: [],
    git: null,
    updatedAt: 1,
  };

  test("equal when ignoring updatedAt", () => {
    expect(metadataEqual(base, { ...base, updatedAt: 999 })).toBe(true);
  });

  test("cwd change not equal", () => {
    expect(metadataEqual(base, { ...base, cwd: "/home" })).toBe(false);
  });

  test("tree command change not equal", () => {
    expect(
      metadataEqual(base, {
        ...base,
        tree: [{ pid: 10, ppid: 1, command: "bash", cpu: 0, rssKb: 0 }],
      }),
    ).toBe(false);
  });

  test("port added not equal", () => {
    expect(
      metadataEqual(base, {
        ...base,
        listeningPorts: [{ pid: 10, port: 3000, proto: "tcp", address: "*" }],
      }),
    ).toBe(false);
  });

  test("git null vs populated not equal", () => {
    expect(
      metadataEqual(base, {
        ...base,
        git: {
          branch: "main",
          head: "abc123",
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
        },
      }),
    ).toBe(false);
  });
});

describe("parseGitStatusV2", () => {
  test("empty input → null", () => {
    expect(parseGitStatusV2("")).toBeNull();
  });

  test("clean tracked branch", () => {
    const out = [
      "# branch.oid 1234567890abcdef1234567890abcdef12345678",
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +0 -0",
    ].join("\n");
    const info = parseGitStatusV2(out)!;
    expect(info.branch).toBe("main");
    expect(info.head).toBe("1234567890ab");
    expect(info.upstream).toBe("origin/main");
    expect(info.ahead).toBe(0);
    expect(info.behind).toBe(0);
    expect(info.staged).toBe(0);
    expect(info.unstaged).toBe(0);
    expect(info.detached).toBe(false);
  });

  test("detached HEAD", () => {
    const out = [
      "# branch.oid 1234567890abcdef1234567890abcdef12345678",
      "# branch.head (detached)",
    ].join("\n");
    const info = parseGitStatusV2(out)!;
    expect(info.branch).toBe("(detached)");
    expect(info.detached).toBe(true);
  });

  test("initial commit (no oid yet)", () => {
    const out = ["# branch.oid (initial)", "# branch.head main"].join("\n");
    const info = parseGitStatusV2(out)!;
    expect(info.head).toBe("");
    expect(info.branch).toBe("main");
  });

  test("ahead and behind", () => {
    const out = [
      "# branch.oid abcdef123456abcdef123456",
      "# branch.head feature",
      "# branch.upstream origin/feature",
      "# branch.ab +2 -5",
    ].join("\n");
    const info = parseGitStatusV2(out)!;
    expect(info.ahead).toBe(2);
    expect(info.behind).toBe(5);
  });

  test("mix of staged, unstaged, untracked, conflicts", () => {
    const out = [
      "# branch.oid abcdef123456",
      "# branch.head main",
      "1 M. N... 100644 100644 100644 abc def src/foo.ts",
      "1 .M N... 100644 100644 100644 abc def src/bar.ts",
      "1 MM N... 100644 100644 100644 abc def src/both.ts",
      "2 R. N... 100644 100644 100644 abc def R100 src/new.ts\tsrc/old.ts",
      "? new-file.ts",
      "? another.ts",
      "u UU N... 100644 100644 100644 100644 abc def hij src/conflict.ts",
    ].join("\n");
    const info = parseGitStatusV2(out)!;
    expect(info.staged).toBe(3);
    expect(info.unstaged).toBe(2);
    expect(info.untracked).toBe(2);
    expect(info.conflicts).toBe(1);
  });
});

describe("parseShortstat", () => {
  test("both insertions and deletions", () => {
    const { insertions, deletions } = parseShortstat(
      " 3 files changed, 42 insertions(+), 15 deletions(-)",
    );
    expect(insertions).toBe(42);
    expect(deletions).toBe(15);
  });

  test("only insertions", () => {
    const { insertions, deletions } = parseShortstat(
      " 1 file changed, 10 insertions(+)",
    );
    expect(insertions).toBe(10);
    expect(deletions).toBe(0);
  });

  test("only deletions", () => {
    const { insertions, deletions } = parseShortstat(
      " 1 file changed, 5 deletions(-)",
    );
    expect(insertions).toBe(0);
    expect(deletions).toBe(5);
  });

  test("singular insertion/deletion", () => {
    const { insertions, deletions } = parseShortstat(
      " 1 file changed, 1 insertion(+), 1 deletion(-)",
    );
    expect(insertions).toBe(1);
    expect(deletions).toBe(1);
  });

  test("empty output → zeros", () => {
    expect(parseShortstat("")).toEqual({ insertions: 0, deletions: 0 });
  });
});
