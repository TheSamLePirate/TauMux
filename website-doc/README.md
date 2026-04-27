# τ-mux docs site

Static documentation site for τ-mux. Built with [Astro Starlight](https://starlight.astro.build).

This folder is **self-contained** — its own `package.json` and `bun install`, independent of the root project.

## Run locally

```bash
cd website-doc
bun install
bun run dev          # http://localhost:4321 — live reload
bun run build        # produces dist/
bun run preview      # serves dist/ locally
```

## How to add a page

1. Drop a `.md` (or `.mdx`) into the appropriate folder under `src/content/docs/`. The folder you choose decides which sidebar section the page lands in.
2. Add frontmatter:

   ```yaml
   ---
   title: Browser panes
   description: One-line summary used in nav and meta description.
   sidebar:
     order: 2          # lower numbers appear first within the section
   ---
   ```

3. Write Markdown. That's it — Starlight autogenerates the sidebar entry. **No central config to update.**

### Section folders → sidebar groups

| Folder under `src/content/docs/` | Sidebar group |
|---|---|
| `getting-started/` | Getting Started |
| `concepts/` | Concepts |
| `features/` | Features |
| `cli/` | CLI Reference (ht) |
| `api/` | JSON-RPC API |
| `sideband/` | Sideband Protocol |
| `web-mirror/` | Web Mirror |
| `integrations/` | Integrations |
| `configuration/` | Configuration |
| `development/` | Development |
| (root) `changelog.md` | Changelog |

### Adding a brand-new top-level section

Edit `astro.config.mjs` once: append to the `sidebar` array

```js
{ label: "New Section", autogenerate: { directory: "new-section" } },
```

…then drop files into `src/content/docs/new-section/`. From that point new files appear automatically.

## Frontmatter cheatsheet

```yaml
---
title: Page title (required)
description: Short summary (recommended, used for meta + sidebar tooltip)
sidebar:
  order: 1               # ordering within the section
  label: Custom label    # override the title in the sidebar
  badge: New             # optional badge: "New", "Beta", or { text, variant }
  hidden: false          # set true to keep the page indexable but off the sidebar
template: doc            # "doc" (default) or "splash" for landing pages
prev: false              # disable the prev/next link to this page
next: false
---
```

See the [Starlight frontmatter reference](https://starlight.astro.build/reference/frontmatter/) for everything else.

## Source mapping

User-facing pages are written fresh; the deep contributor docs in `../doc/` are the source material but **stay where they are**. Don't symlink — pages here are deliberately rewritten in user voice.

Source mapping lives in the implementation plan at `~/.claude/plans/look-at-that-project-reflective-tide.md`.

## Tech notes

- Astro `^6.1.9`, `@astrojs/starlight` `^0.38.4`.
- Pagefind search is enabled (built into `dist/`).
- `sharp` is installed for OG image / asset optimization.
- The site is fully static — open `dist/index.html` directly to verify.
