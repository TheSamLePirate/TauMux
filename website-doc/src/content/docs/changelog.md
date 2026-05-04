---
title: Changelog
description: Notable changes — most recent at the top.
sidebar:
  order: 1
---

This page summarizes user-facing changes. The full commit log is on [GitHub](https://github.com/TheSamLePirate/TauMux/commits/main).

## Unreleased

- Documentation website launched (this site).
- Ask-user (Plan #10): structured agent → human question protocol with `ht ask {yesno|choice|text|confirm-command}`. Answers via in-app webview modal, sibling CLI (`ht ask answer`), or Telegram inline buttons / force-reply. Per-surface FIFO queue, sidebar pending pill, edit-in-place audit trail in Telegram.

## 0.2.82

- pi-extensions/ht-bridge: active-label and `agent_end` summaries now follow the live pi session model (auth + base URL match too). Switching pi from Haiku to Sonnet retargets the summariser without a config edit. New `useSessionModel` flag (default `true`) + `PI_HT_BRIDGE_USE_SESSION_MODEL` env override; the existing `provider` / `modelId` pair is now the fallback path.
- claude-integration: new `tau-mux` Claude Code skill at `claude-integration/skills/tau-mux/SKILL.md`. Mirrors the *active* / LLM-callable side of `pi-extensions/ht-bridge` (plans → `.claude/plans/<name>.md` review-gated via `ht ask choice` then `ht plan set`, `ht ask {yesno|choice|text|confirm-command}` for structured questions, milestone `ht notify`, `ht new-split` + `ht send` for long-running processes, `ht browser` for verification, `ht screenshot` for evidence, `ht set-status` / `ht set-progress` for in-progress signals, bash-safety gating). The runtime hook bridge keeps owning the passive pills (active label, cost ticker, idle/permission). `install.sh` now installs both pieces; `SKIP_HOOKS=1` / `SKIP_SKILL=1` for partial installs.

## 0.2.x

- Telegram bridge: chat pane, long-poll bot service, SQLite log, `ht telegram` CLI, optional notification forwarding.
- Sharebin: drop-and-share files served from the web mirror.
- Browser pane improvements: 40+ `ht browser` commands, address bar with smart URL detection, force dark mode, terminal link interception.
- Process Manager: collapse/expand per surface, port chips inside rows, summary header.
- Live process metadata: git state (branch, ahead/behind, dirty counts) added to the per-surface payload, TTL-cached.
- Web mirror: protocol v2 envelopes, resume-on-reconnect via 2 MB ring buffer, `@xterm/headless` snapshot replay, constant-time token comparison.
- Workspace package.json card with one-click script run + green/red/grey state dots.

## 0.1.x

- Initial public preview.
- Workspaces, tiling splits, draggable dividers.
- xterm.js + `Bun.spawn` PTYs.
- Sideband protocol (fd 3/4/5) with Python + TypeScript clients.
- Floating canvas panels.
- `ht` CLI for socket-driven control.
- Web mirror v1.
