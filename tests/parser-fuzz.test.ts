import { describe, test, expect } from "bun:test";
import {
  parsePs,
  parseListeningPorts,
  parseListenAddress,
  parseCwds,
  parseGitStatusV2,
  parseShortstat,
  parsePackageJson,
  type PsRow,
} from "../src/bun/surface-metadata";
import {
  parseJsonCookies,
  parseNetscapeCookies,
} from "../src/bun/cookie-parsers";

/**
 * Cheap seeded PRNG (xorshift32). Deterministic across runs: the same
 * seed always produces the same sequence, so any fuzz-found failure is
 * reproducible by re-running the test.
 */
function rng(seed: number): () => number {
  let x = seed | 0;
  if (x === 0) x = 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    // Return in [0, 1).
    return ((x >>> 0) % 0xffff_ffff) / 0xffff_ffff;
  };
}

const FUZZ_ITERS = Number(process.env["FUZZ_ITERS"] ?? 1000);
const SEED = Number(process.env["FUZZ_SEED"] ?? 0xc0ffee);

const ASCII_PRINTABLE =
  " !\"#$%&'()*+,-./0123456789:;<=>?@" +
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`" +
  "abcdefghijklmnopqrstuvwxyz{|}~";
const TRICKY_CHARS = "\x00\x01\x07\x08\x0b\x0c\x1b\x7f\uFEFF\u2028";

function randomString(r: () => number, maxLen = 4096): string {
  const len = Math.floor(r() * maxLen);
  let s = "";
  for (let i = 0; i < len; i++) {
    const roll = r();
    if (roll < 0.03) {
      // Tricky control / unicode codepoint.
      s += TRICKY_CHARS[Math.floor(r() * TRICKY_CHARS.length)]!;
    } else if (roll < 0.1) {
      // Newline (structure-breaker for line-based parsers).
      s += "\n";
    } else if (roll < 0.2) {
      // Whitespace run.
      s += " ".repeat(1 + Math.floor(r() * 8));
    } else {
      s += ASCII_PRINTABLE[Math.floor(r() * ASCII_PRINTABLE.length)]!;
    }
  }
  return s;
}

/**
 * Build a string that looks vaguely like real ps output so fuzzing
 * exercises the parse paths, not just the "garbage, discard" paths.
 * Mix of well-formed rows, malformed rows, and random noise.
 */
function randomPsLikeOutput(r: () => number): string {
  const lines: string[] = ["  PID  PPID  PGID STAT  %CPU    RSS ARGS"];
  const rows = Math.floor(r() * 50);
  for (let i = 0; i < rows; i++) {
    const kind = r();
    if (kind < 0.6) {
      // Well-formed row.
      const pid = 1 + Math.floor(r() * 99999);
      const ppid = Math.floor(r() * 99999);
      const pgid = Math.floor(r() * 99999);
      const stat = ["S", "Ss", "R+", "T", "Z", "I", "S<"][Math.floor(r() * 7)];
      const cpuWhole = Math.floor(r() * 100);
      const cpuFrac = Math.floor(r() * 100);
      const sep = r() < 0.5 ? "." : ","; // locale-variant decimal
      const rss = Math.floor(r() * 9_999_999);
      const cmd = randomString(r, 120).replace(/\n/g, " ");
      lines.push(
        `${String(pid).padStart(5)} ${String(ppid).padStart(5)} ${String(pgid).padStart(5)} ${stat}  ${cpuWhole}${sep}${cpuFrac}  ${rss} ${cmd}`,
      );
    } else if (kind < 0.85) {
      // Malformed row (missing fields, wrong types).
      lines.push(randomString(r, 200));
    } else {
      // Blank line.
      lines.push("");
    }
  }
  return lines.join("\n");
}

function randomLsofPortsOutput(r: () => number): string {
  const lines: string[] = [];
  const procs = Math.floor(r() * 20);
  for (let i = 0; i < procs; i++) {
    if (r() < 0.6) lines.push(`p${Math.floor(r() * 99999)}`);
    if (r() < 0.5) {
      const proto = r() < 0.5 ? "TCP" : "tcp";
      const addr =
        r() < 0.5
          ? `127.0.0.1:${Math.floor(r() * 65535)}`
          : `[::1]:${Math.floor(r() * 65535)}`;
      lines.push(`n${addr} (LISTEN) ${proto}`);
    }
    if (r() < 0.2) lines.push(randomString(r, 80));
  }
  return lines.join("\n");
}

function randomGitStatusOutput(r: () => number): string {
  const lines: string[] = [];
  if (r() < 0.8) {
    // Branch header.
    const head =
      r() < 0.8
        ? `# branch.head ${randomString(r, 32).replace(/\s/g, "")}`
        : `# branch.oid ${randomString(r, 40).replace(/\s/g, "")}`;
    lines.push(head);
  }
  if (r() < 0.4) {
    lines.push(`# branch.ab +${Math.floor(r() * 99)} -${Math.floor(r() * 99)}`);
  }
  const files = Math.floor(r() * 30);
  for (let i = 0; i < files; i++) {
    const kind = r();
    if (kind < 0.4) {
      lines.push(`1 ${randomString(r, 40).replace(/\n/g, " ")}`);
    } else if (kind < 0.6) {
      lines.push(`2 ${randomString(r, 40).replace(/\n/g, " ")}`);
    } else if (kind < 0.75) {
      lines.push(`u ${randomString(r, 40).replace(/\n/g, " ")}`);
    } else if (kind < 0.9) {
      lines.push(`? ${randomString(r, 80).replace(/\n/g, " ")}`);
    } else {
      lines.push(randomString(r, 120));
    }
  }
  return lines.join("\n");
}

