/**
 * The link provider and the probe cache in front of it.
 *
 * The provider's contract is asymmetric on purpose: a missed link costs
 * a retype, but a link on a path that does not exist costs a click, a
 * new pane, and an error message. So most of what is asserted here is
 * what must NOT become a link.
 */
import { describe, expect, test } from "bun:test";
import {
  installFileLinks,
  type FileLinkTarget,
} from "../src/views/terminal/terminal-links";
import { FileLinkService } from "../src/views/terminal/file-link-service";
import type { ProbedPath } from "../src/shared/types";

function probed(input: string, over: Partial<ProbedPath> = {}): ProbedPath {
  return {
    input,
    resolved: `/repo/${input}`,
    type: "file",
    contentKind: "text",
    size: 10,
    mtimeMs: 1,
    ...over,
  };
}

type FakeLink = {
  text: string;
  range: { start: { x: number; y: number }; end: { x: number; y: number } };
  activate(e: MouseEvent, t: string): void;
};

/**
 * Minimal xterm stand-in. Rows are 1-based like xterm link rows;
 * `["text", { wrapped: true }]` marks a soft-wrap continuation.
 */
function fakeTerminal(...lines: (string | [string, { wrapped: boolean }])[]) {
  const parsed = lines.map((l) =>
    typeof l === "string"
      ? { text: l, isWrapped: false }
      : { text: l[0], isWrapped: l[1].wrapped },
  );
  let provider: {
    provideLinks(y: number, cb: (links: unknown[] | undefined) => void): void;
  } | null = null;
  return {
    term: {
      registerLinkProvider: (p: typeof provider) => {
        provider = p;
      },
      buffer: {
        active: {
          getLine: (i: number) => {
            const row = parsed[i];
            if (!row) return undefined;
            return {
              translateToString: () => row.text,
              isWrapped: row.isWrapped,
            };
          },
        },
      },
    },
    links(row = 1): Promise<FakeLink[] | undefined> {
      return new Promise((resolve) =>
        provider!.provideLinks(row, resolve as never),
      );
    },
  };
}

