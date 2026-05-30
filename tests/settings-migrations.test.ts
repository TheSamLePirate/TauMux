// W4-1 (full_app_review_2026-05.md §14.2) — settings schema migration runner.

import { describe, test, expect } from "bun:test";
import {
  SCHEMA_VERSION_KEY,
  SETTINGS_SCHEMA_VERSION,
  migrateSettings,
  type SettingsMigration,
} from "../src/shared/settings-migrations";

describe("migrateSettings", () => {
  test("a pre-versioning file (no __schemaVersion) is treated as v0 and stamped to target", () => {
    const { data, from, to } = migrateSettings({ theme: "x" }, 1, {});
    expect(from).toBe(0);
    expect(to).toBe(1);
    expect((data as Record<string, unknown>)[SCHEMA_VERSION_KEY]).toBe(1);
    expect((data as Record<string, unknown>).theme).toBe("x");
  });

  test("runs migrations in ascending order and stamps the target", () => {
    const order: number[] = [];
    const migrations: Record<number, SettingsMigration> = {
      0: (s) => {
        order.push(0);
        return { ...s, a: 1 };
      },
      1: (s) => {
        order.push(1);
        return { ...s, b: 2 };
      },
    };
    const { data, from, to } = migrateSettings({}, 2, migrations);
    expect(order).toEqual([0, 1]);
    expect(from).toBe(0);
    expect(to).toBe(2);
    expect(data.a).toBe(1);
    expect(data.b).toBe(2);
    expect(data[SCHEMA_VERSION_KEY]).toBe(2);
  });

  test("only runs migrations from the recorded version forward", () => {
    const ran: number[] = [];
    const migrations: Record<number, SettingsMigration> = {
      0: (s) => {
        ran.push(0);
        return s;
      },
      1: (s) => {
        ran.push(1);
        return s;
      },
    };
    migrateSettings({ [SCHEMA_VERSION_KEY]: 1 }, 2, migrations);
    expect(ran).toEqual([1]); // v0 migration skipped — file was already v1
  });

  test("a file claiming a FUTURE version is returned untouched (no backward migration)", () => {
    const input = { [SCHEMA_VERSION_KEY]: 9, weird: true };
    const { data, from, to } = migrateSettings(input, 1, {
      0: (s) => ({ ...s, ran: true }),
    });
    expect(from).toBe(9);
    expect(to).toBe(9);
    expect(data).toBe(input); // same reference — untouched
    expect(data.ran).toBeUndefined();
  });

  test("a throwing migration stops the chain instead of bricking startup", () => {
    const migrations: Record<number, SettingsMigration> = {
      0: () => {
        throw new Error("boom");
      },
      1: (s) => ({ ...s, reached: true }),
    };
    // Must not throw.
    const { data, to } = migrateSettings({}, 2, migrations);
    expect(to).toBe(2);
    // The chain stopped at the throwing migration; later ones didn't run.
    expect(data.reached).toBeUndefined();
    expect(data[SCHEMA_VERSION_KEY]).toBe(2);
  });

  test("the real registry stamps the current version with no transform today", () => {
    const { data, to } = migrateSettings({ foo: "bar" });
    expect(to).toBe(SETTINGS_SCHEMA_VERSION);
    expect(data[SCHEMA_VERSION_KEY]).toBe(SETTINGS_SCHEMA_VERSION);
    expect(data.foo).toBe("bar");
  });
});
