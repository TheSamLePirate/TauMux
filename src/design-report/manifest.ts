/**
 * Manifest I/O — the committed `tests-e2e-baselines/manifest.json` is
 * the source of truth for "what shots are expected to exist". The
 * report and audit tools both consult it; the promote script writes it
 * atomically alongside the promoted PNGs.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Manifest, ManifestShot } from "./types";

export const MANIFEST_FILENAME = "manifest.json";

export function readManifest(path: string): Manifest | null {
  if (!existsSync(path)) return null;
  try {
    const obj = JSON.parse(readFileSync(path, "utf8")) as Manifest;
    if (!obj || !Array.isArray(obj.shots)) return null;
    return obj;
  } catch {
    return null;
  }
}

export function writeManifest(path: string, manifest: Manifest): void {
  writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
}

/** Index a manifest by canonical key for quick lookups. */
export function indexManifest(manifest: Manifest): Map<string, ManifestShot> {
  const map = new Map<string, ManifestShot>();
  for (const shot of manifest.shots) map.set(shot.key, shot);
  return map;
}
