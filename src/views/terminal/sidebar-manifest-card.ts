// Re-export shim — the manifest-card renderer moved to
// `src/shared/sidebar-manifest-card.ts` in M14 of the web-mirror
// parity plan so both surfaces produce identical DOM. Native callers
// keep importing `renderManifestCard` from this path; behind the
// scenes we bind the native `createIcon` once so call-sites don't
// have to thread a `deps` argument.

import { createIcon, type IconName } from "./icons";
import {
  renderManifestCard as renderManifestCardShared,
  type ManifestCardProps,
  type ManifestIconName,
} from "../../shared/sidebar-manifest-card";

export type {
  ManifestAction,
  ManifestActionState,
  ManifestCardProps,
  ManifestIconName,
} from "../../shared/sidebar-manifest-card";

const nativeDeps = {
  // The native icon set is a strict superset of the manifest module's
  // ManifestIconName ⊂ IconName, so a direct cast is safe.
  createIcon: (name: ManifestIconName, cls: string, size: number) =>
    createIcon(name as IconName, cls, size),
};

export function renderManifestCard(props: ManifestCardProps): HTMLElement {
  return renderManifestCardShared(props, nativeDeps);
}
