/**
 * Path/byte classification for the file pane.
 *
 * The consequence of getting this wrong is visible and annoying in both
 * directions: call a PNG "text" and the user gets "Binary files cannot
 * be edited" on a file they can plainly see is a picture; call a source
 * file "image" and they get a broken-image icon instead of their code.
 */
import { describe, expect, test } from "bun:test";
import {
  contentKindForPath,
  extensionOf,
  fileUrlForPath,
  imageMimeForPath,
  isPreviewablePath,
  isSvgPath,
  sniffImageMime,
} from "../src/shared/file-kind";

describe("extensionOf", () => {
  test("plain extension", () => {
    expect(extensionOf("src/index.ts")).toBe("ts");
  });

  test("lowercases so .PNG matches", () => {
    expect(extensionOf("/tmp/Shot.PNG")).toBe("png");
  });

  test("a dotfile is a name, not an extension", () => {
    expect(extensionOf("/home/me/.bashrc")).toBe("");
    expect(extensionOf(".gitignore")).toBe("");
  });

  test("extensionless file", () => {
    expect(extensionOf("/usr/local/bin/ht")).toBe("");
  });

  test("only the last segment counts — a dotted directory is not an extension", () => {
    expect(extensionOf("/some.dir/Makefile")).toBe("");
  });

  test("multiple dots take the last", () => {
    expect(extensionOf("archive.tar.gz")).toBe("gz");
  });
});

describe("imageMimeForPath", () => {
  test.each([
    ["a.png", "image/png"],
    ["a.jpg", "image/jpeg"],
    ["a.jpeg", "image/jpeg"],
    ["a.gif", "image/gif"],
    ["a.webp", "image/webp"],
    ["a.avif", "image/avif"],
    ["a.ico", "image/x-icon"],
    ["a.heic", "image/heic"],
  ])("%s → %s", (path, mime) => {
    expect(imageMimeForPath(path)).toBe(mime);
  });

  test("source files are not images", () => {
    for (const p of ["index.ts", "style.css", "README.md", "Makefile"]) {
      expect(imageMimeForPath(p)).toBeNull();
    }
  });

  test("SVG is deliberately excluded — it gets its own kind", () => {
    expect(imageMimeForPath("logo.svg")).toBeNull();
    expect(isSvgPath("logo.svg")).toBe(true);
  });
});

describe("contentKindForPath", () => {
  test("returns null when the name is inconclusive, so bytes decide", () => {
    expect(contentKindForPath("screenshot")).toBeNull();
    expect(contentKindForPath("index.ts")).toBeNull();
  });

  test("names it when the extension is decisive", () => {
    expect(contentKindForPath("a.png")).toBe("image");
    expect(contentKindForPath("a.svg")).toBe("svg");
  });
});

describe("sniffImageMime", () => {
  const bytes = (...n: number[]) => new Uint8Array(n);

  test("PNG signature", () => {
    expect(
      sniffImageMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)),
    ).toBe("image/png");
  });

  test("JPEG signature", () => {
    expect(sniffImageMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
  });

  test("GIF87a and GIF89a", () => {
    expect(sniffImageMime(bytes(0x47, 0x49, 0x46, 0x38, 0x37, 0x61))).toBe(
      "image/gif",
    );
    expect(sniffImageMime(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe(
      "image/gif",
    );
  });

  test("WEBP needs the format tag at offset 8, not just RIFF", () => {
    // RIFF container that is NOT a webp (e.g. a WAV) must not match.
    const wav = bytes(
      0x52,
      0x49,
      0x46,
      0x46,
      0,
      0,
      0,
      0,
      0x57,
      0x41,
      0x56,
      0x45,
    );
    expect(sniffImageMime(wav)).toBeNull();
    const webp = bytes(
      0x52,
      0x49,
      0x46,
      0x46,
      0,
      0,
      0,
      0,
      0x57,
      0x45,
      0x42,
      0x50,
    );
    expect(sniffImageMime(webp)).toBe("image/webp");
  });

  test("AVIF and HEIC share the ftyp container but split on brand", () => {
    const ftyp = (brand: string) =>
      bytes(
        0,
        0,
        0,
        0x20,
        0x66,
        0x74,
        0x79,
        0x70,
        ...[...brand].map((c) => c.charCodeAt(0)),
      );
    expect(sniffImageMime(ftyp("avif"))).toBe("image/avif");
    expect(sniffImageMime(ftyp("heic"))).toBe("image/heic");
    expect(sniffImageMime(ftyp("mp42"))).toBeNull();
  });

  test("TIFF in both endiannesses", () => {
    expect(sniffImageMime(bytes(0x49, 0x49, 0x2a, 0x00))).toBe("image/tiff");
    expect(sniffImageMime(bytes(0x4d, 0x4d, 0x00, 0x2a))).toBe("image/tiff");
  });

  test("text and empty input are not images", () => {
    expect(sniffImageMime(new TextEncoder().encode("import x from 'y';"))).toBe(
      null,
    );
    expect(sniffImageMime(bytes())).toBeNull();
  });

  test("a truncated signature does not match", () => {
    // Three bytes of the PNG magic — a short read must not be mistaken
    // for a valid header.
    expect(sniffImageMime(bytes(0x89, 0x50, 0x4e))).toBeNull();
  });
});

describe("isPreviewablePath", () => {
  test("HTML has two valid readings, so it is previewable", () => {
    expect(isPreviewablePath("coverage/index.html")).toBe(true);
    expect(isPreviewablePath("a.htm")).toBe(true);
    expect(isPreviewablePath("a.xhtml")).toBe(true);
    expect(isPreviewablePath("/tmp/REPORT.HTML")).toBe(true);
  });

  test("source files and images are not", () => {
    for (const p of ["index.ts", "shot.png", "README.md", "Makefile"]) {
      expect(isPreviewablePath(p)).toBe(false);
    }
  });

  test("SVG is excluded — the file pane already renders it inline", () => {
    expect(isPreviewablePath("logo.svg")).toBe(false);
  });
});

describe("fileUrlForPath", () => {
  test("plain path", () => {
    expect(fileUrlForPath("/tmp/report/index.html")).toBe(
      "file:///tmp/report/index.html",
    );
  });

  test("escapes spaces", () => {
    expect(fileUrlForPath("/tmp/my report/a.html")).toBe(
      "file:///tmp/my%20report/a.html",
    );
  });

  test("escapes # and ? — in a filename they are characters, not URL syntax", () => {
    // encodeURI leaves both intact, which would truncate the path at a
    // fragment or query and open the wrong file (or nothing).
    expect(fileUrlForPath("/tmp/a#b.html")).toBe("file:///tmp/a%23b.html");
    expect(fileUrlForPath("/tmp/a?b.html")).toBe("file:///tmp/a%3Fb.html");
  });

  test("escapes a literal percent so it cannot be read as an escape", () => {
    expect(fileUrlForPath("/tmp/100%.html")).toBe("file:///tmp/100%25.html");
  });

  test("leaves slashes and colons readable", () => {
    expect(fileUrlForPath("/a/b:c/d.html")).toBe("file:///a/b:c/d.html");
  });
});
