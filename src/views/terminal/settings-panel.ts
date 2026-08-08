import type { AppSettings, AnsiColors } from "../../shared/settings";
import {
  DEFAULT_SETTINGS,
  THEME_PRESETS,
  presetToPartial,
  mergeSettings,
} from "../../shared/settings";
import { ModalHost } from "./a11y/modal-host";
import { createIcon } from "./icons";
import { htEvents } from "../../shared/event-bus";
import {
  renderLayoutSection,
  type SettingsSectionHost,
} from "./settings-layout-section";
import {
  renderIntegrationsSection,
  type IntegrationExtension,
  type IntegrationsActions,
  type IntegrationsView,
} from "./settings-integrations";
import type {
  ClaudeBridgeFeature,
  IntegrationsStatus,
} from "../../shared/integrations";

type SettingChangeHandler = (partial: Partial<AppSettings>) => void;

/** Stand-in when no bun bridge was wired (test fixtures). The section
 *  still renders — read-only — instead of throwing on a click. */
const NOOP_INTEGRATIONS: IntegrationsActions = {
  refresh: () => {},
  installClaude: () => {},
  uninstallClaude: () => {},
  setShellIntegration: () => {},
  setExtensionEnabled: () => {},
};

interface Section {
  id: string;
  label: string;
  icon: Parameters<typeof createIcon>[0];
  render: (content: HTMLElement, settings: AppSettings) => void;
}

export interface SettingsDiagnostics {
  logPath: string | null;
  socketPath: string;
  configDir: string;
}

export class SettingsPanel {
  private overlay: HTMLDivElement;
  private panel: HTMLDivElement;
  private nav: HTMLDivElement;
  private content: HTMLDivElement;
  private host!: ModalHost;
  private settings: AppSettings = { ...DEFAULT_SETTINGS };
  /** Static runtime paths surfaced in the Advanced section. Populated
   *  when bun pushes `restoreDiagnostics` after the webview boots —
   *  null until then; the Advanced section degrades to "loading…". */
  private diagnostics: SettingsDiagnostics | null = null;
  /** Insertion-ordered list of `ht set-status` keys seen since the
   *  app booted. Pushed (debounced) by bun as `restoreHtKeysSeen`.
   *  Powers the "Discovered ht keys" subsection in Settings → Layout. */
  private htKeysSeen: string[] = [];
  // Persisted across open/close cycles so picking "Theme" and closing
  // doesn't snap back to "General" on reopen. localStorage write is
  // wrapped in try/catch because private-browsing modes throw.
  private static STORAGE_KEY = "hyperterm-canvas.settings-panel.section";
  private activeSection = SettingsPanel.loadActiveSection();
  private onChange: SettingChangeHandler;
  /** Webview→bun bridge for the Advanced section's "Reveal Log File"
   *  button. Optional — the button is hidden when no callback is wired,
   *  which keeps the panel usable in test fixtures that don't mount the
   *  full RPC pipeline. */
  private onRevealLogFile?: () => void;
  /** §4.1 — what is ACTUALLY painting terminals right now, plus why it
   *  differs from the request. `terminal-renderer.ts` has always computed
   *  a `RendererFallbackReason`, and its own doc claimed the reason was
   *  "surfaced for the settings panel's status hint" — but nothing read
   *  it, so a user whose GPU renderer had silently degraded had no way to
   *  find out. Optional so test fixtures can omit it. */
  private getRendererStatus?: () => {
    active: "webgl" | "dom";
    fallbackReason: string | null;
  } | null;
  private visible = false;
  private sections: Section[];
  /** Host wiring read from disk by bun (Claude Code hook bridge + shell
   *  rc), pushed on `integrationsStatus`. Null until the first push —
   *  the section says "reading…" rather than claiming "not installed",
   *  which would be a lie the user might act on. */
  private integrations: IntegrationsStatus | null = null;
  /** Installed extensions, from the same `extensionList` push that feeds
   *  the command palette. */
  private integrationExtensions: IntegrationExtension[] = [];
  /** Feature checkboxes the user has ticked but not yet submitted. Kept
   *  on the panel (not in the section renderer) so a status push mid-
   *  selection doesn't wipe the ticks. Seeded from what is already
   *  installed the first time a status arrives. */
  private selectedBridgeFeatures = new Set<ClaudeBridgeFeature>();
  private integrationsSeeded = false;
  private integrationsActions?: IntegrationsActions;

  constructor(
    onChange: SettingChangeHandler,
    options: {
      onRevealLogFile?: () => void;
      getRendererStatus?: () => {
        active: "webgl" | "dom";
        fallbackReason: string | null;
      } | null;
      /** Bridge for the Integrations section. Omitted in test fixtures,
       *  which renders the section read-only. */
      integrations?: IntegrationsActions;
    } = {},
  ) {
    this.onChange = onChange;
    this.onRevealLogFile = options.onRevealLogFile;
    this.getRendererStatus = options.getRendererStatus;
    this.integrationsActions = options.integrations;

    this.sections = [
      {
        id: "general",
        label: "General",
        icon: "terminal",
        render: (c, s) => this.renderGeneral(c, s),
      },
      {
        id: "appearance",
        label: "Appearance",
        icon: "eye",
        render: (c, s) => this.renderAppearance(c, s),
      },
      {
        id: "layout",
        label: "Layout",
        icon: "splitHorizontal",
        render: (c, s) => this.renderLayout(c, s),
      },
      {
        id: "theme",
        label: "Theme",
        icon: "sparkles",
        render: (c, s) => this.renderTheme(c, s),
      },
      {
        id: "effects",
        label: "Effects",
        icon: "bolt",
        render: (c, s) => this.renderEffects(c, s),
      },
      {
        id: "network",
        label: "Network",
        icon: "globe",
        render: (c, s) => this.renderNetwork(c, s),
      },
      {
        id: "browser",
        label: "Browser",
        icon: "globe",
        render: (c, s) => this.renderBrowser(c, s),
      },
      {
        id: "telegram",
        label: "Telegram",
        icon: "messageCircle",
        render: (c, s) => this.renderTelegram(c, s),
      },
      {
        id: "autoContinue",
        label: "Auto-continue",
        icon: "rocket",
        render: (c, s) => this.renderAutoContinue(c, s),
      },
      {
        id: "integrations",
        label: "Integrations",
        icon: "package",
        render: (c, s) => this.renderIntegrations(c, s),
      },
      {
        id: "advanced",
        label: "Advanced",
        icon: "wrench",
        render: (c, s) => this.renderAdvanced(c, s),
      },
    ];

    // Overlay
    this.overlay = document.createElement("div");
    this.overlay.className = "settings-overlay";

    // Panel
    this.panel = document.createElement("div");
    this.panel.className = "settings-panel";

    // Header
    const header = document.createElement("div");
    header.className = "settings-header";

    const titleCopy = document.createElement("div");
    titleCopy.className = "settings-header-copy";

    const eyebrowEl = document.createElement("span");
    eyebrowEl.className = "settings-header-eyebrow";
    eyebrowEl.textContent = "Preferences";
    titleCopy.appendChild(eyebrowEl);

    const titleEl = document.createElement("span");
    titleEl.id = "settings-panel-title";
    titleEl.className = "settings-header-title";
    titleEl.textContent = "Settings";
    titleCopy.appendChild(titleEl);

    const subtitleEl = document.createElement("span");
    subtitleEl.className = "settings-header-subtitle";
    subtitleEl.textContent =
      "Terminal behavior, appearance, and workspace chrome";
    titleCopy.appendChild(subtitleEl);

    header.appendChild(titleCopy);

    const closeBtn = document.createElement("button");
    closeBtn.className = "settings-close-btn";
    closeBtn.setAttribute("aria-label", "Close settings");
    closeBtn.append(createIcon("close", "", 14));
    closeBtn.addEventListener("click", () => this.hide());
    header.appendChild(closeBtn);

    this.panel.appendChild(header);

    // Body (nav + content)
    const body = document.createElement("div");
    body.className = "settings-body";

    this.nav = document.createElement("div");
    this.nav.className = "settings-nav";
    body.appendChild(this.nav);

    this.content = document.createElement("div");
    this.content.className = "settings-content";
    body.appendChild(this.content);

    this.panel.appendChild(body);
    this.overlay.appendChild(this.panel);
    document.body.appendChild(this.overlay);

    this.host = new ModalHost({
      overlay: this.overlay,
      panel: this.panel,
      labelledBy: "settings-panel-title",
      onClose: () => this.hide(),
    });

    this.buildNav();
  }

