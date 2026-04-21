// Pure parser for Cargo.toml — returns the subset of fields the UI
// surfaces (`CargoInfo`) or `null` on malformed input. Mirrors the
// signature/contract of parsePackageJson so both can back the same
// ManifestScanner shape.
//
// Parsing uses Bun.TOML (native, no npm dep). We accept both
// regular package manifests (`[package]` + optional `[[bin]]`) and
// virtual workspace roots (`[workspace]` with no `[package]`), since
// a Cargo workspace's top-level manifest is still worth showing even
// though it has no direct actions.

import { dirname } from "node:path";
import type { CargoInfo } from "../shared/types";

export function parseCargoToml(text: string, path: string): CargoInfo | null {
  let raw: unknown;
  try {
    raw = Bun.TOML.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const pkg = obj["package"];
  const pkgObj =
    pkg && typeof pkg === "object" && !Array.isArray(pkg)
      ? (pkg as Record<string, unknown>)
      : null;

  const workspace = obj["workspace"];
  const hasWorkspace =
    !!workspace && typeof workspace === "object" && !Array.isArray(workspace);
  const isWorkspace = hasWorkspace && !pkgObj;

  // A manifest with neither `[package]` nor `[workspace]` isn't a real
  // Cargo.toml for our purposes — refuse to surface it.
  if (!pkgObj && !isWorkspace) return null;

  const info: CargoInfo = {
    path,
    directory: dirname(path),
    binaries: [],
    features: [],
    isWorkspace,
  };

  if (pkgObj) {
    if (typeof pkgObj["name"] === "string") info.name = pkgObj["name"];
    if (typeof pkgObj["version"] === "string") info.version = pkgObj["version"];
    const edition = pkgObj["edition"];
    if (typeof edition === "string") info.edition = edition;
    else if (typeof edition === "number") info.edition = String(edition);
    if (typeof pkgObj["description"] === "string") {
      info.description = pkgObj["description"];
    }
  }

  // `[[bin]]` — Cargo emits this as an array of tables. Each row has
  // at least a `name`; `path` is optional and irrelevant to the UI.
  const binArr = obj["bin"];
  if (Array.isArray(binArr)) {
    for (const b of binArr) {
      if (!b || typeof b !== "object") continue;
      const name = (b as Record<string, unknown>)["name"];
      if (typeof name === "string") info.binaries.push(name);
    }
  }
  // Implicit default binary: when no `[[bin]]` is declared, `cargo run`
  // invokes `src/main.rs` as `<package.name>`. We don't verify
  // `src/main.rs` exists on disk (the parser is pure); the UI is free
  // to show an extra "run" action even if the project is lib-only —
  // cargo will just error out, same as a stale npm script.
  if (info.binaries.length === 0 && info.name && !info.isWorkspace) {
    info.binaries.push(info.name);
  }

  // `[features]` — keys are feature flag names. The values describe
  // transitive enables and aren't shown in the UI for now.
  const feat = obj["features"];
  if (feat && typeof feat === "object" && !Array.isArray(feat)) {
    info.features = Object.keys(feat as Record<string, unknown>);
  }

  return info;
}
