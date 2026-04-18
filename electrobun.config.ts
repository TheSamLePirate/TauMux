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
      // Notification sounds — served to the webview (relative path) and
      // to the web-mirror client via HTTP from the vendor copy.
      "assets/audio/finish.mp3": "views/terminal/audio/finish.mp3",
      // Web-mirror client bundle (produced by scripts/build-web-client.ts)
      "assets/web-client/client.js": "vendor/web-client/client.js",
      "assets/web-client/client.css": "vendor/web-client/client.css",
      "assets/web-client/tokens.css": "vendor/web-client/tokens.css",
    },
    mac: {
      icons: "icon.iconset",
      bundleCEF: false,
      // Entitlements that require a matching Info.plist usage-description
      // string. Without these keys in the bundle's Info.plist, macOS
      // silently denies the underlying TCC capability and never shows the
      // app in System Settings → Privacy & Security, so the user has no
      // way to grant access. Strings here become the "{app} would like
      // to access your camera/microphone" explanations in the system
      // permission prompt. Needed for demo_webcam.ts (AVFoundation capture
      // via ffmpeg subprocess) and any script that captures mic audio.
      entitlements: {
        "com.apple.security.device.camera":
          "HyperTerm Canvas needs camera access so scripts like demo_webcam.ts can stream the webcam into a sideband panel.",
        "com.apple.security.device.microphone":
          "HyperTerm Canvas needs microphone access so scripts can capture and display audio-reactive visualisations.",
      },
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
  scripts: {
    postBuild: "scripts/post-build.ts",
  },
} satisfies ElectrobunConfig;