  show(settings: AppSettings): void {
    if (this.visible) return;
    this.settings = { ...settings, ansiColors: { ...settings.ansiColors } };
    this.visible = true;
    // Integration state is external files, so it can change while the
    // panel is closed (a `ht claude install` in a pane, an editor). Read
    // it fresh on every open rather than trusting the last push.
    this.integrationsActions?.refresh();
    this.renderActiveSection();
    this.overlay.classList.add("visible");
    this.host.open();
    this.host.focusFirst();
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.overlay.classList.remove("visible");
    this.host.close();
  }

  isVisible(): boolean {
    return this.visible;
  }

  updateSettings(settings: AppSettings): void {
    const prev = this.settings;
    const next = { ...settings, ansiColors: { ...settings.ansiColors } };
    this.settings = next;
    if (!this.visible) return;
    // Skip the re-render when the incoming settings match what we already
    // have locally. emit() mirrors changes into this.settings synchronously,
    // so the server's settingsChanged echo arrives as a no-op — re-rendering
    // here would destroy the active <input type="range"> mid-drag and the
    // gesture would only advance one step per pointer move.
    if (settingsEqual(prev, next)) return;
    this.renderActiveSection();
  }

  setDiagnostics(d: SettingsDiagnostics): void {
    this.diagnostics = d;
    // Re-render so Advanced shows the resolved paths if it's currently
    // visible; harmless when another section is active.
    if (this.visible && this.activeSection === "advanced") {
      this.renderActiveSection();
    }
  }

  setHtKeysSeen(keys: string[]): void {
    this.htKeysSeen = [...keys];
    // The discovered-keys block lives in the Layout section.
    if (this.visible && this.activeSection === "layout") {
      this.renderActiveSection();
    }
  }

  /** Host integration wiring, pushed by bun on `integrationsStatus`. */
  setIntegrations(status: IntegrationsStatus): void {
    this.integrations = status;
    // Seed the install checkboxes from what is already wired, ONCE.
    // Re-seeding on every push would fight the user: they untick a
    // feature, the status arrives, the tick comes back.
    if (!this.integrationsSeeded) {
      this.integrationsSeeded = true;
      for (const f of status.claude.features) {
        if (f.state !== "missing") this.selectedBridgeFeatures.add(f.feature);
      }
      // Nothing installed yet — offer the same default set
      // `ht claude install` uses (approvals stays opt-in).
      if (this.selectedBridgeFeatures.size === 0) {
        this.selectedBridgeFeatures.add("lifecycle");
        this.selectedBridgeFeatures.add("tasks");
        this.selectedBridgeFeatures.add("statusline");
      }
    }
    if (this.visible && this.activeSection === "integrations") {
      this.renderActiveSection();
    }
  }

  /** Installed extensions, from the `extensionList` push. */
  setExtensions(extensions: IntegrationExtension[]): void {
    this.integrationExtensions = extensions;
    if (this.visible && this.activeSection === "integrations") {
      this.renderActiveSection();
    }
  }

  // ── Navigation ──

  private buildNav(): void {
    this.nav.innerHTML = "";
    for (const section of this.sections) {
      const btn = document.createElement("button");
      btn.className = `settings-nav-item${section.id === this.activeSection ? " active" : ""}`;
      btn.dataset["section"] = section.id;

      btn.append(createIcon(section.icon, "settings-nav-icon", 14));
      const label = document.createElement("span");
      label.textContent = section.label;
      btn.appendChild(label);

      btn.addEventListener("click", () => {
        this.activeSection = section.id;
        SettingsPanel.saveActiveSection(section.id);
        this.nav
          .querySelectorAll(".settings-nav-item")
          .forEach((el) => el.classList.remove("active"));
        btn.classList.add("active");
        this.renderActiveSection();
      });

      this.nav.appendChild(btn);
    }
  }

  private renderActiveSection(): void {
    this.content.innerHTML = "";
    const section = this.sections.find((s) => s.id === this.activeSection);
    if (section) section.render(this.content, this.settings);
  }

  private static loadActiveSection(): string {
    try {
      const stored = localStorage.getItem(SettingsPanel.STORAGE_KEY);
      return stored ?? "general";
    } catch {
      return "general";
    }
  }

  private static saveActiveSection(id: string): void {
    try {
      localStorage.setItem(SettingsPanel.STORAGE_KEY, id);
    } catch {
      /* ignore — private browsing / storage full */
    }
  }

  // ── Section renderers ──

  private renderGeneral(c: HTMLElement, s: AppSettings): void {
    this.sectionTitle(c, "General");
    this.sectionDesc(
      c,
      "Core terminal behavior. Shell changes apply to new terminals only.",
    );

    this.textField(c, "Shell", s.shellPath || "$SHELL", "shellPath", {
      placeholder: "/bin/zsh",
      note: "Leave empty to use system default ($SHELL)",
    });

    this.numberField(
      c,
      "Scrollback Lines",
      s.scrollbackLines,
      "scrollbackLines",
      {
        min: 100,
        max: 100000,
        step: 500,
      },
    );

    this.segmentedField(c, "Package Runner", s.packageRunner, "packageRunner", [
      { value: "bun", label: "bun" },
      { value: "npm", label: "npm" },
      { value: "pnpm", label: "pnpm" },
      { value: "yarn", label: "yarn" },
    ]);

    this.toggleField(
      c,
      "Auto-approve Claude Code prompts",
      s.claudeAutoApprove,
      "claudeAutoApprove",
      {
        note:
          "Presses Enter on the permission prompt Claude Code shows in a " +
          "terminal pane (its default answer is Yes). Only fires for that " +
          "terminal prompt — never for the τ-mux approval modal or the " +
          "Claude pane — and pauses itself if prompts arrive in a burst. " +
          "Every approval is written to the pane's sidebar log. This grants " +
          "unattended consent for commands the agent asks to run.",
      },
    );
    this.sliderField(
      c,
      "Auto-approve delay",
      s.claudeAutoApproveDelayMs,
      "claudeAutoApproveDelayMs",
      { min: 0, max: 5000, step: 100 },
      (v) => `${Math.round(v)} ms`,
    );

    this.toggleField(
      c,
      "Notification Sound",
      s.notificationSoundEnabled,
      "notificationSoundEnabled",
      { note: "Plays `finish.mp3` when a sidebar notification arrives." },
    );
    this.sliderField(
      c,
      "Notification Volume",
      s.notificationSoundVolume,
      "notificationSoundVolume",
      { min: 0, max: 1, step: 0.05 },
      (v) => `${Math.round(v * 100)}%`,
    );

    this.toggleField(
      c,
      "Notification Overlay",
      s.notificationOverlayEnabled,
      "notificationOverlayEnabled",
      {
        note: "Pop a transient card over the originating surface when a notification arrives. Click the body to focus that pane; click the close button to dismiss.",
      },
    );
    this.sliderField(
      c,
      "Overlay Auto-dismiss",
      s.notificationOverlayMs,
      "notificationOverlayMs",
      { min: 0, max: 30_000, step: 500 },
      (v) => (v === 0 ? "off (manual)" : `${(v / 1000).toFixed(1)}s`),
    );
  }

  private renderAppearance(c: HTMLElement, s: AppSettings): void {
    this.sectionTitle(c, "Appearance");
    this.sectionDesc(c, "Terminal font, cursor, and text rendering.");

    this.textField(c, "Font Family", s.fontFamily, "fontFamily", {
      placeholder: "JetBrainsMono Nerd Font Mono, monospace",
    });

    this.sliderField(
      c,
      "Font Size",
      s.fontSize,
      "fontSize",
      { min: 8, max: 32, step: 1 },
      (v) => `${v}px`,
    );

    this.sliderField(
      c,
      "Line Height",
      s.lineHeight,
      "lineHeight",
      { min: 0.8, max: 2.0, step: 0.05 },
      (v) => v.toFixed(2),
    );

    this.segmentedField(c, "Cursor Style", s.cursorStyle, "cursorStyle", [
      { value: "block", label: "Block" },
      { value: "bar", label: "Bar" },
      { value: "underline", label: "Underline" },
    ]);

    this.toggleField(c, "Cursor Blink", s.cursorBlink, "cursorBlink");

    this.segmentedField(
      c,
      "Renderer",
      s.terminalRenderer,
      "terminalRenderer",
      [
        { value: "webgl", label: "GPU" },
        { value: "dom", label: "DOM" },
      ],
      "GPU draws glyphs from a texture atlas — far cheaper under heavy " +
        "output. Falls back to DOM automatically if WebGL is unavailable." +
        this.rendererFallbackHint(s),
    );
  }

