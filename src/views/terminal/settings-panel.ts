import type { AppSettings, AnsiColors } from "../../shared/settings";
import {
  DEFAULT_SETTINGS,
  THEME_PRESETS,
  presetToPartial,
} from "../../shared/settings";
import { createIcon } from "./icons";
import { STATUS_KEY_META, STATUS_KEY_GROUPS } from "./status-keys";

type SettingChangeHandler = (partial: Partial<AppSettings>) => void;

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
  private visible = false;
  private sections: Section[];

  constructor(
    onChange: SettingChangeHandler,
    options: { onRevealLogFile?: () => void } = {},
  ) {
    this.onChange = onChange;
    this.onRevealLogFile = options.onRevealLogFile;

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
        id: "advanced",
        label: "Advanced",
        icon: "wrench",
        render: (c, s) => this.renderAdvanced(c, s),
      },
    ];

    // Overlay
    this.overlay = document.createElement("div");
    this.overlay.className = "settings-overlay";
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) this.hide();
    });

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

    this.buildNav();
  }

  show(settings: AppSettings): void {
    this.settings = { ...settings, ansiColors: { ...settings.ansiColors } };
    this.visible = true;
    this.renderActiveSection();
    this.overlay.classList.add("visible");
  }

  hide(): void {
    this.visible = false;
    this.overlay.classList.remove("visible");
  }

  isVisible(): boolean {
    return this.visible;
  }

  updateSettings(settings: AppSettings): void {
    this.settings = { ...settings, ansiColors: { ...settings.ansiColors } };
    if (this.visible) this.renderActiveSection();
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
  }

  /**
   * τ-mux §9 Layout picker — three variant cards with inline SVG
   * miniatures of the layouts. Selection is persisted via the same
   * onChange callback every other setting flows through, so the
   * active variant survives a restart and is visible to bun.
   */
  private renderLayout(c: HTMLElement, s: AppSettings): void {
    this.sectionTitle(c, "Layout");
    this.sectionDesc(
      c,
      "Pick a layout variant. The choice persists across sessions.",
    );

    const variants: {
      id: AppSettings["layoutVariant"];
      name: string;
      blurb: string;
      preview: () => SVGSVGElement;
    }[] = [
      {
        id: "bridge",
        name: "Bridge",
        blurb:
          "Refined default. 240 px sidebar, 3-pane split, Codex/Week/$ status meters.",
        preview: renderBridgeMiniature,
      },
      {
        id: "cockpit",
        name: "Cockpit",
        blurb:
          "Dense. 52 px icon rail, per-pane HUD (model · state · tok/s · $), up to 4 panes.",
        preview: renderCockpitMiniature,
      },
      {
        id: "atlas",
        name: "Atlas",
        blurb:
          "Radical. Workspace graph sidebar with per-node CPU, configurable status keys.",
        preview: renderAtlasMiniature,
      },
    ];

    const wrap = document.createElement("div");
    wrap.className = "layout-cards";
    for (const v of variants) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = `layout-card${v.id === s.layoutVariant ? " active" : ""}`;
      const preview = document.createElement("div");
      preview.className = "layout-card-preview";
      preview.appendChild(v.preview());
      card.appendChild(preview);
      const label = document.createElement("div");
      label.className = "layout-card-label";
      label.textContent = v.name;
      card.appendChild(label);
      const blurb = document.createElement("div");
      blurb.className = "layout-card-blurb";
      blurb.textContent = v.blurb;
      card.appendChild(blurb);
      card.addEventListener("click", () => {
        this.emit({ layoutVariant: v.id });
        setTimeout(() => this.renderActiveSection(), 20);
      });
      wrap.appendChild(card);
    }
    c.appendChild(wrap);

    // ── Status bar keys picker ──
    // The bottom status bar is key-driven (src/views/terminal/status-keys.ts).
    // Users pick which keys show and in what order. Current order is
    // preserved when toggling; disabled keys are appended at the
    // bottom of the pool so enabling them re-adds them at the end.
    this.sectionTitle(c, "Status bar keys");
    this.sectionDesc(
      c,
      "Pick which status keys appear in the bottom bar. Reorder by toggling; active keys render left-to-right in the order below. Keys that have no data to show at the moment are silently skipped.",
    );

    const activeKeys = s.statusBarKeys ?? [];
    const grouped: Record<string, typeof STATUS_KEY_META> = {};
    for (const g of STATUS_KEY_GROUPS) grouped[g] = [];
    for (const meta of STATUS_KEY_META) grouped[meta.group]!.push(meta);

    const grid = document.createElement("div");
    grid.className = "status-key-grid";
    for (const group of STATUS_KEY_GROUPS) {
      const header = document.createElement("div");
      header.className = "status-key-group";
      header.textContent = group;
      grid.appendChild(header);
      const groupWrap = document.createElement("div");
      groupWrap.className = "status-key-group-items";
      for (const meta of grouped[group]!) {
        const row = document.createElement("button");
        row.type = "button";
        const active = activeKeys.includes(meta.id);
        row.className = `status-key-row${active ? " active" : ""}`;
        row.title = meta.description;
        const check = document.createElement("span");
        check.className = "status-key-check";
        check.textContent = active ? "●" : "○";
        row.appendChild(check);
        const label = document.createElement("span");
        label.className = "status-key-label";
        label.textContent = meta.label;
        row.appendChild(label);
        const id = document.createElement("span");
        id.className = "status-key-id tau-mono";
        id.textContent = meta.id;
        row.appendChild(id);
        row.addEventListener("click", () => {
          const next = active
            ? activeKeys.filter((k) => k !== meta.id)
            : [...activeKeys, meta.id];
          this.emit({ statusBarKeys: next });
          setTimeout(() => this.renderActiveSection(), 20);
        });
        groupWrap.appendChild(row);
      }
      grid.appendChild(groupWrap);
    }
    c.appendChild(grid);

    // Reorder controls — per-key ↑/↓ shuffle the active list.
    if (activeKeys.length > 1) {
      this.sectionDesc(
        c,
        `Order (${activeKeys.length} active). The leftmost entry renders nearest the workspace-colour dot.`,
      );
      const orderList = document.createElement("div");
      orderList.className = "status-key-order";
      activeKeys.forEach((id, i) => {
        const meta = STATUS_KEY_META.find((m) => m.id === id);
        if (!meta) return;
        const row = document.createElement("div");
        row.className = "status-key-order-row";
        const label = document.createElement("span");
        label.className = "status-key-order-label";
        label.textContent = meta.label;
        const idSpan = document.createElement("span");
        idSpan.className = "status-key-id tau-mono";
        idSpan.textContent = meta.id;
        const up = document.createElement("button");
        up.type = "button";
        up.className = "status-key-order-btn";
        up.textContent = "↑";
        up.disabled = i === 0;
        up.addEventListener("click", () => {
          if (i === 0) return;
          const next = activeKeys.slice();
          [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
          this.emit({ statusBarKeys: next });
          setTimeout(() => this.renderActiveSection(), 20);
        });
        const down = document.createElement("button");
        down.type = "button";
        down.className = "status-key-order-btn";
        down.textContent = "↓";
        down.disabled = i === activeKeys.length - 1;
        down.addEventListener("click", () => {
          if (i === activeKeys.length - 1) return;
          const next = activeKeys.slice();
          [next[i], next[i + 1]] = [next[i + 1]!, next[i]!];
          this.emit({ statusBarKeys: next });
          setTimeout(() => this.renderActiveSection(), 20);
        });
        row.append(label, idSpan, up, down);
        orderList.appendChild(row);
      });
      c.appendChild(orderList);
    }

    // ── Discovered ht keys ──
    // Live list of every `ht set-status <key>` the running session has
    // seen. Lets users hide noisy keys or reorder them without
    // touching the registry. Empty until at least one script publishes
    // a key — render a hint in that case so the section isn't silently
    // missing.
    this.renderDiscoveredHtKeys(c, s);

    // Plan #06 — workspace-card density + per-section toggles.
    this.renderWorkspaceCardBlock(c, s);
  }

  private renderWorkspaceCardBlock(c: HTMLElement, s: AppSettings): void {
    this.sectionTitle(c, "Workspace card");
    this.sectionDesc(
      c,
      "Density + which sections render in each sidebar workspace card. The header (name + pin + close) is always visible.",
    );

    this.segmentedField(
      c,
      "Density",
      s.workspaceCardDensity,
      "workspaceCardDensity",
      [
        { value: "compact", label: "Compact" },
        { value: "comfortable", label: "Comfortable" },
        { value: "spacious", label: "Spacious" },
      ],
    );

    this.toggleField(
      c,
      "Show meta row",
      s.workspaceCardShowMeta,
      "workspaceCardShowMeta",
      { note: "Foreground command + listening port chips." },
    );
    this.toggleField(
      c,
      "Show stats row",
      s.workspaceCardShowStats,
      "workspaceCardShowStats",
      { note: "Aggregate CPU bar + memory chip across the workspace's panes." },
    );
    this.toggleField(
      c,
      "Show panes list",
      s.workspaceCardShowPanes,
      "workspaceCardShowPanes",
      { note: "Collapsible per-pane list (only when >1 panes)." },
    );
    this.toggleField(
      c,
      "Show manifests",
      s.workspaceCardShowManifests,
      "workspaceCardShowManifests",
      {
        note: "package.json + Cargo.toml cards with quick-launch script chips.",
      },
    );
    this.toggleField(
      c,
      "Show ht status pills",
      s.workspaceCardShowStatusPills,
      "workspaceCardShowStatusPills",
      { note: "`ht set-status` entries displayed in the workspace card." },
    );
    this.toggleField(
      c,
      "Show progress bar",
      s.workspaceCardShowProgress,
      "workspaceCardShowProgress",
      {
        note: "Workspace progress bar driven by `ht set-progress` and OSC 9;4.",
      },
    );
  }

  private renderDiscoveredHtKeys(c: HTMLElement, s: AppSettings): void {
    this.sectionTitle(c, "Discovered ht keys");
    this.sectionDesc(
      c,
      "Every `ht set-status` key seen since this session started. Toggle visibility, reorder. New keys default to visible at the end.",
    );

    if (this.htKeysSeen.length === 0) {
      this.infoNote(
        c,
        "No keys yet. Run `ht set-status <key> <value>` from any pane and the key will appear here.",
      );
      return;
    }

    const hidden = new Set(s.htStatusKeyHidden ?? []);
    const orderRaw = (s.htStatusKeyOrder ?? []).slice();
    // Compose the rendered list: known order first, then any
    // newly-seen keys appended (matches the runtime resolver in
    // `applyHtStatusKeySettings`). Keys in `htStatusKeyOrder` that
    // aren't in `htKeysSeen` are listed last and dimmed so the user
    // sees their stale customisation.
    const seenSet = new Set(this.htKeysSeen);
    const visited = new Set<string>();
    const composed: { key: string; stale: boolean }[] = [];
    for (const k of orderRaw) {
      if (visited.has(k)) continue;
      visited.add(k);
      composed.push({ key: k, stale: !seenSet.has(k) });
    }
    for (const k of this.htKeysSeen) {
      if (visited.has(k)) continue;
      visited.add(k);
      composed.push({ key: k, stale: false });
    }

    const list = document.createElement("div");
    list.className = "status-key-order";
    composed.forEach(({ key, stale }, i) => {
      const row = document.createElement("div");
      row.className = `status-key-order-row ht-key${stale ? " stale" : ""}`;

      const check = document.createElement("button");
      check.type = "button";
      check.className = "status-key-order-btn";
      const isVisible = !hidden.has(key);
      check.textContent = isVisible ? "●" : "○";
      check.title = isVisible ? "Hide this key" : "Show this key";
      check.addEventListener("click", () => {
        const next = isVisible
          ? [...new Set([...(s.htStatusKeyHidden ?? []), key])]
          : (s.htStatusKeyHidden ?? []).filter((k) => k !== key);
        this.emit({ htStatusKeyHidden: next });
        setTimeout(() => this.renderActiveSection(), 20);
      });

      const label = document.createElement("span");
      label.className = "status-key-order-label";
      label.textContent = stale ? `${key} (not seen this session)` : key;

      const up = document.createElement("button");
      up.type = "button";
      up.className = "status-key-order-btn";
      up.textContent = "↑";
      up.disabled = i === 0;
      up.addEventListener("click", () => {
        if (i === 0) return;
        const ordered = composed.map((c) => c.key);
        [ordered[i - 1], ordered[i]] = [ordered[i]!, ordered[i - 1]!];
        this.emit({ htStatusKeyOrder: ordered });
        setTimeout(() => this.renderActiveSection(), 20);
      });

      const down = document.createElement("button");
      down.type = "button";
      down.className = "status-key-order-btn";
      down.textContent = "↓";
      down.disabled = i === composed.length - 1;
      down.addEventListener("click", () => {
        if (i === composed.length - 1) return;
        const ordered = composed.map((c) => c.key);
        [ordered[i], ordered[i + 1]] = [ordered[i + 1]!, ordered[i]!];
        this.emit({ htStatusKeyOrder: ordered });
        setTimeout(() => this.renderActiveSection(), 20);
      });

      row.append(check, label, up, down);
      list.appendChild(row);
    });
    c.appendChild(list);
  }

  private renderTheme(c: HTMLElement, s: AppSettings): void {
    this.sectionTitle(c, "Theme");
    this.sectionDesc(c, "Choose a preset or customize individual colors.");

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
        window.dispatchEvent(
          new CustomEvent("ht-cookie-import", {
            detail: { data: text, format },
          }),
        );
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
      window.dispatchEvent(
        new CustomEvent("ht-cookie-export", { detail: { format: "json" } }),
      );
    });
    btnRow.appendChild(exportBtn);

    const clearBtn = document.createElement("button");
    clearBtn.className = "settings-reset-btn";
    clearBtn.textContent = "Clear All Cookies";
    clearBtn.style.marginTop = "0";
    clearBtn.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("ht-cookie-clear"));
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
    const row = this.fieldRow(c, label, opts.note);
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
    const row = this.fieldRow(c, label, opts.note);
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
    const row = this.fieldRow(c, label, opts.note);
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
    const row = this.fieldRow(c, label);
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
    const row = this.fieldRow(c, label, opts.note);
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
    const row = this.fieldRow(c, label, note);
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
  ): void {
    const row = this.fieldRow(c, label);
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

  private colorField(
    c: HTMLElement,
    label: string,
    value: string,
    key: keyof AppSettings,
  ): void {
    const row = this.fieldRow(c, label);
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

    row.appendChild(labelWrap);
    c.appendChild(row);
    return row;
  }

  private emit(partial: Partial<AppSettings>): void {
    // Eagerly update local copy
    Object.assign(this.settings, partial);
    if (partial.ansiColors) {
      this.settings.ansiColors = {
        ...this.settings.ansiColors,
        ...partial.ansiColors,
      };
    }
    this.onChange(partial);
  }
}

