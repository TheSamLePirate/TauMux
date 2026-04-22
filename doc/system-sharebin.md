# τ-mux shareBin System

The `shareBin` system provides a frictionless way to add native-feeling sideband commands (like `show_md`, `show_img`, `show_gitdiff`) to the τ-mux terminal environment.

## Concept

Instead of requiring users to manually configure aliases or install dependencies to use sideband features, τ-mux maintains a dedicated directory called `shareBin`. Any executable script placed in this directory automatically becomes a first-class command available in every terminal pane.

## Architecture

1. **The Directory**
   - **Development Mode:** A folder named `shareBin` at the root of the project.
   - **Production (Packaged):** Copied into the app bundle at `Contents/Resources/shareBin`.

2. **Executable Scripts**
   - Scripts are dropped into this folder without file extensions (e.g., `show_md` instead of `show_md.ts`).
   - They must have execution permissions (`chmod +x`).
   - They rely on standard system-level shebangs (e.g., `#!/usr/bin/env bun` or `#!/usr/bin/env python3`). We assume the user has `bun` or `python3` available in their environment.

3. **Client Libraries**
   - The sideband client wrappers (`hyperterm.ts` and `hyperterm.py`) live directly inside `shareBin`.
   - Scripts can cleanly import them using relative paths (e.g., `import { ht } from "./hyperterm";` or `from hyperterm import ht`).

4. **PATH Injection (The Magic)**
   - When `SessionManager` / `PtyManager` spawns a new shell (`Bun.spawn`), it dynamically resolves the absolute path to the `shareBin` directory.
   - It prepends this directory to the shell's `PATH` environment variable:
     `PATH: "/path/to/shareBin:${process.env.PATH}"`
   - **Result:** The user types `show_md README.md` and it executes immediately, leveraging their local `bun` installation but accessing the bundled script.

## Implementation Steps

1. **Setup Directory:** 
   - `mkdir shareBin`
   - Copy `scripts/hyperterm.ts` and `scripts/hyperterm.py` to `shareBin/`.
2. **Migrate Demos:**
   - Copy `scripts/demo_mdpreview.ts` to `shareBin/show_md` and `chmod +x shareBin/show_md`.
   - Copy `scripts/demo_image.py` to `shareBin/show_img` and `chmod +x shareBin/show_img`.
3. **Update PTY Spawner:**
   - Modify `src/bun/pty-manager.ts` to locate `shareBin` (handling both dev and bundled paths via `process.execPath` / `import.meta.dir`).
   - Inject the resolved path into the `env.PATH` object.
4. **Update Packaging:**
   - Modify `electrobun.config.ts` (or `scripts/post-build.ts`) to ensure the `shareBin` folder is recursively copied into the final `.app` bundle.

## Benefits

- **Zero Configuration:** Adding a new tool is as simple as creating a file. No RPC registration or internal code changes required.
- **Native UX:** Commands behave exactly like standard Unix utilities.
- **Portability:** Scripts remain standalone and easy to debug, encapsulating their sideband communication logic.