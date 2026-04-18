/**
 * Shared types for the design-report toolchain. Kept free of runtime
 * imports so tests can exercise any helper without pulling in `pngjs`
 * or filesystem modules.
 */

export type Suite = "web" | "native";

export type ShotStatus =
  | "ok"
  | "over"
  | "new"
  | "baseline-only"
  | "missing"
  | "dim-mismatch"
  | "corrupt";

export interface Annotation {
  selector: string;
  found: boolean;
  rect?: { x: number; y: number; width: number; height: number };
  style?: Record<string, string>;
  textSample?: string;
}

export interface IndexEntry {
  timestamp?: string;
  suite?: Suite;
  spec: string;
  test: string;
  testSlug?: string;
  step: string;
  path: string;
  state?: Record<string, unknown>;
  annotate?: Annotation[] | Record<string, unknown>;
  terminal?: string;
  file?: string;
  line?: number;
}

export interface ReportShot {
  id: string;
  suite: Suite;
  spec: string;
  test: string;
  step: string;
  timestamp: string;
  shotRel: string;
  baselineRel: string | null;
  diffRel: string | null;
  diffFraction: number | null;
  diffPixels: number | null;
  totalPixels: number | null;
  width: number;
  height: number;
  state: Record<string, unknown>;
  annotations: Annotation[];
  terminal: string;
  file?: string;
  line?: number;
  status: ShotStatus;
}

export interface ReportSummary {
  generatedAt: string;
  failThreshold: number;
  pxThreshold: number;
  total: number;
  overCount: number;
  newCount: number;
  missingCount: number;
  baselineOnlyCount: number;
  corruptCount: number;
  dimMismatchCount: number;
  gate: {
    enabled: boolean;
    failed: boolean;
    failingStatuses: ShotStatus[];
    allowedNew: string[];
  };
}

export interface Manifest {
  /** When the manifest was written. */
  generatedAt: string;
  /** One entry per baselined shot. */
  shots: ManifestShot[];
}

export interface ManifestShot {
  /** Canonical key: `<suite>::<slug>`. */
  key: string;
  suite: Suite;
  /** Spec-derived slug — also the filename stem under `tests-e2e-baselines/<suite>/`. */
  slug: string;
  /** Source test title for human-readable audits. */
  test: string;
  /** Source step name. */
  step: string;
  /** PNG width × height at promotion time. Useful for audits. */
  width: number;
  height: number;
}

/** Build the canonical key used for deduping + baseline-matching. */
export function shotKey(suite: Suite, slug: string): string {
  return `${suite}::${slug}`;
}

/** Build the slug used both for the PNG filename and canonical keying. */
export function shotSlug(
  entry: Pick<IndexEntry, "spec" | "test" | "testSlug" | "step">,
): string {
  const slugify = (s: string): string =>
    s
      .replace(/\.spec\.ts$/, "")
      .replace(/[^a-z0-9._-]+/gi, "_")
      .slice(0, 80);
  const testSlug = entry.testSlug ?? entry.test;
  return `${slugify(entry.spec)}-${slugify(testSlug)}-${slugify(entry.step)}`;
}
