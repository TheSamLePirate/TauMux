/**
 * What kind of thing is at the end of a path.
 *
 * Clicking `src/index.ts:12` in terminal output and clicking
 * `~/Desktop/shot.png` are the same gesture, but they must land in two
 * different renderers — CodeMirror for one, an `<img>` for the other.
 * That decision is made here, once, so the bun reader and the webview
 * pane can never disagree about what a file is.
 *
 * Pure and DOM-free: no `node:fs`, no `node:path`. Both the main
 * process and the webview import it.
 */

/** What a pane should *do* with the bytes at a path. */
export type FileContentKind = "text" | "image" | "svg" | "binary";

/**
 * Extension → MIME, for the formats a WebKit `<img>` will actually
 * decode. Deliberately not "every image format": listing one we can't
 * render turns a readable "binary file" message into a broken-image
 * icon, which is a worse failure.
 *
 * SVG is absent on purpose — it is text *and* a picture, and gets its
 * own kind so the pane can offer both views.
 */
const IMAGE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: "image/png",
  apng: "image/apng",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jpe: "image/jpeg",
  jfif: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  cur: "image/x-icon",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
  tif: "image/tiff",
  tiff: "image/tiff",
};

/** Lowercased extension without the dot, or `""` for a dotfile /
 *  extensionless name. `.bashrc` is a name, not an extension — hence
 *  the `lastIndexOf > 0` guard against the leading-dot case. */
export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "";
  return name.slice(dot + 1).toLowerCase();
}

/** The MIME a `<img src="data:…">` needs, or null if the extension is
 *  not a renderable raster image. */
export function imageMimeForPath(path: string): string | null {
  return IMAGE_MIME_BY_EXTENSION[extensionOf(path)] ?? null;
}

export function isSvgPath(path: string): boolean {
  return extensionOf(path) === "svg";
}

/**
 * Magic-byte sniffing, for the files whose name tells us nothing.
 *
 * Screenshot tools and `curl -O` both produce extensionless images
 * often enough that name-only classification would show a user their
 * PNG as "Binary files cannot be edited". Sniffing is ~12 bytes of
 * work on a buffer we have already read, so it costs nothing to be
 * right here.
 *
 * Only formats that also appear in the extension table are detected —
 * we must be able to *render* what we claim to have found.
 */
export function sniffImageMime(bytes: Uint8Array): string | null {
  const b = bytes;
  const at = (i: number): number => b[i] ?? -1;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    at(0) === 0x89 &&
    at(1) === 0x50 &&
    at(2) === 0x4e &&
    at(3) === 0x47 &&
    at(4) === 0x0d &&
    at(5) === 0x0a &&
    at(6) === 0x1a &&
    at(7) === 0x0a
  ) {
    // APNG is a PNG whose 4th chunk-ish region carries `acTL`; the
    // distinction only matters for the MIME label, and `image/png`
    // animates APNG in WebKit anyway. Not worth scanning chunks.
    return "image/png";
  }

  // JPEG: FF D8 FF
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";

  // GIF87a / GIF89a
  if (
    at(0) === 0x47 &&
    at(1) === 0x49 &&
    at(2) === 0x46 &&
    at(3) === 0x38 &&
    (at(4) === 0x37 || at(4) === 0x39) &&
    at(5) === 0x61
  ) {
    return "image/gif";
  }

  // RIFF….WEBP — the format tag sits at offset 8, past the size field.
  if (
    at(0) === 0x52 &&
    at(1) === 0x49 &&
    at(2) === 0x46 &&
    at(3) === 0x46 &&
    at(8) === 0x57 &&
    at(9) === 0x45 &&
    at(10) === 0x42 &&
    at(11) === 0x50
  ) {
    return "image/webp";
  }

  // BMP: "BM"
  if (at(0) === 0x42 && at(1) === 0x4d) return "image/bmp";

  // ISO-BMFF `ftyp` box at offset 4, brand at offset 8. Covers AVIF and
  // HEIC/HEIF, which share the container.
  if (at(4) === 0x66 && at(5) === 0x74 && at(6) === 0x79 && at(7) === 0x70) {
    const brand = String.fromCharCode(at(8), at(9), at(10), at(11));
    if (brand === "avif" || brand === "avis") return "image/avif";
    if (brand.startsWith("hei") || brand === "mif1" || brand === "msf1") {
      return "image/heic";
    }
  }

  // TIFF: "II*\0" (little-endian) or "MM\0*" (big-endian)
  if (at(0) === 0x49 && at(1) === 0x49 && at(2) === 0x2a && at(3) === 0x00) {
    return "image/tiff";
  }
  if (at(0) === 0x4d && at(1) === 0x4d && at(2) === 0x00 && at(3) === 0x2a) {
    return "image/tiff";
  }

  return null;
}

/**
 * Extensions the browser pane can render as a document.
 *
 * These are the files with two equally valid readings: `coverage/
 * index.html` is something you want to *look at*, `src/index.html` is
 * something you want to *edit*, and the path alone cannot tell you
 * which. So neither wins by default — the file pane opens the source
 * and offers a Preview button, and ⌘-click on the terminal link goes
 * straight to the browser.
 *
 * SVG is absent: it is previewable, but the file pane already renders
 * it inline behind the sideband sandbox, so it needs no second home.
 */
const PREVIEWABLE_EXTENSIONS = new Set(["html", "htm", "xhtml"]);

export function isPreviewablePath(path: string): boolean {
  return PREVIEWABLE_EXTENSIONS.has(extensionOf(path));
}

/**
 * `file://` URL for an absolute path.
 *
 * `encodeURI` leaves `/` and `:` intact (so the path stays readable)
 * and escapes spaces and `%`, but it deliberately preserves `#` and
 * `?` as URL syntax — in a *filename* those are ordinary characters,
 * and leaving them would truncate the path at a fragment or query.
 */
export function fileUrlForPath(absolutePath: string): string {
  const escaped = encodeURI(absolutePath)
    .replace(/#/g, "%23")
    .replace(/\?/g, "%3F");
  return `file://${escaped}`;
}

/**
 * Name-only classification, for callers that have a path but no bytes
 * — the link tooltip and the probe, which must stay cheap enough to
 * run on hover.
 *
 * Returns `null` when the name is inconclusive; the caller either
 * sniffs the bytes (see `sniffImageMime`) or treats it as text.
 */
export function contentKindForPath(path: string): FileContentKind | null {
  if (isSvgPath(path)) return "svg";
  if (imageMimeForPath(path)) return "image";
  return null;
}
