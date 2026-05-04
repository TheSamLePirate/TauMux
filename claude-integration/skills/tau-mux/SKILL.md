---
name: tau-mux
description: Use when running Claude Code inside τ-mux (the hybrid terminal emulator with workspace sidebar, plan panel, ask-user modals, browser panes). Activates on multi-step plans, user questions, long-running processes (dev servers / watchers / log tails), browser verification, screenshots, completion signaling, and risky bash. When `$HT_SURFACE` or `$HYPERTERM_PROTOCOL_VERSION` is set, prefer the structured `ht` CLI surfaces (`ht ask`, `ht plan`, `ht notify`, `ht new-split` + `ht send`, `ht browser`, `ht screenshot`, `ht set-status`) over plain terminal output. This skill mirrors the behaviour the pi-extensions/ht-bridge installs into the pi coding agent — it is the Claude Code analog.
---

# τ-mux integration

You are running inside τ-mux, a hybrid terminal emulator with a workspace
sidebar, a plan panel, ask-user modals, browser panes, screenshots, and a
sideband notification stream. The `ht` CLI is the interface to all of it.

## When to use this skill

Activate every time **all** of these are true:

1. `$HT_SURFACE` (or `$HYPERTERM_PROTOCOL_VERSION`) is set in the environment.
2. `ht` is on `$PATH`.

If either is missing, fall back to plain terminal output — every command in
this skill becomes a no-op outside τ-mux. Detect with:

```bash
[ -n "${HT_SURFACE:-}" ] && command -v ht >/dev/null
```

The complementary runtime hooks under `~/.claude/scripts/ht-bridge/` already
handle the **active label pill**, **cost / context ticker**, and the
**idle / permission** sidebar pills automatically — you don't drive those.
Your job is to use the *interactive* surfaces (plans, ask-user, notify,
splits, browser, screenshots) instead of plain text where it would be a
better experience for the user.

## Plan workflow — review-first

For any task with **3 or more discrete steps**, do *not* publish a plan
directly to the sidebar. Instead:

1. **Write the detailed plan to a markdown file first.**
   ```bash
   mkdir -p .claude/plans
   # write the human-readable plan to:
   #   .claude/plans/<plan-name>.md
   # Use the Write tool, not heredoc.
   ```
   The markdown file is the durable source of truth — durable across resumes,
   forks, and compactions. The sidebar plan is just a glanceable view.

2. **Show the file path to the user and ask for accept / decline / discuss
   before publishing the sidebar steps.** Use `ht ask choice`:
   ```bash
   ht ask choice \
     --title "Plan ready: <plan-name>" \
     --body "Saved to .claude/plans/<plan-name>.md — review then choose." \
     --choices "accept:Accept,decline:Decline,discuss:Discuss"
   ```
   - `accept` → publish concise steps with `ht plan set`.
   - `decline` → keep the markdown file for reference, do not publish.
   - `discuss` → ask the user for revisions, write a v2 plan, repeat.

3. **Publish the concise sidebar plan with `ht plan set`** (only on accept):
   ```bash
   ht plan set --json '[
     {"id":"M1","title":"Survey existing usage","state":"active"},
     {"id":"M2","title":"Land the migration","state":"pending"},
     {"id":"M3","title":"Backfill + tests","state":"pending"}
   ]'
   ```
   Steps must be derived from the markdown plan, not invented separately.
   Keep titles short — the sidebar is narrow.

4. **Update steps as you progress:**
   ```bash
   ht plan update M1 --state done
   ht plan update M2 --state active
   ht plan complete            # all steps done → confetti
   ht plan clear               # plan abandoned → clear the panel
   ```

5. **On resume** — if `.claude/plans/<plan-name>.md` already exists for the
   current task, read it first and continue from where it left off rather
   than starting a fresh plan.

## Ask the user (structured)

When you need a decision from the user, prefer `ht ask` over asking in
your reply. The user gets an in-app modal (and Telegram forward when
configured), which is a much better UX than scrolling the terminal:

