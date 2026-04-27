---
title: Changelog
description: Notable changes — most recent at the top.
sidebar:
  order: 1
---

This page summarizes user-facing changes. The full commit log is on [GitHub](https://github.com/olivvein/tau-mux/commits/main).

## Unreleased

- Documentation website launched (this site).

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