  /**
   * §4.1 — tell the user when the renderer they asked for is not the one
   * they got. "Falls back automatically" is only reassuring if the
   * fallback is visible; silently degrading to DOM and saying nothing
   * looks identical to the GPU path just being slow.
   */
  private rendererFallbackHint(s: AppSettings): string {
    if (s.terminalRenderer !== "webgl") return "";
    const status = this.getRendererStatus?.();
    if (!status || status.active === "webgl") return "";
    const why: Record<string, string> = {
      unsupported: "this machine reports no WebGL context",
      "init-failed": "the WebGL addon failed to initialise",
      "context-lost":
        "the GPU context was lost (driver reset or too many panes)",
    };
    const detail = status.fallbackReason
      ? (why[status.fallbackReason] ?? status.fallbackReason)
      : "WebGL is unavailable";
    return `  Currently running on DOM — ${detail}.`;
  }

  /**
   * τ-mux §9 Layout picker + status-bar keys + workspace-card options.
   * Content lives in `settings-layout-section.ts`; selection is
   * persisted via the same onChange callback every other setting flows
   * through, so the active variant survives a restart.
   */
  private renderLayout(c: HTMLElement, s: AppSettings): void {
    renderLayoutSection(c, s, this.sectionHost());
  }

  /** Host wiring that lives outside `settings.json` — the Claude Code
   *  hook bridge, shell integration, extension enablement. Content in
   *  `settings-integrations.ts`. */
  private renderIntegrations(c: HTMLElement, s: AppSettings): void {
    const view: IntegrationsView = {
      status: this.integrations,
      extensions: this.integrationExtensions,
      selectedFeatures: this.selectedBridgeFeatures,
    };
    renderIntegrationsSection(
      c,
      s,
      view,
      this.integrationsActions ?? NOOP_INTEGRATIONS,
      this.sectionHost(),
    );
  }

  /** Field builders + dispatch, handed to the extracted section
   *  renderers. Bound methods rather than the panel itself: a section
   *  can draw rows, it cannot reach into panel state. */
  private sectionHost(): SettingsSectionHost {
    return {
      sectionTitle: (c, t) => this.sectionTitle(c, t),
      sectionDesc: (c, t) => this.sectionDesc(c, t),
      infoNote: (c, t) => this.infoNote(c, t),
      toggleField: (c, l, v, k, o) => this.toggleField(c, l, v, k, o),
      numberField: (c, l, v, k, o) => this.numberField(c, l, v, k, o),
      segmentedField: (c, l, v, k, o, n) =>
        this.segmentedField(c, l, v, k, o, n),
      emit: (partial) => this.emit(partial),
      rerender: () => this.renderActiveSection(),
      htKeysSeen: () => this.htKeysSeen,
    };
  }

  private renderTheme(c: HTMLElement, s: AppSettings): void {
    this.sectionTitle(c, "Theme");
    this.sectionDesc(c, "Choose a preset or customize individual colors.");

    // ── Chrome theme (data-theme override on top of the OS preference) ──
    // Phase 7 session 3 — the four-way selector picks which `:root[data-theme="…"]`
    // block in `src/shared/web-theme-tokens.css` activates. "system" lets the
    // matchMedia(prefers-color-scheme) listener decide between Graphite Dark
    // and Graphite Light; the explicit values force one regardless of OS.
    this.segmentedField(c, "Chrome Theme", s.chromeTheme, "chromeTheme", [
      { value: "system", label: "System" },
      { value: "graphite-dark", label: "Dark" },
      { value: "graphite-light", label: "Light" },
      { value: "high-contrast", label: "High Contrast" },
    ]);

    // ── Preset cards ──
    const presetsWrap = document.createElement("div");
    presetsWrap.className = "theme-presets";

    for (const preset of THEME_PRESETS) {
      const card = document.createElement("button");
      card.className = `theme-card${preset.id === s.themePreset ? " active" : ""}`;

      // Mini terminal preview
      const preview = document.createElement("div");
      preview.className = "theme-card-preview";
      preview.style.background = preset.ansiColors.black;

      const promptLine = document.createElement("div");
      promptLine.className = "theme-card-prompt";
      const ps1 = document.createElement("span");
      ps1.style.color = preset.ansiColors.green;
      ps1.textContent = "~ $";
      const cmd = document.createElement("span");
      cmd.style.color = preset.foregroundColor;
      cmd.textContent = " ls -la";
      promptLine.append(ps1, cmd);

      const outLine = document.createElement("div");
      outLine.className = "theme-card-output";
      const col1 = document.createElement("span");
      col1.style.color = preset.ansiColors.blue;
      col1.textContent = "src ";
      const col2 = document.createElement("span");
      col2.style.color = preset.ansiColors.yellow;
      col2.textContent = "pkg ";
      const col3 = document.createElement("span");
      col3.style.color = preset.ansiColors.magenta;
      col3.textContent = "README";
      outLine.append(col1, col2, col3);

      // Accent bar at bottom
      const accentBar = document.createElement("div");
      accentBar.className = "theme-card-accent";
      accentBar.style.background = `linear-gradient(90deg, ${preset.accentColor}, ${preset.secondaryColor})`;

      preview.append(promptLine, outLine, accentBar);
      card.appendChild(preview);

      const label = document.createElement("span");
      label.className = "theme-card-label";
      label.textContent = preset.name;
      card.appendChild(label);

      card.addEventListener("click", () => {
        const partial = presetToPartial(preset);
        // I14 — emit dispatches the partial through the parent's
        // updateSettings pipeline; that path is asynchronous, so
        // `this.settings` won't reflect the new preset on the next
        // tick. Apply the partial locally so the immediate re-render
        // can mark the clicked card "active" and refresh swatches
        // without waiting for the bun roundtrip. The authoritative
        // updateSettings push that follows is idempotent — re-applying
        // the same fields is a no-op visually.
        this.settings = {
          ...this.settings,
          ...partial,
          ansiColors: {
            ...this.settings.ansiColors,
            ...(partial.ansiColors ?? {}),
          },
        };
        this.emit(partial);
        this.renderActiveSection();
      });

      presetsWrap.appendChild(card);
    }
    c.appendChild(presetsWrap);

    // ── Customization (collapsible) ──
    const customToggle = document.createElement("button");
    customToggle.className = "settings-expand-btn";
    customToggle.textContent = "Customize Colors";
    const customWrap = document.createElement("div");
    customWrap.className = "settings-collapsible";
    customToggle.addEventListener("click", () => {
      customWrap.classList.toggle("open");
      customToggle.classList.toggle("open");
    });
    c.appendChild(customToggle);
    c.appendChild(customWrap);

    // Accent + secondary
    this.colorField(customWrap, "Accent Color", s.accentColor, "accentColor");
    this.colorField(
      customWrap,
      "Secondary Color",
      s.secondaryColor,
      "secondaryColor",
    );
    this.colorField(
      customWrap,
      "Foreground",
      s.foregroundColor,
      "foregroundColor",
    );

    // Terminal background tint. Stored as "r, g, b" (it is composed with
    // `terminalBgOpacity` into an rgba()), so it can't ride `colorField`
    // — presets were the only way to change it until now.
    this.bgBaseField(customWrap, s.bgBase);

    this.sliderField(
      customWrap,
      "Background Opacity",
      s.terminalBgOpacity,
      "terminalBgOpacity",
      { min: 0, max: 1, step: 0.02 },
      (v) => `${Math.round(v * 100)}%`,
    );

    // ANSI color grid
    const groupEl = document.createElement("div");
    groupEl.className = "settings-field-group";

    const groupLabel = document.createElement("div");
    groupLabel.className = "settings-field-group-label";
    groupLabel.textContent = "Terminal Colors";
    groupEl.appendChild(groupLabel);

    const grid = document.createElement("div");
    grid.className = "settings-color-grid";

    const colorKeys: (keyof AnsiColors)[] = [
      "black",
      "red",
      "green",
      "yellow",
      "blue",
      "magenta",
      "cyan",
      "white",
      "brightBlack",
      "brightRed",
      "brightGreen",
      "brightYellow",
      "brightBlue",
      "brightMagenta",
      "brightCyan",
      "brightWhite",
    ];

    for (const key of colorKeys) {
      const wrap = document.createElement("div");
      wrap.className = "settings-color-cell";

      const input = document.createElement("input");
      input.type = "color";
      input.value = s.ansiColors[key];
      input.title = key;
      input.className = "settings-color-swatch";
      input.addEventListener("input", () => {
        this.emit({
          themePreset: "custom",
          ansiColors: { ...this.settings.ansiColors, [key]: input.value },
        });
      });

      const label = document.createElement("span");
      label.className = "settings-color-label";
      label.textContent = key.replace("bright", "br.");
      wrap.appendChild(input);
      wrap.appendChild(label);
      grid.appendChild(wrap);
    }

    groupEl.appendChild(grid);

    const resetBtn = document.createElement("button");
    resetBtn.className = "settings-reset-btn";
    resetBtn.textContent = "Reset colors to default";
    resetBtn.addEventListener("click", () => {
      this.emit({
        ...presetToPartial(THEME_PRESETS[0]),
      });
      setTimeout(() => this.renderActiveSection(), 20);
    });
    groupEl.appendChild(resetBtn);

    customWrap.appendChild(groupEl);
  }

