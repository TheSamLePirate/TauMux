# crazyShell Reviewer Agent

This document describes the repository-local code review agent for HyperTerm Canvas.

## Goal

Create a recurring, proposition-only reviewer that continuously inspects the project for:

- bugs
- correctness risks
- lifecycle leaks
- stale or missing tests
- architecture drift
- documentation drift
- weak operational workflows
- high-value maintenance and quality improvements

The reviewer does not edit the codebase. It writes markdown reports into `code_reviews/`.

## Outputs

Each run creates a new markdown report under `code_reviews/`.

Naming convention:

```text
YYYY-MM-DDTHH-mm-ss.sssZ__<short-commit>.md
```

Each report includes frontmatter with:

- generation timestamp
- branch
- reviewed commit
- previous reviewed commit
- architecture guide reference
- output mode

## Commands

One-shot review:

```bash
bun run review:agent
```

Continuous polling mode:

```bash
bun run review:agent:watch
```

Custom interval:

```bash
bun run review:agent:watch --poll-seconds=900
CRAZYSHELL_REVIEW_POLL_SECONDS=900 bun run review:agent:watch
```

## How it works

### 1. Review runner

`scripts/run-code-review-agent.ts`:

- discovers the current git branch and HEAD commit
- finds the most recent reviewed commit from `code_reviews/*.md`
- computes incremental scope when a prior review exists
- builds a strong reviewer prompt for Hermes
- runs `hermes chat` in inspection-only mode
- writes the resulting markdown to `code_reviews/`
- hard-fails the run if any mutation is detected outside `code_reviews/`

### 2. Watch loop

`scripts/run-code-review-watch.ts`:

- polls the repository HEAD on an interval
- checks whether the current commit already has a report
- runs the one-shot reviewer when a new commit has not yet been reviewed
- keeps looping until stopped

## Reviewer behavior

The prompt defines the reviewer as `crazyShell Reviewer` and requires an internal multi-pass loop:

1. architecture pass
2. correctness pass
3. verification pass
4. self-critique pass

The reviewer must:

- inspect without editing files
- consult `DEV_RULES.md`
- consult relevant subsystem docs in `doc/`
- enforce `/Users/olivierveinand/Documents/DEV/architecture-guide.md` where it fits the project
- prefer evidence-backed findings with exact file references
- prioritize high-signal, actionable propositions

## Expected report structure

The generated report should contain:

- executive summary
- review scope
- highest value findings
- suggested review backlog
- checks performed
- verdict

Each finding should include:

- title
- severity
- confidence
- why it matters
- evidence
- proposition
- tests to add/update
- docs/skills/workflows to update

## Smart review scope

If a previous review exists, the agent reviews incrementally using:

- `previous_reviewed_commit..HEAD`
- recent commit history
- current working tree status

If no previous review exists, the agent performs a fresh review of the current snapshot and chooses the highest-risk areas itself.

## Safety rules

- The reviewer is proposition-only.
- It should not write, patch, or delete project files.
- It should use repository docs as authoritative context.
- It should preserve project priorities: PTY correctness first, overlays never becoming source of truth, and explicit subsystem ownership.
- If the run mutates anything outside `code_reviews/`, the runner must fail hard and no review report should be treated as valid output.

## Maintenance expectations

If this workflow changes, update:

- this document
- `code_reviews/README.md`
- `doc/SKILLS.md` when the workflow/reference commands change
- `README.md` when the developer-facing entry points change
