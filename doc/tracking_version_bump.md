# Tracking: version bump

Plan: align the app, website docs, and pi extension documentation around the same release version.

## Progress

- Inspected current version references in `package.json`, `package-lock.json`, `CLAUDE.md`, `README.md`, `pi-extensions/ht-bridge/README.md`, and website docs.
- Ran `bun run bump:patch`, moving τ-mux from the previous patch release to 0.2.81 through the repository bump script.
- Updated `package-lock.json` to match 0.2.81 because the bump script does not currently edit npm lockfiles.
- Updated `CLAUDE.md`, root `README.md`, pi extension README, and website pi integration docs (English + French) to describe ht-bridge as bundled with τ-mux / ht-bridge 0.2.81.
- Updated `doc/changes_to_document.md` to keep the docs backlog cleared after the website-doc updates.

## Deviations

- Used a patch bump because the user requested a version bump without specifying minor or major, and this is documentation/version alignment on top of the previous patch release.

## Issues

- None so far.

## Verification

- `bun run typecheck` passed.
- `bun test` passed: 1651 tests, 0 failures.
- `cd website-doc && bun run build` passed: 131 pages built.
- `bun start` not run because this change only updates version constants and documentation, not UI behavior.

## Commit

- Pending.