  private renderEffects(c: HTMLElement, s: AppSettings): void {
    this.sectionTitle(c, "Effects");
    this.sectionDesc(
      c,
      "Optional GPU effect layered over terminal text. The τ-mux design " +
        "system uses only the focused-pane glow — enable bloom only if " +
        "you specifically want the xterm glyphs themselves to bloom.",
    );

    this.toggleField(c, "Terminal Bloom", s.terminalBloom, "terminalBloom", {
      note:
        "Off by design (τ-mux §4: only the focused pane glows). Turning " +
        "this on renders a WebGL bloom pass scoped to the terminal body " +
        "— never to pane chrome or overlays.",
    });

    this.sliderField(
      c,
      "Bloom Intensity",
      s.bloomIntensity,
      "bloomIntensity",
      { min: 0, max: 2, step: 0.05 },
      (v) => v.toFixed(2),
    );

    if (s.bloomMigratedToTau && s.legacyBloomIntensity > 0) {
      this.infoNote(
        c,
        `Your pre-τ-mux bloom intensity (${s.legacyBloomIntensity.toFixed(2)}) ` +
          `was snapshotted during migration. Slider above starts at 0 on ` +
          `fresh installs; set it to ${s.legacyBloomIntensity.toFixed(2)} ` +
          `to restore your previous look.`,
      );

      // I9 — one-click restore. Only meaningful when the slider is at
      // 0 (the user hasn't already nudged it). Once they pick *any*
      // non-zero value the migration is effectively resolved and the
      // button hides — no point letting it overwrite a user's
      // intentional choice.
      if (s.bloomIntensity === 0) {
        const restoreBtn = document.createElement("button");
        restoreBtn.className = "settings-reset-btn";
        restoreBtn.textContent = `Restore previous bloom (${s.legacyBloomIntensity.toFixed(2)})`;
        restoreBtn.addEventListener("click", () => {
          const target = s.legacyBloomIntensity;
          this.settings = { ...this.settings, bloomIntensity: target };
          this.emit({ bloomIntensity: target });
          this.renderActiveSection();
        });
        c.appendChild(restoreBtn);
      }
    }
  }

  private renderNetwork(c: HTMLElement, s: AppSettings): void {
    this.sectionTitle(c, "Network");
    this.sectionDesc(
      c,
      "Web terminal mirror accessible on your local network.",
    );

    this.numberField(c, "Web Mirror Port", s.webMirrorPort, "webMirrorPort", {
      min: 1,
      max: 65535,
      step: 1,
    });

    this.toggleField(
      c,
      "Auto-start Web Mirror",
      s.autoStartWebMirror,
      "autoStartWebMirror",
      { note: "Start the web mirror server when the app launches." },
    );

    // Bind address. Was settings.json-only, which meant the one control
    // that decides whether your terminal is reachable from the network
    // at all was the least discoverable thing in the app.
    this.segmentedField(
      c,
      "Bind Address",
      s.webMirrorBind,
      "webMirrorBind",
      [
        { value: "0.0.0.0", label: "LAN" },
        { value: "127.0.0.1", label: "This Mac only" },
      ],
      "LAN makes the mirror reachable from other devices on your network — pair it with an auth token. This Mac only refuses every non-loopback connection. Changing this restarts a running mirror.",
    );

    // P7 S8 / H.9 — manifest-auth ergonomics. The token has lived as
    // a hidden setting since H.4 (one of the few sensitive fields the
    // wire snapshot deliberately omits). Surface it here with a copy
    // button + a regenerate action so users don't have to hand-edit
    // settings.json to rotate it.
    this.renderAuthTokenRow(c, s);

    // W2 (full_app_review_2026-05.md §6.1) — opt-in RPC socket token.
    this.toggleField(
      c,
      "Require RPC socket token",
      s.rpcSocketRequireToken,
      "rpcSocketRequireToken",
      {
        note: "Require the `ht` CLI to present a per-boot token for state-mutating commands (typing into panes, killing processes). Hardens against other same-user processes driving your terminal. The bundled `ht` and pi/Claude bridges read the token automatically; older external `ht` installs lose mutating commands until updated.",
      },
    );
  }

  /** P7 S8 / H.9 — auth-token row: shows the current token (masked
   *  by default with a peek toggle), a copy-to-clipboard button, and
   *  a one-click regenerate. The new token is dispatched through the
   *  existing `updateSettings` pipeline so the running web server
   *  picks it up. */
  private renderAuthTokenRow(c: HTMLElement, s: AppSettings): void {
    const row = this.fieldRow(c, "Auth Token");

    const wrap = document.createElement("div");
    wrap.className = "settings-color-wrap"; // re-use the input + button row layout

    const input = document.createElement("input");
    input.type = "password";
    input.className = "settings-input";
    input.value = s.webMirrorAuthToken;
    input.placeholder = "(no token — anyone on the LAN can connect)";
    input.style.flex = "1";
    input.setAttribute("aria-label", "Web mirror auth token");
    input.addEventListener("change", () => {
      this.emit({ webMirrorAuthToken: input.value.trim() });
    });

    const peekBtn = document.createElement("button");
    peekBtn.type = "button";
    peekBtn.className = "settings-segment";
    peekBtn.textContent = "Show";
    peekBtn.setAttribute("aria-pressed", "false");
    peekBtn.addEventListener("click", () => {
      const peeking = input.type === "text";
      input.type = peeking ? "password" : "text";
      peekBtn.textContent = peeking ? "Show" : "Hide";
      peekBtn.setAttribute("aria-pressed", peeking ? "false" : "true");
    });

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "settings-segment";
    copyBtn.textContent = "Copy";
    copyBtn.title = "Copy auth token to clipboard";
    copyBtn.addEventListener("click", () => {
      void (async () => {
        try {
          await navigator.clipboard.writeText(input.value);
          const prev = copyBtn.textContent;
          copyBtn.textContent = "Copied";
          setTimeout(() => {
            copyBtn.textContent = prev;
          }, 1100);
        } catch {
          /* clipboard unavailable — silent */
        }
      })();
    });

    const regenBtn = document.createElement("button");
    regenBtn.type = "button";
    regenBtn.className = "settings-segment";
    regenBtn.textContent = "Regenerate";
    regenBtn.title =
      "Replace with a fresh 32-byte hex token. Existing connections must reconnect.";
    regenBtn.addEventListener("click", () => {
      if (
        s.webMirrorAuthToken.length > 0 &&
        !confirm(
          "Replace the current auth token? Connected web mirror clients will need to reconnect with the new URL.",
        )
      ) {
        return;
      }
      const next = generateAuthToken();
      input.value = next;
      this.emit({ webMirrorAuthToken: next });
    });

    wrap.appendChild(input);
    wrap.appendChild(peekBtn);
    wrap.appendChild(copyBtn);
    wrap.appendChild(regenBtn);
    row.appendChild(wrap);

    // Show the LAN URL the user can paste into a phone / laptop.
    if (s.webMirrorAuthToken.length > 0) {
      const note = document.createElement("div");
      note.className = "settings-field-note";
      note.style.marginTop = "6px";
      const hostname =
        typeof window !== "undefined" && window.location.hostname.length > 0
          ? window.location.hostname
          : "<your-host>";
      note.textContent = `Mirror URL: http://${hostname}:${s.webMirrorPort}/?t=${s.webMirrorAuthToken.slice(0, 6)}…`;
      note.title =
        "Token is truncated for display. Use Copy to grab the full URL.";
      c.appendChild(note);
    }
  }

