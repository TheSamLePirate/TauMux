// Extension App Platform — shared types (manifest, registry, and the
// frontend↔host postMessage bridge envelopes). Pure types + a couple of
// pure helpers so this can be imported by the bun main process, the webview,
// the `ht` CLI, AND each extension's `@tau-mux/sdk` without dragging in deps.
//
// See doc/design_extension_platform.md.

/** On-disk `manifest.json` for one extension. */
export interface ExtensionManifest {
  /** Stable id (reverse-DNS-ish). Stored in `surfaceExtensionIds` and used
   *  as the on-disk folder name + the web route `/extensions/<id>/`. */
  id: string;
  name: string;
  version: string;
  /** Emoji or short glyph shown in the pane bar / manage overlay. */
  icon?: string;
  description?: string;
  backend?: {
    /** Entry file run with `bun run <entry>` (relative to the ext dir). */
    entry?: string;
  };
  frontend?: {
    /** Dev command that starts the Vite server (run via `bun run`/shell). */
    dev?: string;
    /** Port the dev server listens on (the iframe points at this). */
    devPort?: number;
    /** Built static output dir (installed mode), relative to the ext dir. */
    dist?: string;
    /** HTML entry within `dist` (default `index.html`). */
    entry?: string;
  };
  /** Advisory only (no sandbox in v1) — surfaced in the manage overlay. */
  permissions?: string[];
}

/** Registry index persisted at `configDir/extensions-registry.json`. */
export interface ExtensionRegistry {
  version: 1;
  extensions: ExtensionRegistryEntry[];
}

export interface ExtensionRegistryEntry {
  id: string;
  /** Absolute path to the extension directory. */
  path: string;
  enabled: boolean;
  /** ISO-ish epoch ms; stamped by the host (kept out of pure scripts). */
  installedAt: number;
}

/** A fully resolved extension the manager knows about at runtime. */
export interface ExtensionDescriptor {
  manifest: ExtensionManifest;
  /** Absolute extension dir. */
  path: string;
  enabled: boolean;
  /** True when a built static frontend exists at `<path>/<frontend.dist>`. */
  hasBuild: boolean;
}

/** What the bun side hands the webview so the iframe knows where to point. */
export interface ExtensionSurfaceHandle {
  extensionId: string;
  /** Vite dev URL (HMR) when running in dev mode. */
  devUrl?: string;
  /** Static bundle URL (built mode), served by the web server. */
  bundleUrl?: string;
  /** Display name + icon for the pane bar. */
  title: string;
  icon?: string;
}

// ── Frontend ⇄ host postMessage bridge ───────────────────────────────────
//
// The iframe (frontend SDK) cannot open a unix socket, so it talks to the
// host via `window.parent.postMessage`. A relay in `extension-pane.ts`
// forwards to bun as `extensionFrontendMessage` and pushes host→frontend
// payloads back as `extensionBackendMessage`. The wire messages carry an
// opaque `payload`; these unions are the contract the SDK + relay + bun
// handler agree on.

/** Sentinel so the relay can distinguish SDK messages from stray postMessages. */
export const EXT_BRIDGE_TAG = "taumux-ext" as const;

/** Frontend → host. */
export type ExtensionFrontendPayload =
  /** Call a τ-mux control-surface RPC method (dispatched by the bun socket
   *  handler — does NOT touch the extension's own Bun backend). */
  | {
      kind: "rpc-request";
      id: string;
      method: string;
      params: Record<string, unknown>;
    }
  /** App-level message for the extension's OWN Bun backend process. */
  | { kind: "backend-message"; data: unknown }
  /** Frontend announces it has mounted (host may flush queued messages). */
  | { kind: "frontend-ready" };

/** Host → frontend. */
export type ExtensionHostPayload =
  /** Reply to a `rpc-request`. */
  | { kind: "rpc-response"; id: string; result?: unknown; error?: string }
  /** App-level message pushed from the extension's Bun backend. */
  | { kind: "backend-message"; data: unknown }
  /** Backend lifecycle so the frontend can show a "backend offline" state. */
  | { kind: "lifecycle"; state: "starting" | "ready" | "exited"; code?: number }
  /** Pane was resized (cheaper than an xterm fit; frontend may relayout). */
  | { kind: "resize"; width: number; height: number };

/** Validate an id is safe to use as a folder name / URL segment. */
export function isValidExtensionId(id: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id);
}
