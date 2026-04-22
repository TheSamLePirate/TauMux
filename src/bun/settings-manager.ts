import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import {
  type AppSettings,
  DEFAULT_SETTINGS,
  applyBloomMigration,
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

  private writeWarned = false;

  private writeToDisk(): void {
    try {
      if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.settings, null, 2));
      this.writeWarned = false;
    } catch (err) {
      // Write failures (disk full, permission denied) used to silently
      // vanish — user had no idea their settings weren't persisting.
      // Log once per transition into "failing" state so a chronic
      // failure doesn't spam the log on every debounced save.
      if (!this.writeWarned) {
        this.writeWarned = true;
        console.error(
          `[settings] failed to write ${this.filePath}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  private load(): AppSettings {
    try {
      if (!existsSync(this.filePath)) return { ...DEFAULT_SETTINGS };
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      // τ-mux §11 bloom gate: stamp the migration flag + snapshot the
      // user's pre-revamp bloomIntensity into legacyBloomIntensity on
      // the first load after upgrading. Deliberately non-destructive —
      // we keep the user's terminalBloom toggle exactly as-is so nobody
      // loses a setting they chose. Persist the stamp next tick so the
      // migration doesn't re-run on every launch.
      const merged = mergeSettings({ ...DEFAULT_SETTINGS }, parsed);
      const migrated = applyBloomMigration(merged);
      if (migrated !== merged) {
        setTimeout(() => {
          this.settings = migrated;
          this.writeToDisk();
        }, 0);
      }
      return migrated;
    } catch (err) {
      // Corrupt settings.json used to silently reset the user to
      // defaults — they'd lose their theme, shell path, etc. with no
      // indication why. Back the file up and log so the user can at
      // least recover manually from the .bak.
      console.warn(
        `[settings] ${this.filePath} is corrupt:`,
        err instanceof Error ? err.message : err,
      );
      try {
        const backup = `${this.filePath}.bak`;
        renameSync(this.filePath, backup);
        console.warn(`[settings] saved corrupt copy to ${backup}`);
      } catch {
        /* best-effort backup — don't block startup */
      }
      return { ...DEFAULT_SETTINGS };
    }
  }
}