  private renderBrowser(c: HTMLElement, s: AppSettings): void {
    this.sectionTitle(c, "Browser");
    this.sectionDesc(
      c,
      "Built-in browser pane settings. Open a browser split with ⌘⇧L.",
    );

    this.selectField(
      c,
      "Search Engine",
      s.browserSearchEngine,
      "browserSearchEngine",
      [
        { value: "google", label: "Google" },
        { value: "duckduckgo", label: "DuckDuckGo" },
        { value: "bing", label: "Bing" },
        { value: "kagi", label: "Kagi" },
      ],
      "Search engine used when typing non-URL queries in the address bar.",
    );

    this.textField(c, "Home Page", s.browserHomePage, "browserHomePage", {
      placeholder: "about:blank",
      note: "URL to load when opening a new browser pane. Leave empty for a blank page.",
    });

    this.toggleField(
      c,
      "Force Dark Mode",
      s.browserForceDarkMode,
      "browserForceDarkMode",
      {
        note: "Inject dark mode CSS into web pages that don't provide a dark theme.",
      },
    );

    this.toggleField(
      c,
      "Intercept Terminal Links",
      s.browserInterceptTerminalLinks,
      "browserInterceptTerminalLinks",
      {
        note: "Open ⌘-clicked URLs in the built-in browser instead of the system browser.",
      },
    );

    this.segmentedField(
      c,
      "Cookie Isolation",
      s.browserPartitionMode,
      "browserPartitionMode",
      [
        { value: "per-surface", label: "Per pane" },
        { value: "shared", label: "Shared" },
      ],
      "Per pane gives every browser pane its own cookie jar, so two panes can hold two logins to the same site. Shared is the legacy single jar. Applies to NEW panes — existing ones keep the partition they were created with.",
    );

    // ── Cookies subsection ──
    this.sectionTitle(c, "Cookies");
    this.sectionDesc(
      c,
      "Import cookies for use across browser pane sessions. Cookies are auto-injected into matching domains on navigation.",
    );

    const cookieActionsWrap = document.createElement("div");
    cookieActionsWrap.className = "settings-field";
    cookieActionsWrap.style.flexDirection = "column";
    cookieActionsWrap.style.alignItems = "flex-start";
    cookieActionsWrap.style.gap = "8px";

    // Hidden file input for import
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".json,.txt,.cookies";
    fileInput.style.display = "none";
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = reader.result as string;
        // Auto-detect format: JSON starts with [ or {, otherwise Netscape
        const format =
          text.trimStart().startsWith("[") || text.trimStart().startsWith("{")
            ? "json"
            : "netscape";
        htEvents.emit("ht-cookie-import", { data: text, format });
      };
      reader.readAsText(file);
      // Reset so the same file can be re-imported
      fileInput.value = "";
    });
    cookieActionsWrap.appendChild(fileInput);

    const btnRow = document.createElement("div");
    btnRow.style.display = "flex";
    btnRow.style.gap = "8px";
    btnRow.style.flexWrap = "wrap";

    const importBtn = document.createElement("button");
    importBtn.className = "settings-reset-btn";
    importBtn.textContent = "Import Cookie File\u2026";
    importBtn.style.marginTop = "0";
    importBtn.addEventListener("click", () => fileInput.click());
    btnRow.appendChild(importBtn);

    const exportBtn = document.createElement("button");
    exportBtn.className = "settings-reset-btn";
    exportBtn.textContent = "Export All Cookies";
    exportBtn.style.marginTop = "0";
    exportBtn.addEventListener("click", () => {
      htEvents.emit("ht-cookie-export", { format: "json" });
    });
    btnRow.appendChild(exportBtn);

    const clearBtn = document.createElement("button");
    clearBtn.className = "settings-reset-btn";
    clearBtn.textContent = "Clear All Cookies";
    clearBtn.style.marginTop = "0";
    clearBtn.addEventListener("click", () => {
      htEvents.emit("ht-cookie-clear", undefined);
    });
    btnRow.appendChild(clearBtn);

    cookieActionsWrap.appendChild(btnRow);

    const noteEl = document.createElement("div");
    noteEl.className = "settings-field-note";
    noteEl.textContent =
      "Supports JSON (EditThisCookie format) and Netscape/cURL cookie files. HTTP-only cookies are stored but cannot be injected via JavaScript.";
    cookieActionsWrap.appendChild(noteEl);

    c.appendChild(cookieActionsWrap);
  }

  private renderTelegram(c: HTMLElement, s: AppSettings): void {
    this.sectionTitle(c, "Telegram");
    this.sectionDesc(
      c,
      "Bridge to a Telegram bot you control. Token is stored unencrypted in settings.json — use a dedicated bot.",
    );

    this.toggleField(
      c,
      "Enable Service",
      s.telegramEnabled,
      "telegramEnabled",
      { note: "Start the long-poll loop on launch (token required)." },
    );

    this.passwordField(c, "Bot Token", s.telegramBotToken, "telegramBotToken", {
      placeholder: "1234567890:AA…",
      note: "From @BotFather. Service restarts on change.",
    });

    this.textField(
      c,
      "Allowed IDs",
      s.telegramAllowedUserIds,
      "telegramAllowedUserIds",
      {
        placeholder: "8446656662, 123456",
        note: "Comma-separated numeric user IDs. Empty = accept from anyone.",
      },
    );

    this.toggleField(
      c,
      "Forward Notifications",
      s.telegramNotificationsEnabled,
      "telegramNotificationsEnabled",
      { note: "DM sidebar notifications to every allowed ID." },
    );

    this.toggleField(
      c,
      "Smart Buttons on Notifications",
      s.telegramNotificationButtonsEnabled,
      "telegramNotificationButtonsEnabled",
      {
        note:
          "Attach OK / Continue / Stop buttons to forwarded notifications. " +
          "Tapping Continue sends a newline into the originating pane; " +
          "Stop sends Ctrl-C; OK dismisses the notification. Off by default — " +
          "the buttons execute keystrokes on your machine.",
      },
    );

    this.toggleField(
      c,
      "Route ht ask to Telegram",
      s.telegramAskUserEnabled,
      "telegramAskUserEnabled",
      {
        note:
          "Forward agent-driven `ht ask` questions to allow-listed " +
          "Telegram chats. Yes/No/choice render as inline buttons; " +
          "text questions use force_reply so you type the answer in chat; " +
          "confirm-command questions show a two-step gate. Resolved " +
          "messages are edited in place to leave a clean audit trail.",
      },
    );
  }

  /** Plan #09 commit C — Auto-continue settings. Lives at
   *  `s.autoContinue.*` (nested), so the helpers that take a top-
   *  level `keyof AppSettings` don't apply directly. The renderer
   *  hand-rolls each field but reuses the shared CSS classes via
   *  `fieldRow` so the section blends with the rest of the panel. */
  private renderAutoContinue(c: HTMLElement, s: AppSettings): void {
    this.sectionTitle(c, "Auto-continue");
    this.sectionDesc(
      c,
      "On every agent turn-end notification, decide whether to send 'Continue' " +
        "automatically. The engine is off by default and starts in dry-run — " +
        "decisions are logged to the plan panel's audit ring without firing " +
        "until you flip dry-run off.",
    );

    const ac = s.autoContinue;
    const patch = (delta: Partial<AppSettings["autoContinue"]>) =>
      this.emit({ autoContinue: { ...ac, ...delta } });

    // Engine — select
    const engineRow = this.fieldRow(
      c,
      "Engine",
      "Off disables every decision.",
    );
    const engineSel = document.createElement("select");
    engineSel.className = "settings-input";
    for (const opt of [
      { value: "off", label: "off — never decide" },
      { value: "heuristic", label: "heuristic — no model call" },
      { value: "model", label: "model — every turn-end" },
      { value: "hybrid", label: "hybrid — heuristic + model fallback" },
    ]) {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      o.selected = opt.value === ac.engine;
      engineSel.appendChild(o);
    }
    engineSel.addEventListener("change", () => {
      const v = engineSel.value;
      if (v === "off" || v === "heuristic" || v === "model" || v === "hybrid") {
        patch({ engine: v });
      }
    });
    engineRow.appendChild(engineSel);

    // Dry-run — toggle
    const dryRow = this.fieldRow(
      c,
      "Dry run",
      "Log decisions only; never sends text to the agent.",
    );
    const dryToggle = document.createElement("label");
    dryToggle.className = "settings-toggle";
    const dryInput = document.createElement("input");
    dryInput.type = "checkbox";
    dryInput.checked = ac.dryRun;
    dryInput.addEventListener("change", () => {
      patch({ dryRun: dryInput.checked });
    });
    const drySlider = document.createElement("span");
    drySlider.className = "settings-toggle-slider";
    dryToggle.appendChild(dryInput);
    dryToggle.appendChild(drySlider);
    dryRow.appendChild(dryToggle);

    // Cooldown — number
    const cdRow = this.fieldRow(
      c,
      "Cooldown (ms)",
      "Minimum gap between auto-fires on the same surface.",
    );
    const cdInput = document.createElement("input");
    cdInput.type = "number";
    cdInput.min = "0";
    cdInput.max = "60000";
    cdInput.step = "500";
    cdInput.className = "settings-input";
    cdInput.value = String(ac.cooldownMs);
    cdInput.addEventListener("change", () => {
      const n = Number.parseInt(cdInput.value, 10);
      if (Number.isFinite(n)) patch({ cooldownMs: n });
    });
    bindClampFeedback(cdInput, 0, 60000, cdRow);
    cdRow.appendChild(cdInput);

    // Max consecutive — number
    const maxRow = this.fieldRow(
      c,
      "Max consecutive",
      "Pause auto-continue after this many fires without user input.",
    );
    const maxInput = document.createElement("input");
    maxInput.type = "number";
    maxInput.min = "1";
    maxInput.max = "50";
    maxInput.step = "1";
    maxInput.className = "settings-input";
    maxInput.value = String(ac.maxConsecutive);
    maxInput.addEventListener("change", () => {
      const n = Number.parseInt(maxInput.value, 10);
      if (Number.isFinite(n)) patch({ maxConsecutive: n });
    });
    bindClampFeedback(maxInput, 1, 50, maxRow);
    maxRow.appendChild(maxInput);

    // Model name — text
    const modelRow = this.fieldRow(
      c,
      "Model name",
      "Anthropic model id used in 'model' / 'hybrid' modes.",
    );
    const modelInput = document.createElement("input");
    modelInput.type = "text";
    modelInput.className = "settings-input";
    modelInput.placeholder = "claude-haiku-4-5-20251001";
    modelInput.value = ac.modelName;
    modelInput.addEventListener("change", () => {
      patch({ modelName: modelInput.value });
    });
    modelRow.appendChild(modelInput);

    // API key env var — text
    const keyRow = this.fieldRow(
      c,
      "API key env var",
      "Reads the API key from this environment variable; never stored on disk.",
    );
    const keyInput = document.createElement("input");
    keyInput.type = "text";
    keyInput.className = "settings-input";
    keyInput.placeholder = "ANTHROPIC_API_KEY";
    keyInput.value = ac.modelApiKeyEnv;
    keyInput.addEventListener("change", () => {
      patch({ modelApiKeyEnv: keyInput.value });
    });
    keyRow.appendChild(keyInput);
  }

  /** Password-style input. Same wiring as `textField` but masked, with a
   *  show/hide toggle. Used for secrets like the Telegram bot token. */
  private passwordField(
    c: HTMLElement,
    label: string,
    value: string,
    key: keyof AppSettings,
    opts: { placeholder?: string; note?: string } = {},
  ): void {
    const row = this.fieldRow(c, label, opts.note, key);
    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.gap = "6px";
    wrap.style.alignItems = "center";
    wrap.style.flex = "1";

    const input = document.createElement("input");
    input.type = "password";
    input.className = "settings-input";
    input.value = value;
    input.style.flex = "1";
    if (opts.placeholder) input.placeholder = opts.placeholder;
    input.addEventListener("change", () => {
      this.emit({ [key]: input.value });
    });
    wrap.appendChild(input);

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "settings-reset-btn";
    toggleBtn.style.marginTop = "0";
    toggleBtn.textContent = "Show";
    toggleBtn.addEventListener("click", () => {
      const masked = input.type === "password";
      input.type = masked ? "text" : "password";
      toggleBtn.textContent = masked ? "Hide" : "Show";
    });
    wrap.appendChild(toggleBtn);

    row.appendChild(wrap);
  }

  private renderAdvanced(c: HTMLElement, s: AppSettings): void {
    this.sectionTitle(c, "Advanced");
    this.sectionDesc(c, "Layout and spacing. Changes apply immediately.");

    this.numberField(c, "Pane Gap", s.paneGap, "paneGap", {
      min: 0,
      max: 20,
      step: 1,
      note: "Pixel gap between split panes.",
    });

    this.numberField(c, "Sidebar Width", s.sidebarWidth, "sidebarWidth", {
      min: 200,
      max: 600,
      step: 4,
      note: "Width of the sidebar in pixels.",
    });

    this.toggleField(
      c,
      "OSC 9;4 progress reporting",
      s.terminalOsc94Enabled,
      "terminalOsc94Enabled",
      {
        note:
          "Decode ConEmu-style progress escapes (cargo, ninja, modern build " +
          "tools) and bridge them to the workspace progress bar. Disable if a " +
          "tool emits 9;4 noise you don't want surfaced.",
      },
    );

    this.toggleField(
      c,
      "OSC 9 notifications",
      s.terminalOsc9NotifyEnabled,
      "terminalOsc9NotifyEnabled",
      {
        note:
          "Let programs in a pane raise a real notification with " +
          "ESC ] 9 ; message — the channel agent CLIs call “iterm2 " +
          "notifications”. Goes to the overlay, the sidebar, and " +
          "Telegram when forwarding is on.",
      },
    );

    this.toggleField(
      c,
      "Bell notifications",
      s.terminalBellNotifyEnabled,
      "terminalBellNotifyEnabled",
      {
        note:
          "Turn BEL into a notification — the “terminal_bell” " +
          "channel agent CLIs offer. Throttled so a program ringing the " +
          "bell in a loop can't flood the centre.",
      },
    );

    this.toggleField(
      c,
      "OSC 52 clipboard writes",
      s.terminalOsc52WriteEnabled,
      "terminalOsc52WriteEnabled",
      {
        note:
          "Let programs copy to your clipboard with OSC 52 — how a yank " +
          "in nvim or tmux over SSH reaches your local machine. Reading " +
          "the clipboard is always refused and has no setting.",
      },
    );

    this.toggleField(
      c,
      "Claude Code IDE bridge",
      s.ideBridgeEnabled,
      "ideBridgeEnabled",
      {
        note:
          "Advertise this window to Claude Code as an IDE, so a diff it " +
          "proposes opens in an editor pane and waits for your verdict — " +
          "an approval that also reaches Telegram. Loopback only, with a " +
          "per-launch token.",
      },
    );

    // Startup audit expectation. Was settings.json-only, so the only
    // way to silence a false alarm ("your git user.name is wrong") was
    // to hand-edit the file the alarm was complaining about.
    const gitRow = this.fieldRow(
      c,
      "Expected git user.name",
      "Startup audit compares `git config --global user.name` against this. Leave empty to skip the audit entirely.",
      "auditsGitUserNameExpected",
    );
    const gitInput = document.createElement("input");
    gitInput.type = "text";
    gitInput.className = "settings-input";
    gitInput.placeholder = "(audit disabled)";
    gitInput.value = s.auditsGitUserNameExpected ?? "";
    gitInput.setAttribute("aria-label", "Expected git user.name");
    gitInput.addEventListener("change", () => {
      const v = gitInput.value.trim();
      this.emit({ auditsGitUserNameExpected: v === "" ? null : v });
    });
    gitRow.appendChild(gitInput);

    // Diagnostic paths — read-only. Useful when bug-reporting; the
    // "Reveal" button matches the App-menu item of the same name.
    this.diagnosticPathsBlock(c);

    // Reset all
    const resetWrap = document.createElement("div");
    resetWrap.className = "settings-field settings-reset-wrap";
    const resetBtn = document.createElement("button");
    resetBtn.className = "settings-reset-btn settings-reset-all";
    resetBtn.textContent = "Reset All Settings to Defaults";
    resetBtn.addEventListener("click", () => {
      this.emit({ ...DEFAULT_SETTINGS });
    });
    resetWrap.appendChild(resetBtn);
    c.appendChild(resetWrap);
  }

  /** Read-only "Diagnostics" group: log file, socket, config dir. The
   *  log file row gets a "Reveal in Finder" button when the bun bridge
   *  was wired in (production) and silently degrades to a static
   *  readout in test fixtures. */
  private diagnosticPathsBlock(c: HTMLElement): void {
    this.sectionTitle(c, "Diagnostics");
    this.sectionDesc(
      c,
      "Runtime paths for bug reports. Read-only — paste them into issues, or click Reveal to open Finder at the active log file.",
    );

    const d = this.diagnostics;
    const logPath = d?.logPath ?? null;
    const socketPath = d?.socketPath ?? "(not yet known)";
    const configDir = d?.configDir ?? "(not yet known)";

    this.readOnlyPathField(c, "Log file", logPath ?? "(disabled)", {
      revealLabel: logPath && this.onRevealLogFile ? "Reveal" : undefined,
      onReveal: () => this.onRevealLogFile?.(),
    });
    this.readOnlyPathField(c, "Socket", socketPath);
    this.readOnlyPathField(c, "Config dir", configDir);
  }

  /** Inline read-only path display: label, monospace value, optional
   *  action button on the right. Style matches existing settings fields
   *  so the row blends with the surrounding form. */
  private readOnlyPathField(
    c: HTMLElement,
    label: string,
    value: string,
    opts: { revealLabel?: string; onReveal?: () => void } = {},
  ): void {
    const row = this.fieldRow(c, label);
    const wrap = document.createElement("div");
    wrap.className = "settings-input settings-readonly-path";
    wrap.textContent = value;
    wrap.title = value;
    row.appendChild(wrap);
    if (opts.revealLabel && opts.onReveal) {
      const btn = document.createElement("button");
      btn.className = "settings-action-btn";
      btn.textContent = opts.revealLabel;
      btn.addEventListener("click", () => opts.onReveal?.());
      row.appendChild(btn);
    }
  }

  // ── Field builders ──

  private sectionTitle(c: HTMLElement, text: string): void {
    const el = document.createElement("h3");
    el.className = "settings-section-title";
    el.textContent = text;
    c.appendChild(el);
  }

  private sectionDesc(c: HTMLElement, text: string): void {
    const el = document.createElement("p");
    el.className = "settings-section-desc";
    el.textContent = text;
    c.appendChild(el);
  }

  /** Inline informational note — dimmer than sectionDesc, used for
   *  one-shot migration messages (e.g. τ-mux §11 bloom snapshot). */
  private infoNote(c: HTMLElement, text: string): void {
    const el = document.createElement("p");
    el.className = "settings-info-note";
    el.textContent = text;
    c.appendChild(el);
  }

  private textField(
    c: HTMLElement,
    label: string,
    value: string,
    key: keyof AppSettings,
    opts: { placeholder?: string; note?: string } = {},
  ): void {
    const row = this.fieldRow(c, label, opts.note, key);
    const input = document.createElement("input");
    input.type = "text";
    input.className = "settings-input";
    input.value = value;
    if (opts.placeholder) input.placeholder = opts.placeholder;
    input.addEventListener("change", () => {
      this.emit({ [key]: input.value });
    });
    row.appendChild(input);
  }

  private numberField(
    c: HTMLElement,
    label: string,
    value: number,
    key: keyof AppSettings,
    opts: { min: number; max: number; step: number; note?: string },
  ): void {
    const row = this.fieldRow(c, label, opts.note, key);
    const input = document.createElement("input");
    input.type = "number";
    input.className = "settings-input settings-input-number";
    input.value = String(value);
    input.min = String(opts.min);
    input.max = String(opts.max);
    input.step = String(opts.step);
    // `input` instead of `change` so the value applies as the user types
    // or clicks the spin buttons — `change` forced a blur before updates
    // fired, which felt broken when fiddling with font-size / gap values.
    // Matches the slider below (line ~720) which already uses `input`.
    input.addEventListener("input", () => {
      const n = parseFloat(input.value);
      if (!isNaN(n)) this.emit({ [key]: n });
    });
    bindClampFeedback(input, opts.min, opts.max, row);
    row.appendChild(input);
  }

  private sliderField(
    c: HTMLElement,
    label: string,
    value: number,
    key: keyof AppSettings,
    opts: { min: number; max: number; step: number },
    fmt: (v: number) => string,
  ): void {
    const row = this.fieldRow(c, label, undefined, key);
    const wrap = document.createElement("div");
    wrap.className = "settings-slider-wrap";

    const range = document.createElement("input");
    range.type = "range";
    range.className = "settings-range";
    range.min = String(opts.min);
    range.max = String(opts.max);
    range.step = String(opts.step);
    range.value = String(value);

    const display = document.createElement("span");
    display.className = "settings-range-value";
    display.textContent = fmt(value);

    range.addEventListener("input", () => {
      const n = parseFloat(range.value);
      display.textContent = fmt(n);
      this.emit({ [key]: n });
    });

    wrap.appendChild(range);
    wrap.appendChild(display);
    row.appendChild(wrap);
  }

  private toggleField(
    c: HTMLElement,
    label: string,
    value: boolean,
    key: keyof AppSettings,
    opts: { note?: string } = {},
  ): void {
    const row = this.fieldRow(c, label, opts.note, key);
    const toggle = document.createElement("label");
    toggle.className = "settings-toggle";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = value;
    input.addEventListener("change", () => {
      this.emit({ [key]: input.checked });
    });

    const slider = document.createElement("span");
    slider.className = "settings-toggle-slider";

    toggle.appendChild(input);
    toggle.appendChild(slider);
    row.appendChild(toggle);
  }

  private selectField(
    c: HTMLElement,
    label: string,
    value: string,
    key: keyof AppSettings,
    options: { value: string; label: string }[],
    note?: string,
  ): void {
    const row = this.fieldRow(c, label, note, key);
    const select = document.createElement("select");
    select.className = "settings-input";
    for (const opt of options) {
      const option = document.createElement("option");
      option.value = opt.value;
      option.textContent = opt.label;
      option.selected = opt.value === value;
      select.appendChild(option);
    }
    select.addEventListener("change", () => {
      this.emit({ [key]: select.value });
    });
    row.appendChild(select);
  }

  private segmentedField(
    c: HTMLElement,
    label: string,
    value: string,
    key: keyof AppSettings,
    options: { value: string; label: string }[],
    note?: string,
  ): void {
    const row = this.fieldRow(c, label, note, key);
    const group = document.createElement("div");
    group.className = "settings-segmented";

    for (const opt of options) {
      const btn = document.createElement("button");
      btn.className = `settings-segment${opt.value === value ? " active" : ""}`;
      btn.textContent = opt.label;
      btn.addEventListener("click", () => {
        group
          .querySelectorAll(".settings-segment")
          .forEach((el) => el.classList.remove("active"));
        btn.classList.add("active");
        this.emit({ [key]: opt.value });
      });
      group.appendChild(btn);
    }

    row.appendChild(group);
  }

  /** `bgBase` is an "r, g, b" triplet, not a hex string — it is composed
   *  with `terminalBgOpacity` into the pane background. Renders as a
   *  colour swatch plus the raw triplet, and accepts either. */
  private bgBaseField(c: HTMLElement, value: string): void {
    const row = this.fieldRow(
      c,
      "Background",
      "Terminal background tint, blended with Background Opacity.",
      "bgBase",
    );
    const wrap = document.createElement("div");
    wrap.className = "settings-color-wrap";

    const swatch = document.createElement("input");
    swatch.type = "color";
    swatch.className = "settings-color-swatch settings-color-accent";
    swatch.value = rgbTripletToHex(value);
    swatch.setAttribute("aria-label", "Terminal background colour");
    swatch.addEventListener("input", () => {
      const triplet = hexToRgbTriplet(swatch.value);
      raw.value = triplet;
      this.emit({ themePreset: "custom", bgBase: triplet });
    });

    const raw = document.createElement("input");
    raw.type = "text";
    raw.className = "settings-input settings-input-hex";
    raw.value = value;
    raw.setAttribute("aria-label", "Terminal background r, g, b");
    raw.addEventListener("change", () => {
      const triplet = normalizeRgbTriplet(raw.value);
      if (!triplet) {
        raw.value = value;
        return;
      }
      raw.value = triplet;
      swatch.value = rgbTripletToHex(triplet);
      this.emit({ themePreset: "custom", bgBase: triplet });
    });

    wrap.append(swatch, raw);
    row.appendChild(wrap);
  }

  private colorField(
    c: HTMLElement,
    label: string,
    value: string,
    key: keyof AppSettings,
  ): void {
    const row = this.fieldRow(c, label, undefined, key);
    const wrap = document.createElement("div");
    wrap.className = "settings-color-wrap";

    const input = document.createElement("input");
    input.type = "color";
    input.value = value;
    input.className = "settings-color-swatch settings-color-accent";
    input.addEventListener("input", () => {
      hex.value = input.value;
      this.emit({ [key]: input.value });
    });

    const hex = document.createElement("input");
    hex.type = "text";
    hex.className = "settings-input settings-input-hex";
    hex.value = value;
    hex.addEventListener("change", () => {
      if (/^#[0-9a-fA-F]{6}$/.test(hex.value)) {
        input.value = hex.value;
        this.emit({ [key]: hex.value });
      }
    });

    wrap.appendChild(input);
    wrap.appendChild(hex);
    row.appendChild(wrap);
  }

  // ── Helpers ──

  private fieldRow(
    c: HTMLElement,
    label: string,
    note?: string,
    resetKey?: keyof AppSettings,
  ): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "settings-field";

    const labelWrap = document.createElement("div");
    labelWrap.className = "settings-field-label-wrap";

    const labelEl = document.createElement("label");
    labelEl.className = "settings-field-label";
    labelEl.textContent = label;
    labelWrap.appendChild(labelEl);

    if (note) {
      const noteEl = document.createElement("span");
      noteEl.className = "settings-field-note";
      noteEl.textContent = note;
      labelWrap.appendChild(noteEl);
    }

    // P7 S25 / B.U10 — per-field reset-to-default. The button only
    // shows when the live value differs from DEFAULT_SETTINGS. We
    // compare by JSON shape so array / nested-record fields (ansiColors,
    // statusBarKeys, autoContinue) compare value-equal, not ref-equal.
    if (resetKey !== undefined) {
      const current = this.settings[resetKey];
      const def = DEFAULT_SETTINGS[resetKey];
      const dirty = JSON.stringify(current) !== JSON.stringify(def);
      const resetBtn = document.createElement("button");
      resetBtn.type = "button";
      resetBtn.className = "settings-field-reset";
      resetBtn.textContent = "↺";
      resetBtn.title = `Reset ${label} to default`;
      resetBtn.setAttribute("aria-label", `Reset ${label} to default`);
      if (!dirty) resetBtn.classList.add("settings-field-reset-hidden");
      resetBtn.addEventListener("click", () => {
        this.emit({ [resetKey]: def } as Partial<AppSettings>);
      });
      labelWrap.appendChild(resetBtn);
    }

    row.appendChild(labelWrap);
    c.appendChild(row);
    return row;
  }

  private emit(partial: Partial<AppSettings>): void {
    // Eagerly update local copy THROUGH THE SAME VALIDATION the host applies
    // (`mergeSettings` → `validateSettings`, identical to the bun side). This
    // is what makes `updateSettings`'s `settingsEqual` guard work: a slider at
    // 15.3 is clamped to 15 here, so when `applySettings` (and later the bun
    // echo) feed back the clamped 15 the panel sees a no-op and does NOT
    // re-render — otherwise `renderActiveSection()` would destroy the live
    // <input type="range"> mid-drag and the gesture advanced one step at a time.
    this.settings = mergeSettings(this.settings, partial);
    this.onChange(partial);
  }
}

