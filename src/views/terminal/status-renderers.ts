// Re-export shim — the original 1641-line module moved to
// `src/shared/status-render.ts` in M12 of the web-mirror parity plan
// so the web client can render `ht set-status` chips through the same
// dispatcher as native. Existing imports from this path continue to
// work unchanged.

export {
  renderStatusEntry,
  reconcileChildren,
  type RenderEntryInput,
} from "../../shared/status-render";