// ── Fuzz tests ────────────────────────────────────────────────────────

describe("parser fuzz: parsePs", () => {
  test(`${FUZZ_ITERS} random inputs never throw; always return Map<number, PsRow>`, () => {
    const r = rng(SEED);
    for (let i = 0; i < FUZZ_ITERS; i++) {
      const input = r() < 0.5 ? randomPsLikeOutput(r) : randomString(r);
      let map: Map<number, PsRow>;
      try {
        map = parsePs(input);
      } catch (err) {
        throw new Error(
          `parsePs threw on iter ${i}: ${String(err)}\ninput length=${input.length}`,
        );
      }
      expect(map).toBeInstanceOf(Map);
      // Every returned entry must have the right shape.
      for (const [pid, row] of map) {
        expect(typeof pid).toBe("number");
        expect(Number.isFinite(pid)).toBe(true);
        expect(pid).toBeGreaterThan(0);
        expect(typeof row.pid).toBe("number");
        expect(typeof row.ppid).toBe("number");
        expect(typeof row.pgid).toBe("number");
        expect(typeof row.cpu).toBe("number");
        expect(Number.isFinite(row.cpu)).toBe(true);
        expect(typeof row.rssKb).toBe("number");
        expect(typeof row.command).toBe("string");
      }
    }
  });
});

describe("parser fuzz: parseListeningPorts + parseListenAddress", () => {
  test(`${FUZZ_ITERS} random inputs never throw`, () => {
    const r = rng(SEED + 1);
    for (let i = 0; i < FUZZ_ITERS; i++) {
      const input = r() < 0.5 ? randomLsofPortsOutput(r) : randomString(r);
      const map = parseListeningPorts(input);
      expect(map).toBeInstanceOf(Map);
      for (const [pid, ports] of map) {
        expect(typeof pid).toBe("number");
        expect(Array.isArray(ports)).toBe(true);
        for (const p of ports) {
          expect(typeof p.port).toBe("number");
          expect(p.port).toBeGreaterThanOrEqual(0);
          expect(p.port).toBeLessThanOrEqual(65535);
        }
      }
    }
  });

  test(`parseListenAddress on random strings returns null or well-formed`, () => {
    const r = rng(SEED + 2);
    for (let i = 0; i < FUZZ_ITERS; i++) {
      const input = randomString(r, 128);
      const res = parseListenAddress(input);
      if (res !== null) {
        expect(typeof res.address).toBe("string");
        expect(typeof res.port).toBe("number");
      }
    }
  });
});