describe("installFileLinks", () => {
  test("underlines a reference whose file exists", async () => {
    const t = fakeTerminal("edited src/index.ts:12 ok");
    installFileLinks(t.term, {
      getCwd: () => "/repo",
      probe: async (paths) =>
        new Map(paths.map((p) => [p, probed(p)] as const)),
      open: () => {},
    });
    const links = await t.links();
    expect(links).toHaveLength(1);
    expect(links![0]!.text).toBe("src/index.ts:12");
  });

  test("does NOT underline a path that does not exist", async () => {
    const t = fakeTerminal("edited src/ghost.ts:12 ok");
    installFileLinks(t.term, {
      getCwd: () => "/repo",
      probe: async (paths) =>
        new Map(paths.map((p) => [p, probed(p, { type: "missing" })] as const)),
      open: () => {},
    });
    expect(await t.links()).toBeUndefined();
  });

  test("directories are linkable — the click reveals them in the sidebar", async () => {
    const t = fakeTerminal("see src/views/ for details");
    installFileLinks(t.term, {
      getCwd: () => "/repo",
      probe: async (paths) =>
        new Map(
          paths.map((p) => [p, probed(p, { type: "directory" })] as const),
        ),
      open: () => {},
    });
    expect(await t.links()).toHaveLength(1);
  });

  test("sockets and devices are never linkable — opening one can block", async () => {
    const t = fakeTerminal("bound /tmp/app.sock now");
    installFileLinks(t.term, {
      getCwd: () => "/repo",
      probe: async (paths) =>
        new Map(paths.map((p) => [p, probed(p, { type: "other" })] as const)),
      open: () => {},
    });
    expect(await t.links()).toBeUndefined();
  });

  test("passes the pane cwd for relative refs and omits it for absolute ones", async () => {
    const seen: (string | undefined)[] = [];
    const make = (text: string) => {
      const t = fakeTerminal(text);
      installFileLinks(t.term, {
        getCwd: () => "/repo",
        probe: async (paths, cwd) => {
          seen.push(cwd);
          return new Map(paths.map((p) => [p, probed(p)] as const));
        },
        open: () => {},
      });
      return t;
    };
    await make("at src/a.ts:1").links();
    await make("at /abs/b.ts:1").links();
    expect(seen).toEqual(["/repo", undefined]);
  });

  test("click carries the RESOLVED path plus line and column", async () => {
    let target: FileLinkTarget | null = null;
    const t = fakeTerminal("src/index.ts:2058:12");
    installFileLinks(t.term, {
      getCwd: () => "/repo",
      probe: async (paths) =>
        new Map(
          paths.map(
            (p) => [p, probed(p, { resolved: "/repo/src/index.ts" })] as const,
          ),
        ),
      open: (x) => {
        target = x;
      },
    });
    const links = await t.links();
    links![0]!.activate({ altKey: false } as MouseEvent, "");
    expect(target).toMatchObject({
      path: "/repo/src/index.ts",
      line: 2058,
      column: 12,
      forceNewPane: false,
    });
  });

  test("⌥click asks for a new pane", async () => {
    let target: FileLinkTarget | null = null;
    const t = fakeTerminal("src/index.ts");
    installFileLinks(t.term, {
      getCwd: () => "/repo",
      probe: async (paths) =>
        new Map(paths.map((p) => [p, probed(p)] as const)),
      open: (x) => {
        target = x;
      },
    });
    const links = await t.links();
    links![0]!.activate({ altKey: true } as MouseEvent, "");
    expect(target!.forceNewPane).toBe(true);
  });

  test("a rejected probe yields no links instead of throwing into xterm", async () => {
    const t = fakeTerminal("src/index.ts:1");
    installFileLinks(t.term, {
      getCwd: () => "/repo",
      probe: () => Promise.reject(new Error("bridge down")),
      open: () => {},
    });
    expect(await t.links()).toBeUndefined();
  });

  test("no link provider support is a no-op, not a crash", () => {
    expect(() =>
      installFileLinks({} as never, {
        getCwd: () => undefined,
        probe: async () => new Map(),
        open: () => {},
      }),
    ).not.toThrow();
  });
});

