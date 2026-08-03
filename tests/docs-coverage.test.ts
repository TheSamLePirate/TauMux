/**
 * Documentation-drift gate.
 *
 * The website is a reference, so "the code is the source of truth" has to
 * be mechanically enforced or it rots: an audit on 2026-08-03 found 42
 * undocumented RPC methods, 22 undocumented CLI commands, 38 undocumented
 * settings, 11 documented settings that DID NOT EXIST, and 14 wrong
 * defaults. These tests make each of those classes fail CI instead.
 *
 * Scope note: this checks that every public surface is *mentioned* and
 * that documented defaults *match the code*. It cannot judge whether the
 * prose is good — that stays a human job.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SETTINGS } from "../src/shared/settings";

const ROOT = join(import.meta.dir, "..");
const DOCS = join(ROOT, "website-doc/src/content/docs");

function read(p: string): string {
  return readFileSync(join(ROOT, p), "utf-8");
}
function concat(dir: string): string {
  const d = join(DOCS, dir);
  return readdirSync(d)
    .filter((f) => f.endsWith(".md") || f.endsWith(".mdx"))
    .map((f) => readFileSync(join(d, f), "utf-8"))
    .join("\n");
}

/** Every JSON-RPC method registered under src/bun/rpc-handlers/. */
function registeredMethods(): string[] {
  const dir = join(ROOT, "src/bun/rpc-handlers");
  const out = new Set<string>();
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    const src = readFileSync(join(dir, f), "utf-8");
    for (const m of src.matchAll(/^\s*"([a-z_]+\.[a-z_]+)":/gm)) {
      if (!m[1]!.startsWith("__test.")) out.add(m[1]!);
    }
  }
  return [...out].sort();
}

/** Every top-level `ht` command. */
function cliCommands(): string[] {
  const src = read("src/cli/map-command.ts");
  const body = src.slice(src.indexOf("export function mapCommand"));
  const out = new Set<string>(
    [...body.matchAll(/^    case "([a-z0-9-]+)":/gm)].map((m) => m[1]!),
  );
  for (const m of read("bin/ht").matchAll(/command === "([a-z0-9-]+)"/g)) {
    out.add(m[1]!);
  }
  out.delete("-h");
  return [...out].sort();
}

/** Every AppSettings field. */
function settingsFields(): string[] {
  const src = read("src/shared/settings.ts");
  const i = src.indexOf("export interface AppSettings");
  const body = src.slice(i, src.indexOf("\n}", i));
  return [...body.matchAll(/^ {2}([a-zA-Z0-9_]+)\??:/gm)].map((m) => m[1]!);
}

for (const [lang, api, cli, settings] of [
  ["EN", "api", "cli", "configuration/settings.md"],
  ["FR", "fr/api", "fr/cli", "fr/configuration/settings.md"],
] as const) {
  describe(`docs coverage — ${lang}`, () => {
    test("every registered RPC method appears in the API reference", () => {
      const doc = concat(api);
      expect(registeredMethods().filter((m) => !doc.includes(m))).toEqual([]);
    });

    test("every `ht` command appears in the CLI reference", () => {
      const doc = concat(cli);
      expect(cliCommands().filter((c) => !doc.includes(c))).toEqual([]);
    });

    test("every settings field appears in the settings reference", () => {
      const doc = readFileSync(join(DOCS, settings), "utf-8");
      // `autoContinue` is documented as its nested `autoContinue.*` keys.
      const missing = settingsFields().filter(
        (f) => f !== "autoContinue" && !doc.includes(`\`${f}\``),
      );
      expect(missing).toEqual([]);
    });

    test("no documented setting is a ghost, and defaults match the code", () => {
      const doc = readFileSync(join(DOCS, settings), "utf-8");
      const ghosts: string[] = [];
      const wrong: string[] = [];
      for (const line of doc.split("\n")) {
        if (!line.startsWith("| `")) continue;
        // Split on unescaped pipes; drop the leading/trailing empties.
        const cells = line
          .split(/(?<!\\)\|/)
          .map((c) => c.trim())
          .slice(1, -1);
        const field = cells[0]?.replace(/`/g, "") ?? "";
        if (!field || field.includes(".")) continue; // nested autoContinue.*
        if (!(field in DEFAULT_SETTINGS)) {
          ghosts.push(field);
          continue;
        }
        const actual = (DEFAULT_SETTINGS as Record<string, unknown>)[field];
        const a = typeof actual === "string" ? actual : JSON.stringify(actual);
        const shown = (cells[2] ?? "").replace(/`/g, "").trim();
        // Prose stand-ins for large literals (the ANSI palette) are fine.
        if (!shown || /palette|TAU/i.test(shown)) continue;
        const norm = (x: string) =>
          x.replace(/^"|"$/g, "").replace(/\\\|/g, "|").trim();
        if (norm(shown) !== norm(a)) wrong.push(`${field}: "${shown}" ≠ ${a}`);
      }
      expect({ ghosts, wrong }).toEqual({ ghosts: [], wrong: [] });
    });
  });
}

describe("docs coverage — structure", () => {
  test("every surface kind is named in the concepts page", () => {
    const types = read("src/shared/types.ts");
    const union = types.slice(
      types.indexOf("export type SurfaceKind"),
      types.indexOf(";", types.indexOf("export type SurfaceKind")),
    );
    const kinds = [...union.matchAll(/"([a-z]+)"/g)].map((m) => m[1]!);
    expect(kinds.length).toBeGreaterThanOrEqual(7);
    for (const doc of [
      "website-doc/src/content/docs/concepts/workspaces-and-panes.md",
      "website-doc/src/content/docs/fr/concepts/workspaces-and-panes.md",
    ]) {
      const s = read(doc);
      expect(kinds.filter((k) => !s.includes(`\`${k}\``))).toEqual([]);
    }
  });

  test("EN and FR have the same page inventory", () => {
    const walk = (base: string, sub = ""): string[] => {
      const out: string[] = [];
      for (const e of readdirSync(join(base, sub), { withFileTypes: true })) {
        if (e.name === "fr") continue;
        if (e.isDirectory()) out.push(...walk(base, join(sub, e.name)));
        else if (e.name.endsWith(".md") || e.name.endsWith(".mdx")) {
          out.push(join(sub, e.name.replace(/\.mdx$/, ".md")));
        }
      }
      return out.sort();
    };
    const en = walk(DOCS);
    const fr = walk(join(DOCS, "fr"));
    expect(en.filter((p) => !fr.includes(p))).toEqual([]);
  });
});
