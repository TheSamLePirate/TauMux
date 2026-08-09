/**
 * Hand the Atlas graph the host-owned stores it can't reach on its own.
 *
 * `atlas/` is deliberately free of τ-mux's singletons — that is what
 * lets it be rendered against fixtures. The cost is that somebody has to
 * introduce it to the ask-user queue. That introduction lives here
 * rather than in `views/terminal/index.ts`, which holds wiring, not
 * behaviour (module-size ratchet).
 */
import type { AskUserRequest } from "../../../shared/types";
import { setAtlasQuestionSource } from "./atlas";

export interface AtlasHostStores {
  askUser: {
    getAllPending(): AskUserRequest[];
    subscribe(fn: (change: unknown) => void): () => void;
  };
}

export function wireAtlasHost(stores: AtlasHostStores): void {
  setAtlasQuestionSource({
    pendingQuestions: () => stores.askUser.getAllPending(),
    onQuestionsChanged: (fn) => stores.askUser.subscribe(() => fn()),
  });
}
