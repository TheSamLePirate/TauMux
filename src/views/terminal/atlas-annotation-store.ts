/**
 * Webview mirror of the bun `AtlasAnnotationStore`.
 *
 * Fed by the `atlasAnnotations` push. Same shape as the other mirrors
 * (`claude-session-store`, `plan-store`): a snapshot, one index, and a
 * subscribe hook.
 */
import type {
  AtlasAnnotation,
  AtlasAnnotationSnapshot,
  AtlasMark,
} from "../../bun/atlas-annotations";

type Listener = () => void;

let byTarget = new Map<string, AtlasAnnotation>();
let marks: AtlasMark[] = [];
const listeners = new Set<Listener>();

export function setAtlasAnnotations(snap: AtlasAnnotationSnapshot): void {
  byTarget = new Map(snap.annotations.map((a) => [a.target, a]));
  marks = snap.marks;
  for (const fn of listeners) {
    try {
      fn();
    } catch (err) {
      console.error("[atlas-annotations] listener failed", err);
    }
  }
}

export function annotationFor(target: string): AtlasAnnotation | null {
  return byTarget.get(target) ?? null;
}

export function pinnedTargets(): string[] {
  return [...byTarget.values()].filter((a) => a.pinned).map((a) => a.target);
}

export function atlasMarks(): readonly AtlasMark[] {
  return marks;
}

export function subscribeAtlasAnnotations(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Test seam. */
export function resetAtlasAnnotations(): void {
  byTarget = new Map();
  marks = [];
  listeners.clear();
}
