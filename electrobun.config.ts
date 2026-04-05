import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "HyperTerm Canvas",
    identifier: "dev.hyperterm.canvas",
    version: "0.0.1",
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    views: {
      terminal: {
        entrypoint: "src/views/terminal/index.ts",
      },
    },
    copy: {
      "src/views/terminal/index.html": "views/terminal/index.html",
      "src/views/terminal/index.css": "views/terminal/index.css",
      "src/views/terminal/xterm.css": "views/terminal/xterm.css",
    },
    mac: {
      bundleCEF: false,
    },
    linux: {
      bundleCEF: false,
    },
    win: {
      bundleCEF: false,
    },
  },
} satisfies ElectrobunConfig;
