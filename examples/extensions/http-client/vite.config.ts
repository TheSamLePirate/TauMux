import { defineConfig } from "vite";

// τ-mux serves a built extension bundle from a sub-path (`/ext/<id>/`), so every
// asset URL emitted into index.html MUST be relative — hence `base: "./"`.
// The dev server is pinned to the manifest's `devPort` so the host can find it.
export default defineConfig({
  base: "./",
  server: {
    port: 5192,
    strictPort: true,
    host: "127.0.0.1",
  },
});
