# Design Recommendation 2: "Editorial Paperweight" (Academic Minimalist)

## 1. Vision & Concept
**"The Terminal as a Printed Document."**
Most terminals look like sci-fi control panels. "Editorial Paperweight" aggressively goes the other way. It draws inspiration from high-end print design, academia, Notion, and e-ink displays. This is a bright, calm, distraction-free environment that treats code and output as a living, elegantly typeset document.

Instead of floating holograms, the canvas panels are treated as "index cards" or "photographs" physically placed on a sheet of paper. This is a highly opinionated, light-mode-first aesthetic (though it adapts to a sepia/charcoal dark mode).

## 2. Color Palette (Light Mode Default)
*   **Base/Background (xterm.js & Window):** `#FDFCF8` (Warm Off-White/Parchment) — Absolutely no transparency or blur. Solid, grounded, matte.
*   **Primary Text:** `#1A1A1A` (Rich Black)
*   **Muted Text/Comments:** `#8C8C8C` (Neutral Gray)
*   **Accent Color:** `#E03131` (Editorial Vermillion/Red) — Used exclusively for errors, the cursor, and the active workspace indicator.
*   **Canvas Panel Background:** `#FFFFFF` (Pure White) to contrast slightly against the parchment base.
*   **Borders:** `#1A1A1A` (Solid 1px Black). No soft shadows anywhere.

## 3. Typography
*   **Dual-Font System:** This design mixes serif and monospace to create hierarchy.
*   **UI/Headers/Command Palette:** `New York` (macOS system serif) or `Playfair Display`. This brings an immediate sense of elegance and structure.
*   **Terminal Text/Code:** `SF Mono` or `IBM Plex Mono`. Clean, legible, and classic.
*   **Weights:** Heavy contrast. Titles are bold (700) serif; terminal text is regular (400) monospace.

## 4. UI Layout & Components

### The Titlebar & Window
*   Standard macOS titlebar with a solid `#FDFCF8` background. No hidden inset trickery. We embrace the structure of a standard desktop window.
*   A solid 1px black line separates the titlebar from the main terminal view.

### The Sidebar
*   **Top Bar instead of Sidebar:** To maximize reading width (like a book), move the cmux workspace/pane indicators to a thin horizontal bar at the top or bottom, rather than a side column.
*   **Tab Style:** Workspaces look like literal folder tabs or breadcrumbs (`Workspace 1 / Pane 2`). 

### Floating Canvas Panels (The "Cards")
*   **Brutalist Cards:** Canvas overlays (images, charts) look like printed cards. 
*   **Style:** Pure white background, sharp 0px border radius, 1px solid black border. 
*   **Shadow:** Instead of a soft blur shadow, use a hard offset shadow (e.g., `box-shadow: 4px 4px 0px #1A1A1A`). This gives a physical, tactile "stacked paper" feel.
*   **Header:** A small, serif title at the top of each card (e.g., *Figure 1: Performance Graph*).

### Command Palette
*   **The Search Bar:** A massive, full-width search input that takes over the top of the window, styled like a newspaper headline prompt. Text typed here is in the large Serif font, blending commands with natural language elegance.

## 5. Motion & Interactions
*   **Snappy, not Springy:** Animations should be instant or use very fast, linear transitions (0.1s). No bouncy spring physics. The app should feel deterministic, mechanical, and crisp like an e-ink screen refreshing or a typewriter striking paper.
*   **Focus States:** When a pane or card is active, its 1px border becomes a 2px Vermillion Red border. 

## 6. Why this works for Hyperterm Canvas
Because the UI is built with vanilla DOM APIs and no massive frameworks like React, hitting this level of crisp, instantaneous "brutalist" rendering is highly performant. The DOM naturally excels at drawing boxes with solid borders. By removing complex drop shadows, background blurs, and border radii, the app's rendering performance will be exceptionally high, perfectly aligning with the "Performance first — <50ms startup" project priority.