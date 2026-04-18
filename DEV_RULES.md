# DEV_RULES

This file defines the development rules to enforce when coding in this repository.

## 1. Core priorities

- PTY correctness comes first.
- The PTY is the source of truth.
- Panels, metadata, browser panes, the web mirror, and agent panes are overlays or extensions and must never compromise terminal correctness.
- Prefer correctness, simplicity, and predictability over feature breadth.
- Prefer explicit architecture over clever shortcuts.

## 2. Required architecture mindset

- Follow `/Users/olivierveinand/Documents/DEV/architecture-guide.md` as the architectural standard where it fits this project.
- Adapt the principles to HyperTerm Canvas instead of forcing mismatched stack-specific patterns.
- Use contract-first thinking for subsystem boundaries and cross-process communication.
- Keep module boundaries explicit.
- Avoid barrel-export patterns for shared code.
- Prefer explicit imports and explicit ownership.
- Favor typed contracts over ad hoc payloads.
- Prefer small, focused modules with clear responsibilities.

## 3. Project-specific constraints

- No `node-pty`. Use `Bun.spawn` with `terminal: true`.
- No React in the webview.
- Use vanilla TypeScript + DOM APIs in the webview.
- Each content block/panel should remain its own DOM element.
- Keyboard input should follow the documented focus model.
- Browser panes are first-class surfaces, but they are not PTYs.
- Metadata collection must stay observational and must not affect PTY behavior.

## 4. Documentation-first workflow

Before changing code:

- Read the relevant documentation in `doc/` for the subsystem you are touching.
- Respect the authoritative subsystem docs before introducing new patterns.
- If a relevant doc exists, follow it.
- If the docs are outdated and the implementation must change, update the docs as part of the same change.

Important doc areas include:

- `doc/system-pty-session.md`
- `doc/system-process-metadata.md`
- `doc/system-rpc-socket.md`
- `doc/system-sideband-protocol.md`
- `doc/system-canvas-panels.md`
- `doc/system-browser-pane.md`
- `doc/system-webview-ui.md`
- `doc/system-webview-design-guidelines.md`
- `doc/system-pi-agent.md`
- `doc/native-e2e-plan.md`

## 5. Code organization rules

- Put code in the subsystem that owns it.
- Reuse existing managers, registries, and handler layers instead of bypassing them.
- Shared bun/webview contracts belong in `src/shared/`.
- Avoid duplicating utilities, parsers, type guards, and protocol helpers.
- When a second use appears, extract the shared logic.
- Keep parsers pure where possible.
- Use graceful degradation for background or auxiliary systems.

## 6. Error handling and cleanup

- Handle errors explicitly.
- Avoid throwing from callbacks and long-lived background observers when failure can be isolated.
- Log failures and degrade gracefully.
- Cleanup/finalizer logic must never throw.
- Register long-lived resources only after startup succeeds.
- Avoid leaked sessions, listeners, timers, sockets, browser surfaces, and panel state.

## 7. RPC, CLI, and protocol rules

- Extend the documented RPC/CLI architecture instead of creating parallel control paths.
- New socket or CLI features should be added through the proper RPC handler domain and `bin/ht` mapping.
- Prefer shared typed payloads for bun ↔ webview ↔ CLI boundaries.
- Follow the documented sideband protocol exactly for fd 3/4/5 interactions.
- Follow the documented browser pane and browser automation architecture for browser work.

## 8. UI and design rules

- Follow `doc/system-webview-ui.md` and `doc/system-webview-design-guidelines.md` for UI changes.
- Preserve the serious macOS-app feel of the interface.
- Reuse established classes, patterns, and managers for chips, panels, sidebars, overlays, and panes.
- Avoid one-off UI patterns when an established subsystem already exists.

## 9. TypeScript and code quality rules

- Keep TypeScript strict.
- Prefer explicit types and discriminated unions for protocol-like messages.
- Use `import type` where appropriate.
- Prefer interface-heavy design and minimal inheritance.
- Keep naming explicit and consistent with the subsystem.
- Avoid unnecessary dependencies.

## 10. Testing and verification rules

When something is modified, you must also update the surrounding quality surface.

That means:

- Update the tests impacted by the change.
- Add new tests when behavior changes or new behavior is introduced.
- Run the tests after the change.
- Run typechecking after the change.
- If UI behavior changes, run the app and verify it launches and the terminal still works.

Repository completion requirements:

- `bun test`
- `bun run typecheck`
- `bun start` after UI changes

Do not treat implementation as complete until the relevant verification has been done.

## 11. Documentation maintenance rules

When something is modified:

- Update the relevant documentation in `doc/`.
- Update README or top-level docs if user-facing behavior changed.
- Keep subsystem docs aligned with the actual implementation.
- Do not leave docs stale after changing architecture, workflow, commands, UI, or protocol behavior.

## 12. Skill maintenance rules

When something is modified:

- Update the relevant skill/documented workflow if it is now stale.
- If a workflow in `doc/SKILLS.md` or agent-oriented repo guidance changes, update it in the same change.
- If a reusable procedure becomes better, safer, or more complete, update the corresponding skill.
- Do not let skills drift behind the codebase.

## 13. Definition of done

A change is done only when all of the following are true:

- The implementation follows the relevant subsystem architecture.
- The relevant tests are updated.
- The tests have been run successfully.
- Typechecking has been run successfully.
- The docs have been updated.
- The relevant skill/workflow documentation has been updated.
- UI changes have been launched and sanity-checked with `bun start`.

## 14. Practical checklist

Before coding:

- Read the relevant `doc/*.md` file(s).
- Identify the owning subsystem.
- Identify the shared types/contracts affected.
- Decide where tests must change.
- Decide which docs/skills must change.

After coding:

- Update tests.
- Run tests.
- Run typecheck.
- Update docs.
- Update the relevant skill.
- If UI changed, run the app and sanity-check behavior.

## 15. Anti-patterns to avoid

- Bypassing subsystem managers with ad hoc state mutation
- Letting overlays or metadata become a source of truth
- Introducing undocumented parallel APIs
- Adding stale or unverified behavior without tests
- Merging code without updating docs
- Merging code without updating skills/workflows when they changed
- Letting cleanup throw
- Adding shortcuts that compromise terminal correctness

## 16. Guiding question

For every change, ask:

- What subsystem owns this?
- What doc defines it?
- What tests must change?
- What docs must change?
- What skill must change?
- Does this preserve PTY correctness and project predictability?