```bash
# yes/no
ht ask yesno --title "Run install?" --body "Lockfile changed"
# → prints "yes" or "no", exits 0/1

# pick one of N
ht ask choice --title "Branch" --choices "main:Main,dev:Develop,feature/x:Feature"
# → prints the chosen id

# free-form text
ht ask text --title "Commit message" --default "wip: refactor auth"
# → prints the typed string

# two-step destructive command gate (see "Bash safety" below)
ht ask confirm-command --command "rm -rf ./build" --reason "stale artefacts"
```

**Don't ask for trivial choices you can decide yourself.** Reserve `ht ask`
for branch points the user genuinely owns: framework choice, "okay to
delete X?", commit messages, login flows.

## Notify on milestones

When a long task finishes — or you hit a blocker that needs the user to
come back — fire `ht notify`:

```bash
ht notify --title "Tests green" --body "324/324 passed in 18s" --sound finish
ht notify --title "Build failed" --body "TypeScript: 5 errors in src/auth/" --level error
ht notify --title "Awaiting review" --body "PR #123 ready" --subtitle "Claude Code"
```

Rules:
- **Once or twice per task, max.** Notifications are interruption-cost; don't
  fire one on every step.
- Title carries the headline; body carries the metadata (counts, durations).
- `--level error` for failures, default for success.
- The runtime hook already fires a notification on `Stop`. You only fire
  intermediate ones — milestones, blockers, and explicit "I'm done" beats.

## Long-running commands → split, don't inline

Anything that keeps running after the command starts belongs in a sibling
split, not in your `bash` tool. The user can watch it live, and you stay
unblocked. This includes:

- Dev servers (`bun run dev`, `npm run dev`, `cargo run`, etc.)
- File watchers (`bun --watch`, `nodemon`, `tsc --watch`)
- Log tails (`tail -f`, `docker logs -f`, `kubectl logs -f`)
- Test watchers (`bun test --watch`, `vitest`)
- Build daemons (`webpack --watch`)

Pattern:

```bash
# 1. Open the split. Output gives you the new surface id.
ht new-split right            # or down, up, left

# 2. Send the command. The "\n" is required to actually press enter.
ht send --surface surface:7 "bun run dev\n"

# 3. (Optional) Mirror progress to the sidebar so the user has a glanceable view.
ht set-status devserver "running" --icon bolt --color "#a6e3a1"

# 4. (Optional) Read the split's screen back when you need to verify state.
ht read-screen --surface surface:7 --lines 30
```

For one-shot commands you need to read the output of (compile, lint, run a
single script) keep using your `bash` tool. The split is for long-lived
processes the user wants to *see*.

## Browser verification

For UI / docs / running-app verification, drive a τ-mux browser pane
instead of asking the user to open a browser:

```bash
# Open in a sibling split.
ht browser open-split http://localhost:3000

# Drive it.
ht browser browser:1 wait --selector "#dashboard" --timeout-ms 15000
ht browser browser:1 click "button[type='submit']"
ht browser browser:1 fill "#email" "user@example.com"
ht browser browser:1 get text "#welcome"
ht browser browser:1 is visible "#dashboard"
ht browser browser:1 eval "await fetch('/api/health').then(r => r.json())"

# Inspect what happened.
ht browser browser:1 console        # tail console logs
ht browser browser:1 errors         # tail JS errors
ht browser browser:1 snapshot       # accessibility tree
```

Use this for: smoke testing routes after a change, scraping live data
during research, taking visual evidence into a screenshot, and verifying
auth/session flows.

## Screenshots for evidence

When the user asks "did the layout break?" / "what does it look like
now?" — capture a screenshot, then `Read` the file back so you can see
what they see:

```bash
ht screenshot --out /tmp/ui-after.png
ht screenshot --surface surface:7 --out /tmp/devserver.png   # specific pane
# Then: Read tool on /tmp/ui-after.png
```

This is dramatically better than guessing from CSS diffs.

## Sidebar status pills (your own keys)

