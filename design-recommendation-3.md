# Design Recommendation 3: "Aurora Flux" (Spatial & Organic)

## 1. Vision & Concept
**"The Fluid, Contextual Workspace."**
Aurora Flux takes its cues from macOS's most recent spatial and fluid UI trends (think visionOS adapted for the Mac desktop, or tools like Arc Browser and Final Cut Pro). This design does not look like a traditional grid-based terminal. It is organic, highly rounded, and uses space dynamically. 

The terminal is treated as a vast, continuous space, and floating canvases are treated as "widgets" or "bubbles" of context that emerge smoothly from the text layer.

## 2. Color Palette
*   **Base/Background:** `#1E1E24` (Deep Space Gray).
*   **Surface Colors (Panels/Sidebar):** `#2B2B36` with a slight transparency (`rgba(43, 43, 54, 0.8)`).
*   **Accents (Aurora Gradients):** Instead of solid colors, use subtle, animated CSS gradients for active states. 
    *   *Active Glow:* `linear-gradient(135deg, #FF2E93, #FF8000)`. Used for the command palette border or the active pane indicator.
*   **Text (Primary):** `#FFFFFF` (Pure White).
*   **Text (Subtle):** `#8E8E9F`.

## 3. Typography
*   **Global Font:** `SF Pro Rounded` (macOS native) for all UI elements. This softens the entire experience.
*   **Terminal Font:** `Cascadia Code` or `Fira Code` (fonts with soft, friendly ligatures and rounded terminals).
*   **Spacing:** Line height in the terminal is slightly increased (e.g., `1.6`) to make the text feel more breathable and less cramped, matching the spatial theme.

## 4. UI Layout & Components

### The "Dynamic Island" Workspace Manager
*   Instead of a traditional sidebar, cmux workspaces and status pills are housed in a floating, rounded "pill" at the bottom center of the screen (similar to the macOS Dock or iOS Dynamic Island). 
*   It dynamically expands when a notification comes in or a progress bar is active, then shrinks back to a compact state.

### Floating Canvas Panels (The "Squircle Bubbles")
*   **Organic Shapes:** Panels have a very heavy border radius (e.g., `border-radius: 24px` for large panels, creating an Apple-standard 'squircle'). 
*   **Visuals:** Soft, diffused drop shadows that take on the color of the content inside the panel. (e.g., if the canvas contains a blue chart, the CSS drop shadow is a faint glowing blue). 
*   **Integration:** Instead of hard overlapping, panels have a 1px inner stroke (`box-shadow: inset 0 1px 0 rgba(255,255,255,0.1)`) to separate them cleanly from the terminal text beneath.

### Command Palette
*   **Floating Orb:** A perfectly rounded input field that appears in the center of the screen with an intense, colorful blurred shadow behind it, drawing complete focus. 
*   Results populate below it in a smooth, expanding list without scrollbars (auto-hiding overlay scrollbars only).

## 5. Motion & Interactions
*   **Fluid & Springy:** This design relies heavily on CSS spring animations (`cubic-bezier` curves mimicking Apple's spring physics). 
*   **Canvas Spawning:** When a script outputs a new canvas (via fd4/fd5), it doesn't just "appear". It scales up from `0.8` to `1.0` with a smooth opacity fade, originating from the cursor's current line in the terminal.
*   **Hover States:** Every UI element (sidebar pill, context menus, window controls) has a subtle scale effect (`transform: scale(1.02)`) and brightness increase on hover, making the app feel incredibly responsive and "alive".

## 6. Why this works for Hyperterm Canvas
Since the terminal (xterm.js) and the canvases are managed separately via the Electrobun RPC and the Surface Manager, treating them as fundamentally different visual objects makes sense. The terminal is the static, reliable grid, while the vanilla TS/DOM canvases are free to be highly styled, organic, and modern floating widgets. This provides a striking visual contrast that clearly communicates the "hybrid" nature of the application to the user.