describe("installFileLinks — paths split across rows", () => {
  /** Only the fully-joined path exists on "disk". */
  function probeOnly(real: string) {
    return async (paths: string[]) =>
      new Map(
        paths.map(
          (p) =>
            [p, p === real ? probed(p, { resolved: p }) : probed(p, { type: "missing" })] as const,
        ),
      );
  }

  const CLAUDE_ROW_1 =
    "\u23fa Read(/private/tmp/claude-501/-Users-olivierveinand-Doc";
  const CLAUDE_ROW_2 = "  uments-DEV-crazyShell/scratchpad/base-split.png)";
  const CLAUDE_PATH =
    "/private/tmp/claude-501/-Users-olivierveinand-Documents-DEV-crazyShell/scratchpad/base-split.png";

  test("links a path Claude Code re-flowed onto an indented second line", async () => {
    const t = fakeTerminal(CLAUDE_ROW_1, CLAUDE_ROW_2);
    installFileLinks(t.term, {
      getCwd: () => "/repo",
      probe: probeOnly(CLAUDE_PATH),
      open: () => {},
    });
    const links = await t.links(1);
    expect(links).toHaveLength(1);
    expect(links![0]!.text).toContain("base-split.png");
  });

  test("hovering the SECOND line links it too — the bug that made it feel dead", async () => {
    const t = fakeTerminal(CLAUDE_ROW_1, CLAUDE_ROW_2);
    installFileLinks(t.term, {
      getCwd: () => "/repo",
      probe: probeOnly(CLAUDE_PATH),
      open: () => {},
    });
    expect(await t.links(2)).toHaveLength(1);
  });

  test("the underline range spans both rows", async () => {
    const t = fakeTerminal(CLAUDE_ROW_1, CLAUDE_ROW_2);
    installFileLinks(t.term, {
      getCwd: () => "/repo",
      probe: probeOnly(CLAUDE_PATH),
      open: () => {},
    });
    const [link] = (await t.links(1))!;
    expect(link!.range.start.y).toBe(1);
    expect(link!.range.end.y).toBe(2);
  });

  test("clicking either half opens the joined path", async () => {
    for (const row of [1, 2]) {
      let target: FileLinkTarget | null = null;
      const t = fakeTerminal(CLAUDE_ROW_1, CLAUDE_ROW_2);
      installFileLinks(t.term, {
        getCwd: () => "/repo",
        probe: probeOnly(CLAUDE_PATH),
        open: (x) => {
          target = x;
        },
      });
      const links = await t.links(row);
      links![0]!.activate({ altKey: false } as MouseEvent, "");
      expect(target!.path).toBe(CLAUDE_PATH);
    }
  });

  test("terminal soft wrap joins with no indent to strip", async () => {
    const t = fakeTerminal("/private/tmp/scratch/base-spl", [
      "it.png",
      { wrapped: true },
    ]);
    installFileLinks(t.term, {
      getCwd: () => "/repo",
      probe: probeOnly("/private/tmp/scratch/base-split.png"),
      open: () => {},
    });
    expect(await t.links(1)).toHaveLength(1);
  });

  test("when only the un-joined path exists, that is what gets linked", async () => {
    const t = fakeTerminal("edited src/a.ts", "  and something else");
    installFileLinks(t.term, {
      getCwd: () => "/repo",
      probe: probeOnly("src/a.ts"),
      open: () => {},
    });
    const links = await t.links(1);
    expect(links).toHaveLength(1);
    expect(links![0]!.text).toBe("src/a.ts");
    expect(links![0]!.range.end.y).toBe(1);
  });

  test("no link at all when neither reading exists", async () => {
    const t = fakeTerminal("/tmp/ghost", "  .png");
    installFileLinks(t.term, {
      getCwd: () => "/repo",
      probe: probeOnly("nothing-matches"),
      open: () => {},
    });
    expect(await t.links(1)).toBeUndefined();
  });

  test("the joined reading beats a real directory that is only its prefix", async () => {
    // /tmp/foo exists as a directory AND is the prefix of the real file
    // that continues onto row 2. The longer reading is the one meant.
    const t = fakeTerminal("/tmp/foo", "  bar.png");
    installFileLinks(t.term, {
      getCwd: () => "/repo",
      probe: async (paths: string[]) =>
        new Map(
          paths.map((p) => {
            if (p === "/tmp/foo") {
              return [p, probed(p, { type: "directory", resolved: p })] as const;
            }
            if (p === "/tmp/foobar.png") {
              return [p, probed(p, { resolved: p })] as const;
            }
            return [p, probed(p, { type: "missing" })] as const;
          }),
        ),
      open: () => {},
    });
    const links = await t.links(1);
    expect(links).toHaveLength(1);
    expect(links![0]!.text).toBe("/tmp/foobar.png");
  });
});

describe("installFileLinks — HTML gets a browser reading", () => {
  async function clickWith(mods: Partial<MouseEvent>) {
    let target: FileLinkTarget | null = null;
    const t = fakeTerminal("built dist/index.html ok");
    installFileLinks(t.term, {
      getCwd: () => "/repo",
      probe: async (paths) =>
        new Map(
          paths.map(
            (p) => [p, probed(p, { resolved: `/repo/${p}` })] as const,
          ),
        ),
      open: (x) => {
        target = x;
      },
    });
    const links = await t.links();
    links![0]!.activate({ altKey: false, ...mods } as MouseEvent, "");
    return target!;
  }

  test("a plain click does not ask for the browser", async () => {
    expect((await clickWith({})).preferBrowser).toBe(false);
  });

  test("⌘click asks for the browser", async () => {
    expect((await clickWith({ metaKey: true })).preferBrowser).toBe(true);
  });

  test("the two modifiers are independent", async () => {
    const t = await clickWith({ metaKey: true, altKey: true });
    expect(t.preferBrowser).toBe(true);
    expect(t.forceNewPane).toBe(true);
  });
});