// ─────────────────────────────────────────────────────────────
// τ-mux §9 layout miniatures — inline SVG thumbnails for the
// Settings > Layout picker. Keeps the bundle free of raster
// assets and lets the previews inherit the --tau-* tokens so
// they automatically match the active theme.
// ─────────────────────────────────────────────────────────────
const NS_SVG_LAYOUT = "http://www.w3.org/2000/svg";

function mkRect(
  svg: SVGSVGElement,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  stroke?: string,
): SVGRectElement {
  const r = document.createElementNS(NS_SVG_LAYOUT, "rect");
  r.setAttribute("x", String(x));
  r.setAttribute("y", String(y));
  r.setAttribute("width", String(w));
  r.setAttribute("height", String(h));
  r.setAttribute("fill", fill);
  if (stroke) {
    r.setAttribute("stroke", stroke);
    r.setAttribute("stroke-width", "0.5");
  }
  svg.appendChild(r);
  return r;
}

function baseSvg(): SVGSVGElement {
  const svg = document.createElementNS(NS_SVG_LAYOUT, "svg");
  svg.setAttribute("viewBox", "0 0 160 96");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "auto");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  // Outer window (12 px radius mirrored at 160×96 scale).
  const outer = document.createElementNS(NS_SVG_LAYOUT, "rect");
  outer.setAttribute("x", "1");
  outer.setAttribute("y", "1");
  outer.setAttribute("width", "158");
  outer.setAttribute("height", "94");
  outer.setAttribute("rx", "4");
  outer.setAttribute("fill", "var(--tau-bg)");
  outer.setAttribute("stroke", "var(--tau-edge)");
  outer.setAttribute("stroke-width", "0.5");
  svg.appendChild(outer);
  // Titlebar strip.
  mkRect(svg, 1, 1, 158, 8, "var(--tau-panel)");
  const tau = document.createElementNS(NS_SVG_LAYOUT, "circle");
  tau.setAttribute("cx", "6");
  tau.setAttribute("cy", "5");
  tau.setAttribute("r", "1.2");
  tau.setAttribute("fill", "var(--tau-cyan)");
  svg.appendChild(tau);
  return svg;
}

