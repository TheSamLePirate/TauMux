import type { AppSettings, AnsiColors } from "../../shared/settings";
import {
  DEFAULT_SETTINGS,
  THEME_PRESETS,
  presetToPartial,
} from "../../shared/settings";
import { createIcon } from "./icons";

type SettingChangeHandler = (partial: Partial<AppSettings>) => void;

interface Section {
  id: string;
  label: string;
  icon: Parameters<typeof createIcon>[0];
  render: (content: HTMLElement, settings: AppSettings) => void;
}

export class SettingsPanel {
  private overlay: HTMLDivElement;
  private panel: HTMLDivElement;
  private nav: HTMLDivElement;
  private content: HTMLDivElement;
  private settings: AppSettings = { ...DEFAULT_SETTINGS };
  // Persisted across open/close cycles so picking "Theme" and closing
  // doesn't snap back to "General" on reopen. localStorage write is
  // wrapped in try/catch because private-browsing modes throw.
  private static STORAGE_KEY = "hyperterm-canvas.settings-panel.section";
  private activeSection = SettingsPanel.loadActiveSection();
  private onChange: SettingChangeHandler;
  private visible = false;
  private sections: Section[];

  constructor(onChange: SettingChangeHandler) {
    this.onChange = onChange;

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
        this.emit(presetToPartial(preset));
        // Re-render to update active state
        setTimeout(() => this.renderActiveSection(), 20);
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
      "GPU-accelerated visual effects layered over the terminal.",
    );

    this.toggleField(c, "Terminal Bloom", s.terminalBloom, "terminalBloom", {
      note: "Adds blur, glow, and bloom post-processing via WebGL.",
    });

    this.sliderField(
      c,
      "Bloom Intensity",
      s.bloomIntensity,
      "bloomIntensity",
      { min: 0, max: 2, step: 0.05 },
      (v) => v.toFixed(2),
    );
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
