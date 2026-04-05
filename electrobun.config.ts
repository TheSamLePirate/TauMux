import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "HyperTerm Canvas",
    identifier: "dev.hyperterm.canvas",
    version: "0.0.1",
    description:
      "A hybrid terminal emulator with floating canvas overlays for images, charts, and interactive widgets.",
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
      // Web UI assets (inlined by the HTTP server at runtime)
      "node_modules/xterm/lib/xterm.js": "vendor/xterm.js",
      "node_modules/xterm/css/xterm.css": "vendor/xterm.css",
      "node_modules/@xterm/addon-fit/lib/addon-fit.js": "vendor/addon-fit.js",
      "node_modules/@xterm/addon-web-links/lib/addon-web-links.js":
        "vendor/addon-web-links.js",
      "assets/fonts/JetBrainsMonoNerdFontMono-Regular.ttf":
        "vendor/fonts/nerd-regular.ttf",
      "assets/fonts/JetBrainsMonoNerdFontMono-Bold.ttf":
        "vendor/fonts/nerd-bold.ttf",
    },
    mac: {
      icons: "icon.iconset",
      bundleCEF: false,
    },
    linux: {
      icon: "assets/images/icon.png",
      bundleCEF: false,
    },
    win: {
      icon: "assets/images/icon.ico",
      bundleCEF: false,
    },
  },
} satisfies ElectrobunConfig;
