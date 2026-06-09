import { defineConfig } from "vite";

// Served from a sub-path (`/ext/<id>/`) in installed mode, so asset URLs must
// be relative. The host launches `vite` with --port/--strictPort; we mirror
// the manifest devPort here for standalone `bun run dev` too.
export default defineConfig({
  base: "./",
  server: { host: "127.0.0.1", port: 5193, strictPort: true },
});
