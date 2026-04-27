---
title: Pi extensions
description: ht-notify-summary — surfaces Pi coding-agent turns into the τ-mux sidebar.
sidebar:
  order: 2
---

`pi-extensions/ht-notify-summary/` is a Pi (an AI coding-agent) extension that mirrors Pi's turn lifecycle into the τ-mux sidebar — same idea as the [Claude Code integration](/integrations/claude-code/).

## What it does

- Posts a status pill to the sidebar while Pi is working.
- Updates the pill with each tool call summary.
- Posts a completion notification with `ht notify` when the turn finishes.

## Install

The extension is a single `index.ts` plus a `config.json`. Drop the folder into Pi's extension directory, restart Pi, and it will auto-load.

```
pi-extensions/
└── ht-notify-summary/
    ├── config.json    # extension metadata + hooks
    ├── index.ts       # the extension code
    └── README.md
```

## Behavior

The extension uses τ-mux's `ht` CLI under the hood — same way as the Claude integration. If τ-mux isn't running, Pi's runtime swallows the resulting non-zero exit and continues; nothing breaks.

## Customizing

Edit `index.ts` to change:

- The pill key (`ht set-status pi …`).
- The summary format.
- Whether to post a completion notification.

## Read more

- [Claude Code integration](/integrations/claude-code/)
- [Notification channels](/integrations/notification-channels/)
