import { describe, expect, test } from "bun:test";
import { PNG } from "pngjs";
import {
  classifyShot,
  tryDecodePng,
  type DecodedPng,
} from "../../src/design-report/shot-classify";

/** Build an N×N solid RGBA PNG for use as a fixture. */
function solidPng(
  size: number,
  rgba: [number, number, number, number],
): DecodedPng {
  const png = new PNG({ width: size, height: size });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = rgba[0];
    png.data[i + 1] = rgba[1];
    png.data[i + 2] = rgba[2];
    png.data[i + 3] = rgba[3];
  }
  return { width: png.width, height: png.height, data: png.data as Buffer };
}

function mutate(png: DecodedPng, fraction: number): DecodedPng {
  const total = png.width * png.height;
  const flipCount = Math.round(total * fraction);
  const buf = Buffer.from(png.data);
  for (let i = 0; i < flipCount; i++) {
    const px = i * 4;
    // Flip the red channel — pixelmatch sees it as a changed pixel.
    buf[px] = 255 - (buf[px] ?? 0);
  }
  return { width: png.width, height: png.height, data: buf };
}

describe("classifyShot", () => {
  const base = solidPng(10, [0, 128, 0, 255]);

  test("identical current + baseline → ok, 0% diff", () => {
    const res = classifyShot({
      current: base,
      baseline: base,
      failFraction: 0.005,
      pxThreshold: 0.1,
    });
    expect(res.status).toBe("ok");
    expect(res.diffFraction).toBe(0);
    expect(res.diffPixels).toBe(0);
  });

  test("tiny drift under threshold → ok", () => {
    // Flip 0.3% of pixels — below the 0.5% gate.
    const current = mutate(base, 0.003);
    const res = classifyShot({
      current,
      baseline: base,
      failFraction: 0.005,
      pxThreshold: 0.1,
    });
    expect(res.status).toBe("ok");
    expect(res.diffFraction).toBeLessThan(0.005);
  });

  test("drift above threshold → over", () => {
    const current = mutate(base, 0.2);
    const res = classifyShot({
      current,
      baseline: base,
      failFraction: 0.005,
      pxThreshold: 0.1,
    });
    expect(res.status).toBe("over");
    expect(res.diffFraction).toBeGreaterThan(0.005);
  });

  test("dimension mismatch → dim-mismatch at 100%", () => {
    const other = solidPng(12, [0, 128, 0, 255]);
    const res = classifyShot({
      current: other,
      baseline: base,
      failFraction: 0.005,
      pxThreshold: 0.1,
    });
    expect(res.status).toBe("dim-mismatch");
    expect(res.diffFraction).toBe(1);
  });

  test("missing baseline → new", () => {
    const res = classifyShot({
      current: base,
      baseline: null,
      failFraction: 0.005,
      pxThreshold: 0.1,
    });
    expect(res.status).toBe("new");
    expect(res.diffFraction).toBeNull();
  });

  test("missing current → baseline-only", () => {
    const res = classifyShot({
      current: null,
      baseline: base,
      failFraction: 0.005,
      pxThreshold: 0.1,
    });
    expect(res.status).toBe("baseline-only");
  });

  test("neither → missing", () => {
    const res = classifyShot({
      current: null,
      baseline: null,
      failFraction: 0.005,
      pxThreshold: 0.1,
    });
    expect(res.status).toBe("missing");
  });
});

describe("tryDecodePng", () => {
  test("valid PNG → decoded", () => {
    const png = new PNG({ width: 2, height: 2 });
    const buf = PNG.sync.write(png);
    const decoded = tryDecodePng(buf);
    expect(decoded).not.toBeNull();
    expect(decoded!.width).toBe(2);
  });

  test("garbage → null", () => {
    const decoded = tryDecodePng(Buffer.from("not a png"));
    expect(decoded).toBeNull();
  });
});