function settingsEqual(a: AppSettings, b: AppSettings): boolean {
  if (a === b) return true;
  const ka = Object.keys(a) as (keyof AppSettings)[];
  const kb = Object.keys(b) as (keyof AppSettings)[];
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    const av = a[k];
    const bv = b[k];
    if (av === bv) continue;
    // The non-primitive fields (`ansiColors`, `statusBarKeys`,
    // `htStatusKeyOrder`, `htStatusKeyHidden`, `autoContinue`, …) come back
    // from `validateSettings` as FRESH instances on every call, so a raw
    // reference compare (`av !== bv`) reported them as different even when the
    // contents were identical. That made this guard always return false and
    // re-render the panel on every settings echo — destroying a live
    // <input type="range"> mid-drag (the "one step at a time" slider bug).
    // Compare arrays/objects by value instead.
    if (
      typeof av === "object" &&
      av !== null &&
      typeof bv === "object" &&
      bv !== null
    ) {
      if (JSON.stringify(av) !== JSON.stringify(bv)) return false;
    } else {
      return false;
    }
  }
  return true;
}

/** "7, 7, 10" → "#07070a". Falls back to black on anything unparseable
 *  so the swatch always has a legal value to show. */
export function rgbTripletToHex(triplet: string): string {
  const parts = triplet.split(",").map((p) => Number.parseInt(p.trim(), 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return "#000000";
  }
  return (
    "#" +
    parts
      .map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0"))
      .join("")
  );
}

/** "#07070a" → "7, 7, 10". */
export function hexToRgbTriplet(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "0, 0, 0";
  const n = Number.parseInt(m[1]!, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/** Accept "7,7,10", "7, 7, 10" or "#07070a" and normalise to the stored
 *  triplet form. Returns null when the input is not one of those — the
 *  caller reverts the field rather than persisting nonsense. */
export function normalizeRgbTriplet(input: string): string | null {
  const text = input.trim();
  if (/^#?[0-9a-f]{6}$/i.test(text)) return hexToRgbTriplet(text);
  const parts = text.split(",").map((p) => p.trim());
  if (parts.length !== 3) return null;
  const nums = parts.map((p) => Number.parseInt(p, 10));
  if (nums.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;
  return nums.join(", ");
}

/** P7 S8 / H.9 — generate a fresh web-mirror auth token. 32 bytes of
 *  crypto-quality randomness rendered as 64 hex chars; matches the
 *  bun-side default-on-empty fallback. `crypto.getRandomValues` is
 *  available in every modern webview; this never runs in tests
 *  without a polyfill. */
export function generateAuthToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * P7 S21 / B.aria-invalid — wire a number `<input>` so it gives an
 * accessible signal when the user types outside [min, max]. Without
 * this, validateSettings() silently clamps and the user gets zero
 * feedback (the typed value just doesn't stick after page refresh).
 *
 * Behaviour:
 *   - On every `input` event, re-evaluate the parsed number.
 *   - If outside the range, set `aria-invalid="true"` and stamp a
 *     short message into a sibling `<span aria-live="polite">`.
 *   - If inside or non-numeric (empty mid-type), clear both signals.
 *
 * The `<span>` is appended to the row container so screen readers
 * pick it up without changing the visual layout (it's display:none
 * via CSS; the `aria-live` region still works while hidden).
 */
export function bindClampFeedback(
  input: HTMLInputElement,
  min: number,
  max: number,
  row: HTMLElement,
): void {
  const msg = document.createElement("span");
  msg.className = "settings-input-error";
  msg.setAttribute("aria-live", "polite");
  msg.setAttribute("role", "status");
  // Stamp the id back as the input's aria-errormessage so AT can
  // announce the message when aria-invalid flips on. Generate a
  // unique id per call so multiple inputs on the same page don't
  // collide.
  const id = `settings-clamp-${++clampFeedbackSeq}`;
  msg.id = id;
  input.setAttribute("aria-errormessage", id);
  row.appendChild(msg);

  const update = (): void => {
    const raw = input.value;
    if (raw === "") {
      input.removeAttribute("aria-invalid");
      msg.textContent = "";
      return;
    }
    const n = parseFloat(raw);
    if (Number.isNaN(n)) {
      input.removeAttribute("aria-invalid");
      msg.textContent = "";
      return;
    }
    if (n < min) {
      input.setAttribute("aria-invalid", "true");
      msg.textContent = `Value below minimum (${min}); will be clamped to ${min}.`;
      return;
    }
    if (n > max) {
      input.setAttribute("aria-invalid", "true");
      msg.textContent = `Value above maximum (${max}); will be clamped to ${max}.`;
      return;
    }
    input.removeAttribute("aria-invalid");
    msg.textContent = "";
  };

  input.addEventListener("input", update);
  input.addEventListener("change", update);
  // Run once on bind so a pre-populated out-of-range value is flagged.
  update();
}

let clampFeedbackSeq = 0;
