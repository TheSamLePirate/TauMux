# Design Recommendation 1: "Obsidian Glass" (Neo-Brutalist macOS)

## 1. Vision & Concept
**"The Hacker's Window into the Machine."** 
Obsidian Glass is a dark-mode-exclusive, ultra-modern macOS design direction. It merges the raw, unapologetic utility of a terminal multiplexer (cmux) with the high-end, polished aesthetic of macOS native materials. The goal is to feel like a heads-up display (HUD) for a power user—where the terminal is the void, and the floating canvas panels are illuminated glass sheets hovering above it.

This design leans heavily on macOS Vibrancy (background blur) mixed with sharp, 1px borders and intense neon accents to create depth without visual clutter.

## 2. Color Palette
*   **Base/Background:** Transparent (`rgba(0,0,0, 0.4)`) relying on macOS `NSVisualEffectView` (Dark/HUD material) provided by Electrobun window configurations.
*   **Terminal Background (xterm.js):** `#09090B` (Zinc 950) — A near-black void that grounds the text.
*   **Primary Accent:** `#EAB308` (Cyber Yellow) — Used sparingly for the cursor, active pane borders, and critical notifications.
*   **Secondary Accent:** `#A855F7` (Neon Purple) — Used for floating canvas headers and interactive widget highlights.
*   **Text (Primary):** `#F4F4F5` (Zinc 50)
*   **Text (Muted/UI):** `#52525B` (Zinc 500)
*   **Borders:** `#27272A` (Zinc 800) for resting states, `rgba(234, 179, 8, 0.5)` for active states.

## 3. Typography
*   **Global Font:** `JetBrains Mono` or `Berkeley Mono`.
*   *Opinionated Choice:* We do not mix fonts. The entire UI—from the command palette to the sidebar tooltips to the terminal text—is rendered in a monospace font. This creates an uncompromising, technical aesthetic.
*   **Weights:** 
    *   UI Labels/Sidebar: 400 (Regular), 11px, Uppercase, tracking wide (letter-spacing: 0.05em).
    *   Terminal Text: 400 (Regular), 13px or 14px.
    *   Command Palette Input: 300 (Light), 24px.

## 4. UI Layout & Components

### The Titlebar & Traffic Lights
*   **Hidden Titlebar:** Use Electrobun's frameless window options (`titleBarStyle: 'hiddenInset'`). The macOS traffic light buttons (red, yellow, green) float directly over the terminal text/void, seamlessly integrated.

### The Sidebar
*   **Ultra-Thin:** A razor-thin vertical strip (32px wide) on the far left. 
*   **Visuals:** No background color. Icons are crisp, 1px stroke SVG outlines.
*   **Interaction:** On hover, it expands slightly with a fluid spring animation to reveal labels, but pushes the terminal content aside.

### Floating Canvas Panels
*   **The "Glass" Effect:** This is the core innovation. Canvas panels (fd3/fd4 data) are not solid blocks. They have a background of `rgba(15, 15, 20, 0.7)` with a `backdrop-filter: blur(20px) saturate(150%)`.
*   **Borders:** A 1px border of `rgba(255, 255, 255, 0.1)` on the top and left to simulate a light catch (glass reflection), and a heavy drop shadow (`box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7)`).
*   **Z-Depth:** Panels visually "float" significantly higher than the text layer. 

### Command Palette
*   **Center Stage:** Drops down from the top center. 
*   **Style:** A pure black pill `#000000` with a 1px bright yellow border. Extremely minimalist. No extraneous instructions, just the prompt symbol `>` and the blinking block cursor.

## 5. Motion & Interactions
*   **Zero-Latency Feel:** Terminal input must feel instantaneous (adhering to project goals). 
*   **Panel Dragging:** When moving a canvas panel, the background blur intensity reduces slightly, and the drop shadow deepens, making it feel like it was "picked up" off the glass.
*   **Terminal Focus:** When the user is typing, floating panels automatically dim their opacity to 30%, keeping the user focused on the code/xterm layer. Moving the mouse restores their opacity.

## 6. Why this works for Hyperterm Canvas
Since the application relies on xterm.js acting as a foundational layer with DOM elements injected on top, this design naturally emphasizes that architecture. The xterm layer is the dark, foundational void, and the injected DOM elements are treated as literal overlapping layers of frosted glass.