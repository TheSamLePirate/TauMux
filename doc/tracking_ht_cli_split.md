# Tracking — §6.5: split the `bin/ht` monolith

Source: `doc/full_app_review_2026-05.md` §6.5 (medium, L).

## Problem

`bin/ht` was a 2,361-line single file: flag parsing + a ~980-line command→RPC
switch (`mapCommand`) + a browser submapper + the JSON-RPC transport + ~10
`main()` interceptors + a ~540-line presentation layer, all in one extensionless
file that **TypeScript and ESLint never checked** (no extension → excluded).

## Fix — structural extraction into testable `src/cli/` modules

Pulled the cohesive, pure pieces into `src/cli/` (now typechecked + linted +
unit-tested), leaving `bin/ht` a thin entry that wires them with the `main()`
interceptors and the presentation layer:

- `src/cli/types.ts` — `RpcCall` + `CliContext` ({ args, command, positional, flags }).
- `src/cli/flags.ts` — `parseFlags` + `unescapeText`.
- `src/cli/rpc-client.ts` — `SOCKET_PATH` / RPC-token resolution + `runRpc`.
- `src/cli/map-command.ts` — `BROWSER_HELP` + `mapBrowserSubcommand(ctx)` +
  `mapCommand(ctx)` (the ~980-line switch, now pure: takes the parsed context,
  returns the RPC call).

**`bin/ht`: 2,361 → 1,199 lines; 1,324 lines moved into 4 testable modules.**

The mappers were made pure by taking a `CliContext` instead of reading
module-level globals (`const { args, command, positional, flags } = ctx`). The
help/unknown-command branches still `console.log`/`process.exit` exactly as
before — behavior-preserving.

### Build path fix (the load-bearing detail)

Both `scripts/build-cli.ts` AND `scripts/post-build.ts` (the Electrobun
`postBuild` hook that runs on every `electrobun dev` / `build`) compiled `bin/ht`
from a **`tmpdir()` copy** — so the new `../src/cli/*` imports resolved against
`/tmp/...` and failed (`Could not resolve "../src/cli/flags"`). Changed both to
copy the temp entry **inside `bin/`** (`bin/.ht-*build-*.ts`, gitignored) so
`../src/cli` resolves identically to the real `bin/ht`; Bun then bundles the
modules into the standalone binary.

### Latent bugs surfaced + fixed

Typechecking the previously-unchecked code exposed (and we fixed):
- `runRpc` called `clearTimeout(timer)` where `timer` could be `null`.
- `map-command` used a forbidden `require("fs")` (→ `import { readFileSync }`),
  an unused `catch (e)`, and a dead `chatId` local in the telegram case.

## Scope NOT taken (deferred, documented)

- **`parseFlags` semantic fix.** The review flags genuine edge cases (a value
  starting with `--` read as boolean, multi-char short flags, negative-number
  values). Fixing them correctly needs a per-command declarative flag spec —
  behavior-changing and large. This split **preserves `parseFlags` exactly** and
  pins the known edge cases in tests as documented current behavior.
- `formatOutput` + the `main()` interceptors stay in `bin/ht` (deeply coupled to
  the presentation helpers + orchestration; lower value to move, higher risk).

## Verification

- `bun run typecheck` — clean (the extracted code is now checked for the first
  time). `bun run lint` — 0.
- `bun test` — 3065 pass / 0 fail (+21 new in `tests/cli-flags.test.ts` +
  `tests/cli-map-command.test.ts`); existing `bin-ht-help` / `ht-autocontinue` /
  `rpc-token` / `brand` CLI tests still green.
- `bun run build:cli` — standalone binary compiles (bundles 4 modules) and runs
  (`./build/ht-cli --help`).
- `bun start` — postBuild hook compiles + injects the CLI into the `.app`; the
  injected binary runs and resolves the bundled modules; socket listening, no
  errors.
- `./bin/ht --help` / `ht browser help` / `ht version` work in the dev shebang
  path.

## Commit

- bump: `bun run bump:patch`
- commit: (filled at commit time)