For in-progress signals during a multi-step task — anything you'd otherwise
print to the terminal — push to the sidebar instead. The runtime ht-bridge
owns the `Claude` (active label) and `cc` (cost ticker) keys; pick a
different key for your own status:

```bash
ht set-status build  "compiling"     --icon hammer --color "#7aa2f7"
ht set-status tests  "12/30 passed"  --icon flask  --color "#7aa2f7"
ht set-progress 0.42 --label "Tests"

# Clear when done.
ht clear-status build
ht clear-progress
```

**Don't reuse the keys `Claude` or `cc`** — those are owned by the runtime
hook that ships in `~/.claude/scripts/ht-bridge/` and will fight you.

## Bash safety

Before any irreversible / destructive command, gate it through
`ht ask confirm-command`. The modal is two-step (acknowledge → run) so
the user has time to read it:

```bash
ht ask confirm-command \
  --command "git push --force origin main" \
  --reason "rewriting history after rebase"
# Exits 0 if confirmed, non-zero on decline → don't run the command.
```

Apply this gate to:
- `rm -rf` (anything outside `node_modules`, `dist`, `.next`, `build`)
- `git push --force`, `git reset --hard`, `git branch -D`, `git clean -f`
- `sudo`, `mkfs`, `dd`, `chown -R`, `chmod -R`
- Any `psql`/`mongo`/`redis-cli` `DROP|DELETE|TRUNCATE`
- Bulk file operations on user data outside the working directory

For routine commands (`bun test`, `git commit`, `ls`, etc.) **do not** gate
— that's just noise.

## Quick reference

| Need                                  | Command                                              |
| ------------------------------------- | ---------------------------------------------------- |
| Multi-step plan                       | write `.claude/plans/<name>.md` → `ht ask choice` → `ht plan set` |
| Yes/no question                       | `ht ask yesno --title "…" --body "…"`                |
| Pick one of N                         | `ht ask choice --title "…" --choices "id:label,…"`  |
| Free-form input                       | `ht ask text --title "…" --default "…"`              |
| Confirm destructive command           | `ht ask confirm-command --command "…" --reason "…"` |
| Milestone notification                | `ht notify --title "…" --body "…"` (once or twice)  |
| Long-running process                  | `ht new-split right` + `ht send --surface … "cmd\n"` |
| Read what's in a pane                 | `ht read-screen --surface … --lines N`               |
| Open a URL in a browser pane          | `ht browser open-split <url>`                        |
| Browser action                        | `ht browser browser:N <command> [args]`              |
| Screenshot of a pane                  | `ht screenshot --out /tmp/x.png`                     |
| Sidebar in-progress pill              | `ht set-status <key> "<value>" --icon … --color …`  |
| Progress bar                          | `ht set-progress 0.42 --label "…"`                   |

## What you do **not** drive

The runtime hook bridge at `~/.claude/scripts/ht-bridge/` (installed via
`claude-integration/install.sh` from the τ-mux repo) handles these
automatically — leave them alone:

- The **active label pill** (`Claude : <task>`) on `UserPromptSubmit`.
- The **cost / context ticker** (`cc · turn 3 · 2.1 min · $0.034`) on `Stop`.
- The **idle / permission** pill colour on `Notification` events.
- The **completion notification** on `Stop`.

If you find yourself reaching for `ht set-status Claude …` or
`ht set-status cc …`, stop — the hook owns those keys.

## Why this skill exists

The τ-mux project ships two integration surfaces:

- `claude-integration/ht-bridge/` — runtime shell hooks. Wired via
  `~/.claude/settings.json`. Drives the active label, cost ticker, and
  idle/permission pills automatically. **You do not interact with this
  directly.**
- `claude-integration/skills/tau-mux/` — *this skill*. Teaches you the
  *interactive* parts: plans, ask-user, notify, splits, browser, screenshots,
  status pills, bash safety. The pi coding agent has the equivalent
  capabilities baked in via `pi-extensions/ht-bridge/`; for Claude Code,
  this skill is the equivalent.

When in doubt: prefer a τ-mux surface over plain terminal output. The user
chose to install τ-mux; meet them there.
