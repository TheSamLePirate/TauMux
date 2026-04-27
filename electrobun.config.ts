import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    // ASCII-safe bundle name — drives `tau-mux.app` filename + Info.plist
    // CFBundleName. The user-facing display name (menu bar / dock / About
    // dialog / "<app> would like to access…" prompts) is overridden to
    // "τ-mux" via CFBundleDisplayName, written into Info.plist by
    // scripts/post-build.ts. Keeping the bundle filename ASCII avoids
    // USTAR tarball errors during packaging and prevents path-quoting
    // surprises in CI / shell scripts.
    name: "tau-mux",
    identifier: "dev.hyperterm.canvas",
    version: "0.2.18",
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
      shareBin: "shareBin",
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
      // Inter — chrome font per τ-mux design guideline §2. Bundled from
      // the official rsms/inter v4.0 release so the app renders identical
      // chrome offline. Four weights (400/500/600/700) cover labels,
      // active tabs, titles, and the pixel-τ wordmark. The webview loads
      // them via relative URL `fonts/Inter-*.woff2` from the @font-face
      // block in index.css.
      "assets/fonts/inter/Inter-Regular.woff2":
        "views/terminal/fonts/Inter-Regular.woff2",
      "assets/fonts/inter/Inter-Medium.woff2":
        "views/terminal/fonts/Inter-Medium.woff2",
      "assets/fonts/inter/Inter-SemiBold.woff2":
        "views/terminal/fonts/Inter-SemiBold.woff2",
      "assets/fonts/inter/Inter-Bold.woff2":
        "views/terminal/fonts/Inter-Bold.woff2",
      // Notification sounds — served to the webview (relative path) and
      // to the web-mirror client via HTTP from the vendor copy.
      "assets/audio/finish.mp3": "views/terminal/audio/finish.mp3",
      // App icon — rendered in the titlebar (rounded-square) and
      // reused by the web mirror via the HTTP server.
      "assets/images/icon.png": "views/terminal/icon.png",
      // Web-mirror client bundle (produced by scripts/build-web-client.ts)
      "assets/web-client/client.js": "vendor/web-client/client.js",
      "assets/web-client/client.css": "vendor/web-client/client.css",
      "assets/web-client/tokens.css": "vendor/web-client/tokens.css",
      // PWA shell — service worker, manifest, icon. Required for
      // Add-to-Home-Screen + offline shell when the mirror is opened
      // from a packaged build over the network.
      "assets/web-client/sw.js": "vendor/web-client/sw.js",
      "assets/web-client/manifest.json": "vendor/web-client/manifest.json",
      "assets/web-client/icon.svg": "vendor/web-client/icon.svg",
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
          "τ-mux needs camera access so scripts like demo_webcam.ts can stream the webcam into a sideband panel.",
        "com.apple.security.device.microphone":
          "τ-mux needs microphone access so scripts can capture and display audio-reactive visualisations.",
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
