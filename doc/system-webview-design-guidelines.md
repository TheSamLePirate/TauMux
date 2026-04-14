# HyperTerm Canvas: Webview Design Guidelines

This document defines the visual system for the Electrobun webview. The goal is simple: make HyperTerm Canvas feel like a serious macOS app, not a terminal wrapped in ad hoc styling.

Use this alongside [system-webview-ui.md](system-webview-ui.md). That document explains structure and behavior; this one explains visual rules and design intent.

## 1. Audit Summary

Before this redesign, the UI had solid information architecture but a fragmented visual language:

- The app chrome used the same monospace typography as the terminal, which made navigation, controls, and metadata feel equally "code-like" and reduced hierarchy.
- Multiple motifs competed at once: neon glow, gaming-style gradients, heavy uppercase labels, and glassmorphism. The result was energetic but not coherent.
- Surface chrome, sidebar cards, settings, palette, and overlays all used different radii, borders, and shadow treatments.
- Accent colors were too dominant. Gold and purple were everywhere, so important operational states did not stand out cleanly.
- The app looked custom, but not intentional. It lacked the calm, precise, native-adjacent feel expected from a pro macOS tool.

## 2. Design Direction

The target is "macOS control room" with the same calm product feel as `t3code`:

- calm graphite chrome
- near-flat card hierarchy
- dark neutral background with a blue primary
- restrained accent tinting
- dense but readable information
- matte surfaces instead of flashy glow or glossy chrome
- system typography for UI, mono typography only for terminal and telemetry
- cards and sheets that feel like one family

The terminal remains the star. The UI should frame it, not compete with it.

## 3. Core Principles

### 3.1 Native-adjacent, not fake-native

Do not imitate every Apple component literally. Borrow the qualities that matter:

- clear hierarchy
- measured spacing
- restrained material contrast
- low-noise controls
- sentence-case labels
- strong hover and focus behavior

### 3.2 Graphite first, accent second

The default visual base is neutral graphite. Theme accents may tint the chrome, but they should not overwhelm it. Accent is for focus, selection, and important metadata, not for every edge and label.

### 3.3 Operational density with calm pacing

This app exposes a lot of live state: processes, ports, cwd, package scripts, logs, notifications. Keep that density, but group it into calm layers:

- structure first
- metadata second
- alerts last

### 3.4 Terminal and chrome must use different typography roles

- UI copy: system sans
- terminal content: configured mono font
- telemetry chips, paths, commands, ports: mono only when it adds meaning

If everything is monospace, nothing is special.

## 4. Visual Rules

### 4.1 Typography

- UI font stack: `DM Sans`, `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `system-ui`, `sans-serif`
- Mono font stack: `SF Mono`, `JetBrains Mono`, `Berkeley Mono`, `Menlo`, `monospace`
- Use sentence case by default.
- Reserve uppercase for tiny technical labels only when it materially improves scanning.
- Prefer weight and contrast over tracking-heavy uppercase to create hierarchy.

### 4.2 Color

- Base chrome is a dark neutral background with slightly lighter cards.
- Accent color drives focus rings, primary pills, selected navigation items, and active pane emphasis.
- Secondary color may tint theme previews and git states, but should stay subordinate.
- Semantic colors must remain explicit:
  - green for healthy/listening/running
  - red for destructive/error
  - amber for active foreground work or warnings

### 4.3 Materials

- Prefer matte product surfaces over glossy or reflective chrome.
- Use translucency sparingly, mainly in modal backdrops rather than component bodies.
- Every major surface should have:
  - restrained border
  - quiet fill
  - consistent shadow depth

### 4.4 Shape

- Titlebar controls: 8-10 px radius
- Cards and sidebar items: 10-12 px radius
- Panes and floating sheets: 18-20 px radius
- Chips and status items: pill radius

- Prefer the `t3code` spacing rhythm:
  - 52 px titlebar
  - 20 px section and sheet padding
  - 12 px horizontal / 8 px vertical control padding
  - 24 px gaps only for major content grouping

The app should feel built from one shape system.

### 4.5 Motion

- Use short, quiet transitions.
- Prefer fade and slight translation over dramatic scaling.
- Motion should confirm state changes, not advertise itself.

## 5. Surface-Specific Guidance

### 5.1 Titlebar

- Feels like a unified macOS toolbar.
- Primary app title is readable, not stylized.
- Workspace and count badges read like compact status capsules.
- Action buttons live in a grouped control strip, not as loose icons.

### 5.2 Sidebar

- Reads as a navigation rail plus operational dashboard.
- Workspace cards should feel elevated and tappable.
- Active workspace gets a precise accent treatment, not a loud glow.
- Notifications, logs, and server status should share the same card language as workspace rows.

### 5.3 Panes

- Panes are the core product surface.
- The border, title bar, and focus ring must be legible without looking ornamental.
- Focus state should be obvious, but quieter than the terminal content itself.
- Metadata chips should look like instrumentation, not badges from another app.

### 5.4 Overlays

- Process Manager, Pane Info, Settings, prompts, and Command Palette should all feel like the same sheet family.
- Shared traits:
  - same border treatment
  - same corner radius
  - same header hierarchy
  - same backdrop blur strength

### 5.5 Settings

- Prefer macOS preferences energy: calm list rows, strong labels, lightweight controls.
- Keep the left nav understated.
- Use cards only where grouping genuinely improves comprehension.

### 5.6 Command Palette

- Must feel fast and premium.
- Search field, result rows, and footer hints should form one continuous sheet.
- The selected row is defined by tone and border, not oversized motion or glow.

## 6. Do / Don't

Do:

- use system sans for chrome
- keep chrome neutral and let the terminal provide most of the color
- use accent for focus and selection
- keep borders and shadows consistent across components
- design every new component to match the existing sheet or card families

Don't:

- introduce new neon glows for one-off features
- reintroduce glossy highlight layers or metallic glass effects
- style utility overlays differently from main sheets
- default to all caps for labels
- use mono text for generic UI labels
- add decorative gradients that compete with terminal content

## 7. Implementation Notes

The current implementation follows these rules by:

- switching UI chrome to system typography
- introducing a calmer Graphite default theme
- unifying titlebar, sidebar, pane, and overlay treatments
- reducing glow-heavy styling in favor of matte cards and quiet borders
- adding shared footer and header patterns to transient surfaces

Future UI work should extend the existing tokens and component families instead of inventing new ones.
