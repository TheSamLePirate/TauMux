import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { SettingsManager } from "../src/bun/settings-manager";
import {
  DEFAULT_SETTINGS,
  validateSettings,
  type AppSettings,
} from "../src/shared/settings";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("SettingsManager persistence recovery", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ht-settings-test-"));
    file = join(dir, "settings.json");
  });

  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  test("a missing settings.json yields defaults without warning", () => {
    const mgr = new SettingsManager(dir, file);
    expect(mgr.get().fontSize).toBeGreaterThan(0);
  });

  test("a valid settings.json round-trips", () => {
    const mgr = new SettingsManager(dir, file);
    mgr.update({ fontSize: 18 });
    mgr.saveNow();
    const reloaded = new SettingsManager(dir, file);
    expect(reloaded.get().fontSize).toBe(18);
  });

  test("a corrupt settings.json is backed up and the user gets defaults", () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, "this is not JSON at all");
    const mgr = new SettingsManager(dir, file);
    // Bad file moved aside…
    expect(existsSync(`${file}.bak`)).toBe(true);
    expect(readFileSync(`${file}.bak`, "utf-8")).toBe(
      "this is not JSON at all",
    );
    // …and the live settings fall back to defaults.
    expect(typeof mgr.get().fontSize).toBe("number");
    // Next save writes a fresh valid file.
    mgr.update({ fontSize: 20 });
    mgr.saveNow();
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    expect(parsed.fontSize).toBe(20);
  });

  test("a partial-schema settings.json merges with defaults, does not back up", () => {
    // Valid JSON but missing most fields shouldn't count as "corrupt".
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify({ fontSize: 24 }));
    const mgr = new SettingsManager(dir, file);
    expect(mgr.get().fontSize).toBe(24);
    // Defaults fill the rest.
    expect(typeof mgr.get().shellPath).toBe("string");
    // No backup for valid-but-partial JSON.
    expect(existsSync(`${file}.bak`)).toBe(false);
  });
});

describe("notification sound settings", () => {
  test("defaults: enabled + full volume", () => {
    expect(DEFAULT_SETTINGS.notificationSoundEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.notificationSoundVolume).toBe(1);
  });

  test("validateSettings clamps volume into [0, 1] and coerces the toggle to boolean", () => {
    const tooLoud: AppSettings = {
      ...DEFAULT_SETTINGS,
      notificationSoundVolume: 2.5,
      // typecast to test the coercion path; runtime JSON.parse can
      // deliver non-booleans if a user hand-edits settings.json.
      notificationSoundEnabled: "yes" as unknown as boolean,
    };
    const tooQuiet: AppSettings = {
      ...DEFAULT_SETTINGS,
      notificationSoundVolume: -0.4,
      notificationSoundEnabled: 0 as unknown as boolean,
    };
    expect(validateSettings(tooLoud).notificationSoundVolume).toBe(1);
    expect(validateSettings(tooLoud).notificationSoundEnabled).toBe(true);
    expect(validateSettings(tooQuiet).notificationSoundVolume).toBe(0);
    expect(validateSettings(tooQuiet).notificationSoundEnabled).toBe(false);
  });
});