describe("FileLinkService", () => {
  /** Collects requests so a test can answer them by hand. */
  function harness() {
    const sent: { requestId: string; paths: string[]; cwd?: string }[] = [];
    const svc = new FileLinkService((r) => sent.push(r));
    const answer = (i = 0, entries?: ProbedPath[]) => {
      const req = sent[i]!;
      svc.applyResult({
        requestId: req.requestId,
        entries: entries ?? req.paths.map((p) => probed(p)),
      });
    };
    return { sent, svc, answer };
  }

  test("caches a hit so a second hover costs no round trip", async () => {
    const { sent, svc, answer } = harness();
    const first = svc.probe(["a.ts"], "/repo");
    answer();
    await first;
    await svc.probe(["a.ts"], "/repo");
    expect(sent).toHaveLength(1);
  });

  test("the cache key includes cwd — the same name in two panes is two files", async () => {
    const { sent, svc, answer } = harness();
    const first = svc.probe(["a.ts"], "/repo");
    answer(0);
    await first;
    const second = svc.probe(["a.ts"], "/other");
    answer(1);
    await second;
    expect(sent).toHaveLength(2);
  });

  test("concurrent probes for the same path share one request", async () => {
    const { sent, svc, answer } = harness();
    const a = svc.probe(["a.ts"], "/repo");
    const b = svc.probe(["a.ts"], "/repo");
    expect(sent).toHaveLength(1);
    answer();
    expect((await a).get("a.ts")!.resolved).toBe(
      (await b).get("a.ts")!.resolved,
    );
  });

  test("duplicate paths in one row are requested once", async () => {
    const { sent, svc, answer } = harness();
    const p = svc.probe(["a.ts", "a.ts", "b.ts"], "/repo");
    expect(sent[0]!.paths).toEqual(["a.ts", "b.ts"]);
    answer();
    expect((await p).size).toBe(2);
  });

  test("a missing entry expires sooner than a hit — builds create files", async () => {
    let now = 1_000;
    const sent: { requestId: string; paths: string[] }[] = [];
    const svc = new FileLinkService((r) => sent.push(r), { now: () => now });
    const first = svc.probe(["new.ts"], "/repo");
    svc.applyResult({
      requestId: sent[0]!.requestId,
      entries: [probed("new.ts", { type: "missing" })],
    });
    await first;

    now += 2_000; // past the miss TTL, well inside the hit TTL
    void svc.probe(["new.ts"], "/repo");
    expect(sent).toHaveLength(2);
  });

  test("an answer that never arrives resolves as missing, not a hang", async () => {
    const svc = new FileLinkService(() => {}, { timeoutMs: 10 });
    // No applyResult is ever called; the request times out internally.
    const result = await svc.probe(["a.ts"], "/repo");
    expect(result.get("a.ts")!.type).toBe("missing");
  });

  test("a throwing sender settles immediately rather than waiting out the timeout", async () => {
    const svc = new FileLinkService(() => {
      throw new Error("bridge torn down");
    });
    const result = await svc.probe(["a.ts"], "/repo");
    expect(result.get("a.ts")!.type).toBe("missing");
  });

  test("a stale answer for a timed-out request is ignored", () => {
    const svc = new FileLinkService(() => {});
    expect(() =>
      svc.applyResult({ requestId: "never-sent", entries: [] }),
    ).not.toThrow();
  });

  test("entries are matched by input, not by position", async () => {
    const { sent, svc } = harness();
    const p = svc.probe(["a.ts", "b.ts"], "/repo");
    // Answer out of order, as a reordering bun-side change could.
    svc.applyResult({
      requestId: sent[0]!.requestId,
      entries: [
        probed("b.ts", { resolved: "/repo/B" }),
        probed("a.ts", { resolved: "/repo/A" }),
      ],
    });
    const map = await p;
    expect(map.get("a.ts")!.resolved).toBe("/repo/A");
    expect(map.get("b.ts")!.resolved).toBe("/repo/B");
  });

  test("thumbnails are a separate request and do not block the cheap probe", async () => {
    const { sent, svc } = harness();
    void svc.thumbnail("/repo/a.png");
    expect(sent[0]).toMatchObject({ thumbnails: true });
    // The metadata slot is still free, so an existence check goes out
    // rather than waiting on the image read.
    void svc.probe(["a.png"], "/repo");
    expect(sent).toHaveLength(2);
  });
});
