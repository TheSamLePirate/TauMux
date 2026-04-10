import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  type AppSettings,
  DEFAULT_SETTINGS,
  mergeSettings,
} from "../shared/settings";

export class SettingsManager {
  private settings: AppSettings;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private dir: string,
    private filePath: string,
  ) {
    this.settings = this.load();
  }

  get(): AppSettings {
    return this.settings;
  }

  update(partial: Partial<AppSettings>): AppSettings {
    this.settings = mergeSettings(this.settings, partial);
    this.scheduleSave();
    return this.settings;
  }

  saveNow(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.writeToDisk();
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.writeToDisk(), 500);
  }

  private writeToDisk(): void {
    try {
      if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.settings, null, 2));
    } catch {
      /* ignore write failures */
    }
  }

  private load(): AppSettings {
    try {
      if (!existsSync(this.filePath)) return { ...DEFAULT_SETTINGS };
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      return mergeSettings({ ...DEFAULT_SETTINGS }, parsed);
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }
}
