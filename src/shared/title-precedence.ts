/**
 * Who gets to name a pane.
 *
 * Three parties compete for one title: the user (a deliberate rename),
 * the program in the pane (OSC 0/2 — shells, vim, agent CLIs), and
 * layout restore replaying what was saved. Getting the precedence wrong
 * is invisible in the moment and maddening later: a pane that ignores
 * its program forever, or a deliberate rename that a shell prompt
 * overwrites a second after you typed it.
 *
 * The rule, stated once:
 *
 *   - A **user** rename always wins, and claims the title from then on.
 *   - A **program** rename applies only while the title is unclaimed.
 *   - A **restore** re-applies text without claiming anything: a saved
 *     title is only as authoritative as it was when saved, and the
 *     separate lock list carries that. Restore used to imply "user",
 *     which froze every restored pane's title for the whole session.
 */
export type TitleSource = "user" | "program" | "restore";

export interface TitleDecision {
  /** Write the new title. */
  apply: boolean;
  /** Mark the title as the user's from now on. */
  lock: boolean;
}

export function decideTitle(
  source: TitleSource,
  lockedByUser: boolean,
): TitleDecision {
  if (source === "user") return { apply: true, lock: true };
  if (source === "restore") return { apply: true, lock: false };
  return { apply: !lockedByUser, lock: false };
}