function renderBridgeMiniature(): SVGSVGElement {
  const svg = baseSvg();
  // 240 px sidebar ≈ 28 px slot here.
  mkRect(svg, 1, 9, 28, 80, "var(--tau-panel)");
  // Three pane split: top-left utility, top-right terminal, wide bottom.
  mkRect(svg, 30, 11, 60, 40, "var(--tau-void)", "var(--tau-edge)");
  mkRect(svg, 92, 11, 66, 40, "var(--tau-void)", "var(--tau-cyan)");
  mkRect(svg, 30, 53, 128, 34, "var(--tau-void)", "var(--tau-edge)");
  // Status bar.
  mkRect(svg, 1, 90, 158, 5, "var(--tau-panel)");
  return svg;
}

function renderCockpitMiniature(): SVGSVGElement {
  const svg = baseSvg();
  // 52 px icon rail ≈ 10 px slot.
  mkRect(svg, 1, 9, 10, 80, "var(--tau-void)", "var(--tau-edge)");
  // 2x2 pane grid with HUD strip (2 px band inside each).
  const panes: [number, number][] = [
    [12, 11],
    [86, 11],
    [12, 50],
    [86, 50],
  ];
  for (const [px, py] of panes) {
    mkRect(svg, px, py, 72, 37, "var(--tau-void)", "var(--tau-edge)");
    // Header
    mkRect(svg, px, py, 72, 4, "var(--tau-panel)");
    // HUD (22 px / 96 ≈ 2 px here)
    mkRect(svg, px, py + 4, 72, 2, "var(--tau-panel-hi)");
  }
  // Status bar.
  mkRect(svg, 1, 90, 158, 5, "var(--tau-panel)");
  return svg;
}