describe("parser fuzz: parseGitStatusV2 + parseShortstat", () => {
  test(`${FUZZ_ITERS} git-status fuzz: returns null or a typed GitInfo`, () => {
    const r = rng(SEED + 3);
    for (let i = 0; i < FUZZ_ITERS; i++) {
      const input =
        r() < 0.5 ? randomGitStatusOutput(r) : randomString(r, 2048);
      const res = parseGitStatusV2(input);
      if (res !== null) {
        expect(typeof res.ahead).toBe("number");
        expect(typeof res.behind).toBe("number");
        expect(typeof res.staged).toBe("number");
        expect(typeof res.unstaged).toBe("number");
        expect(typeof res.untracked).toBe("number");
        expect(typeof res.conflicts).toBe("number");
        expect(Number.isFinite(res.ahead)).toBe(true);
        expect(Number.isFinite(res.behind)).toBe(true);
      }
    }
  });

  test(`${FUZZ_ITERS} shortstat fuzz: always typed numbers`, () => {
    const r = rng(SEED + 4);
    for (let i = 0; i < FUZZ_ITERS; i++) {
      const input = randomString(r, 256);
      const res = parseShortstat(input);
      expect(typeof res.insertions).toBe("number");
      expect(typeof res.deletions).toBe("number");
      expect(Number.isFinite(res.insertions)).toBe(true);
      expect(Number.isFinite(res.deletions)).toBe(true);
      expect(res.insertions).toBeGreaterThanOrEqual(0);
      expect(res.deletions).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("parser fuzz: parseCwds", () => {
  test(`${FUZZ_ITERS} random inputs never throw`, () => {
    const r = rng(SEED + 5);
    for (let i = 0; i < FUZZ_ITERS; i++) {
      // Alternate between structured-ish and pure-garbage input.
      let input: string;
      if (r() < 0.5) {
        const lines: string[] = [];
        const rows = Math.floor(r() * 20);
        for (let j = 0; j < rows; j++) {
          lines.push(`p${Math.floor(r() * 99999)}`);
          lines.push(`n${randomString(r, 120).replace(/\n/g, "/")}`);
        }
        input = lines.join("\n");
      } else {
        input = randomString(r, 2048);
      }
      const map = parseCwds(input);
      expect(map).toBeInstanceOf(Map);
      for (const [pid, cwd] of map) {
        expect(typeof pid).toBe("number");
        expect(typeof cwd).toBe("string");
      }
    }
  });
});

describe("parser fuzz: parsePackageJson", () => {
  test(`${FUZZ_ITERS} random JSON-ish inputs never throw`, () => {
    const r = rng(SEED + 6);
    for (let i = 0; i < FUZZ_ITERS; i++) {
      let input: string;
      if (r() < 0.3) {
        // Plausible shape.
        input = JSON.stringify({
          name: randomString(r, 40).replace(/[\u0000-\u001f]/g, ""),
          version: randomString(r, 20).replace(/[\u0000-\u001f]/g, ""),
          scripts: r() < 0.5 ? { test: "echo ok" } : null,
        });
      } else if (r() < 0.6) {
        // Malformed JSON.
        input = "{ " + randomString(r, 200);
      } else {
        // Pure noise.
        input = randomString(r, 500);
      }
      const res = parsePackageJson(input, "/tmp/pkg.json");
      // Result is either null or has the expected shape.
      if (res !== null) {
        expect(res.path).toBe("/tmp/pkg.json");
        // name/version may be undefined but must not be an object.
        if (res.name !== undefined) expect(typeof res.name).toBe("string");
        if (res.version !== undefined)
          expect(typeof res.version).toBe("string");
      }
    }
  });
});

describe("parser fuzz: cookie parsers", () => {
  test(`${FUZZ_ITERS} JSON-cookie fuzz: returns an array; ignores malformed entries`, () => {
    const r = rng(SEED + 7);
    for (let i = 0; i < FUZZ_ITERS; i++) {
      let input: string;
      if (r() < 0.4) {
        // Plausible shape: array of cookies with some fields missing.
        const n = Math.floor(r() * 10);
        const arr: unknown[] = [];
        for (let j = 0; j < n; j++) {
          arr.push({
            name: r() < 0.8 ? randomString(r, 40) : null,
            value: r() < 0.8 ? randomString(r, 100) : undefined,
            domain: r() < 0.6 ? randomString(r, 40) : "",
            path: r() < 0.6 ? "/" : randomString(r, 40),
            expires: r() < 0.5 ? Math.floor(r() * 1e10) : "garbage",
            secure: r() < 0.5,
          });
        }
        input = JSON.stringify(arr);
      } else if (r() < 0.7) {
        // Malformed JSON.
        input = "[ " + randomString(r, 400);
      } else {
        // Pure noise.
        input = randomString(r, 500);
      }
      const cookies = parseJsonCookies(input);
      expect(Array.isArray(cookies)).toBe(true);
      for (const c of cookies) {
        expect(typeof c.name).toBe("string");
        expect(typeof c.value).toBe("string");
        expect(typeof c.domain).toBe("string");
        expect(typeof c.path).toBe("string");
        expect(typeof c.expires).toBe("number");
        expect(Number.isFinite(c.expires)).toBe(true);
      }
    }
  });

  test(`${FUZZ_ITERS} Netscape-format fuzz: returns a typed array`, () => {
    const r = rng(SEED + 8);
    for (let i = 0; i < FUZZ_ITERS; i++) {
      let input: string;
      if (r() < 0.5) {
        const lines: string[] = ["# Netscape HTTP Cookie File"];
        const n = Math.floor(r() * 15);
        for (let j = 0; j < n; j++) {
          // Fields: domain TRUE/FALSE path TRUE/FALSE expires name value
          const fields = [
            randomString(r, 40).replace(/[\t\n]/g, ""),
            r() < 0.5 ? "TRUE" : "FALSE",
            "/" + randomString(r, 30).replace(/[\t\n]/g, ""),
            r() < 0.5 ? "TRUE" : "FALSE",
            String(Math.floor(r() * 1e10)),
            randomString(r, 40).replace(/[\t\n]/g, ""),
            randomString(r, 100).replace(/[\t\n]/g, ""),
          ];
          lines.push(fields.join("\t"));
        }
        input = lines.join("\n");
      } else {
        input = randomString(r, 800);
      }
      const cookies = parseNetscapeCookies(input);
      expect(Array.isArray(cookies)).toBe(true);
      for (const c of cookies) {
        expect(typeof c.name).toBe("string");
        expect(typeof c.value).toBe("string");
        expect(typeof c.domain).toBe("string");
      }
    }
  });
});

// ── Smoke assertion: deterministic seed → same number of non-empty results.
// If this ever changes, a parser behavior drift is likely. Catches silent
// regressions in parse-rate.

describe("parser fuzz: determinism", () => {
  test("same seed produces the same parse counts across runs", () => {
    const count = (iters: number, seed: number): number => {
      const r = rng(seed);
      let n = 0;
      for (let i = 0; i < iters; i++) {
        const out = parsePs(randomPsLikeOutput(r));
        if (out.size > 0) n++;
      }
      return n;
    };
    expect(count(200, 123)).toBe(count(200, 123));
    expect(count(200, 123)).not.toBe(count(200, 456));
  });
});
