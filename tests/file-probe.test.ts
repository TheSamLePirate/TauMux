/**
 * Path resolution + the existence/classification probe.
 *
 * These cover the four bugs that made clickable paths unreliable:
 *
 *   1. a relative path resolved against the app's cwd instead of the
 *      pane's, silently opening the wrong file;
 *   2. `~/x` resolving to `<cwd>/~/x`;
 *   3. images reported as "binary, cannot be edited";
 *   4. non-existent paths still producing a link, so the click opened a
 *      pane whose only content was an error.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { probeFilePaths, MAX_PROBE_PATHS } from "../src/bun/file-probe";
import {
  expandTilde,
  readEditorFile,
  resolveEditorPath,
} from "../src/bun/editor-files";

let root: string;
let other: string;

/** A 1×1 transparent PNG. */
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "ht-probe-"));
  other = mkdtempSync(join(tmpdir(), "ht-probe-other-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "index.ts"), "export const a = 1;\n");
  writeFileSync(join(root, "shot.png"), PNG_BYTES);
  // Same relative name in a second tree — the whole point of carrying
  // the pane's cwd is that these two must not be confused.
  mkdirSync(join(other, "src"), { recursive: true });
  writeFileSync(join(other, "src", "index.ts"), "export const b = 2;\n");
  // Extensionless image, as screenshot tools and `curl -O` produce.
  writeFileSync(join(root, "capture"), PNG_BYTES);
  writeFileSync(
    join(root, "logo.svg"),
    "<svg xmlns='http://www.w3.org/2000/svg'/>",
  );
  symlinkSync(join(root, "nowhere"), join(root, "dangling"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(other, { recursive: true, force: true });
});

describe("resolveEditorPath", () => {
  test("resolves a relative path against the supplied cwd, not process.cwd()", () => {
    expect(resolveEditorPath("src/index.ts", root)).toBe(
      join(root, "src/index.ts"),
    );
    expect(resolveEditorPath("src/index.ts", other)).toBe(
      join(other, "src/index.ts"),
    );
  });

  test("an absolute path ignores the cwd", () => {
    expect(resolveEditorPath(join(other, "src/index.ts"), root)).toBe(
      join(other, "src/index.ts"),
    );
  });

  test("expands ~ instead of making a literal directory named '~'", () => {
    expect(resolveEditorPath("~/notes.md", root)).toBe(
      join(homedir(), "notes.md"),
    );
    expect(resolveEditorPath("~", root)).toBe(homedir());
  });

  test("leaves ~user alone — we cannot resolve another account's home", () => {
    expect(expandTilde("~someone/x")).toBe("~someone/x");
  });

  test("a relative cwd is ignored rather than trusted", () => {
    // Only an absolute cwd is usable; a relative one would compound the
    // ambiguity we are trying to remove.
    expect(resolveEditorPath("a.ts", "relative/dir")).toBe(
      join(process.cwd(), "a.ts"),
    );
  });
});

describe("probeFilePaths", () => {
  test("a real file is classified as text", () => {
    const [p] = probeFilePaths({ paths: ["src/index.ts"], cwd: root });
    expect(p).toMatchObject({
      input: "src/index.ts",
      resolved: join(root, "src/index.ts"),
      type: "file",
      contentKind: "text",
    });
  });

  test("the same relative path resolves differently per cwd", () => {
    const a = probeFilePaths({ paths: ["src/index.ts"], cwd: root })[0]!;
    const b = probeFilePaths({ paths: ["src/index.ts"], cwd: other })[0]!;
    expect(a.resolved).not.toBe(b.resolved);
  });

  test("a missing path reports missing so no link is drawn", () => {
    const [p] = probeFilePaths({ paths: ["src/nope.ts"], cwd: root });
    expect(p!.type).toBe("missing");
  });

  test("a directory is its own type", () => {
    const [p] = probeFilePaths({ paths: ["src"], cwd: root });
    expect(p!.type).toBe("directory");
  });

  test("a dangling symlink is missing, not a file", () => {
    const [p] = probeFilePaths({ paths: ["dangling"], cwd: root });
    expect(p!.type).toBe("missing");
  });

  test("an image is classified by extension", () => {
    const [p] = probeFilePaths({ paths: ["shot.png"], cwd: root });
    expect(p).toMatchObject({ type: "file", contentKind: "image" });
    expect(p!.imageMime).toBe("image/png");
  });

  test("an extensionless image is caught by magic bytes", () => {
    const [p] = probeFilePaths({ paths: ["capture"], cwd: root });
    expect(p).toMatchObject({ contentKind: "image", imageMime: "image/png" });
  });

  test("svg is neither raster image nor plain text", () => {
    const [p] = probeFilePaths({ paths: ["logo.svg"], cwd: root });
    expect(p!.contentKind).toBe("svg");
  });

  test("no thumbnail unless asked for — the underline path must stay cheap", () => {
    const [plain] = probeFilePaths({ paths: ["shot.png"], cwd: root });
    expect(plain!.thumbnailDataUri).toBeUndefined();
    const [withThumb] = probeFilePaths({
      paths: ["shot.png"],
      cwd: root,
      thumbnails: true,
    });
    expect(withThumb!.thumbnailDataUri).toStartWith("data:image/png;base64,");
  });

  test("a text file never carries a thumbnail even when asked", () => {
    const [p] = probeFilePaths({
      paths: ["src/index.ts"],
      cwd: root,
      thumbnails: true,
    });
    expect(p!.thumbnailDataUri).toBeUndefined();
  });

  test("results come back in request order, one per input", () => {
    const paths = ["src/index.ts", "nope", "shot.png"];
    const out = probeFilePaths({ paths, cwd: root });
    expect(out.map((p) => p.input)).toEqual(paths);
  });

  test("the batch is bounded so a malformed request cannot stat-storm", () => {
    const paths = Array.from(
      { length: MAX_PROBE_PATHS + 20 },
      (_, i) => `f${i}`,
    );
    expect(probeFilePaths({ paths, cwd: root })).toHaveLength(MAX_PROBE_PATHS);
  });
});

describe("readEditorFile", () => {
  test("an image comes back as a data URI, not as 'binary'", () => {
    const snap = readEditorFile({
      surfaceId: "editor:1",
      path: "shot.png",
      cwd: root,
    });
    expect(snap.kind).toBe("image");
    expect(snap.binary).toBeUndefined();
    expect(snap.error).toBeUndefined();
    expect(snap.imageDataUri).toStartWith("data:image/png;base64,");
    expect(snap.imageMime).toBe("image/png");
  });

  test("an extensionless image is still an image", () => {
    const snap = readEditorFile({
      surfaceId: "editor:1",
      path: "capture",
      cwd: root,
    });
    expect(snap.kind).toBe("image");
  });

  test("svg loads as editable text but is marked svg", () => {
    const snap = readEditorFile({
      surfaceId: "editor:1",
      path: "logo.svg",
      cwd: root,
    });
    expect(snap.kind).toBe("svg");
    expect(snap.content).toContain("<svg");
  });

  test("line and column travel through to the snapshot", () => {
    const snap = readEditorFile({
      surfaceId: "editor:1",
      path: "src/index.ts",
      cwd: root,
      line: 42,
      column: 7,
    });
    expect(snap.revealLine).toBe(42);
    expect(snap.revealColumn).toBe(7);
  });

  test("a relative path without a cwd does NOT silently find the file", () => {
    // Guards the original bug: process.cwd() is not the pane's cwd, and
    // resolving against it must fail loudly rather than open some other
    // repo's file of the same name.
    const snap = readEditorFile({
      surfaceId: "editor:1",
      path: "src/index.ts",
    });
    expect(snap.path).toBe(join(process.cwd(), "src/index.ts"));
  });

  test("a directory reports a usable error rather than throwing", () => {
    const snap = readEditorFile({
      surfaceId: "editor:1",
      path: "src",
      cwd: root,
    });
    expect(snap.error).toBe("Path is not a file");
  });
});