function renderAtlasMiniature(): SVGSVGElement {
  const svg = baseSvg();
  // 220 px graph column ≈ 26 px slot + 4 px tab rail.
  mkRect(svg, 1, 9, 26, 74, "var(--tau-void)", "var(--tau-edge)");
  mkRect(svg, 27, 9, 5, 74, "var(--tau-void)", "var(--tau-edge)");
  // Graph nodes.
  const nodes: [number, number, string][] = [
    [10, 18, "var(--tau-cyan)"],
    [10, 34, "var(--tau-text)"],
    [10, 48, "var(--tau-agent)"],
    [10, 62, "var(--tau-text-dim)"],
  ];
  for (const [cx, cy, fill] of nodes) {
    const c = document.createElementNS(NS_SVG_LAYOUT, "circle");
    c.setAttribute("cx", String(cx));
    c.setAttribute("cy", String(cy));
    c.setAttribute("r", "1.5");
    c.setAttribute("fill", fill);
    svg.appendChild(c);
  }
  // Dashed active edge to the agent node.
  const edge = document.createElementNS(NS_SVG_LAYOUT, "path");
  edge.setAttribute("d", "M 10 18 L 10 48");
  edge.setAttribute("stroke", "var(--tau-cyan)");
  edge.setAttribute("stroke-width", "0.6");
  edge.setAttribute("stroke-dasharray", "1.5 1.5");
  edge.setAttribute("fill", "none");
  svg.appendChild(edge);
  // Pane area.
  mkRect(svg, 33, 11, 125, 72, "var(--tau-void)", "var(--tau-edge)");
  // Ticker strip (32 px instead of 26; ≈ 6 px here).
  mkRect(svg, 1, 89, 158, 6, "var(--tau-void)", "var(--tau-edge)");
  const brand = document.createElementNS(NS_SVG_LAYOUT, "circle");
  brand.setAttribute("cx", "6");
  brand.setAttribute("cy", "92");
  brand.setAttribute("r", "1.2");
  brand.setAttribute("fill", "var(--tau-cyan)");
  svg.appendChild(brand);
  return svg;
}
