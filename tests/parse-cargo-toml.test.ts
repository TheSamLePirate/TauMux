import { describe, expect, test } from "bun:test";
import { parseCargoToml } from "../src/bun/parse-cargo-toml";

describe("parseCargoToml", () => {
  test("pulls name + version + edition + description out of [package]", () => {
    const info = parseCargoToml(
      `[package]
name = "crate-x"
version = "0.4.2"
edition = "2021"
description = "A lovely crate"
`,
      "/abs/path/Cargo.toml",
    );
    expect(info).not.toBeNull();
    expect(info).toMatchObject({
      path: "/abs/path/Cargo.toml",
      directory: "/abs/path",
      name: "crate-x",
      version: "0.4.2",
      edition: "2021",
      description: "A lovely crate",
      isWorkspace: false,
    });
    // implicit default binary = package.name
    expect(info!.binaries).toEqual(["crate-x"]);
    expect(info!.features).toEqual([]);
  });

  test("coerces a numeric edition to a string", () => {
    const info = parseCargoToml(
      `[package]
name = "ed"
version = "1.0.0"
edition = 2024
`,
      "/x/Cargo.toml",
    );
    expect(info?.edition).toBe("2024");
  });

  test("collects [[bin]] targets and keeps them instead of the implicit default", () => {
    const info = parseCargoToml(
      `[package]
name = "multibin"
version = "0.1.0"

[[bin]]
name = "server"
path = "src/bin/server.rs"

[[bin]]
name = "cli"
path = "src/bin/cli.rs"
`,
      "/x/Cargo.toml",
    );
    expect(info?.binaries).toEqual(["server", "cli"]);
  });

  test("lists feature flags from [features]", () => {
    const info = parseCargoToml(
      `[package]
name = "feat"
version = "0.1.0"

[features]
default = ["json"]
json = []
protobuf = []
`,
      "/x/Cargo.toml",
    );
    expect(info?.features.sort()).toEqual(["default", "json", "protobuf"]);
  });

  test("recognises a virtual workspace root (no [package])", () => {
    const info = parseCargoToml(
      `[workspace]
members = ["a", "b"]
`,
      "/mono/Cargo.toml",
    );
    expect(info).not.toBeNull();
    expect(info?.isWorkspace).toBe(true);
    expect(info?.name).toBeUndefined();
    expect(info?.binaries).toEqual([]);
  });

  test("returns null when the file is neither a package nor a workspace", () => {
    const info = parseCargoToml(
      `[dependencies]
serde = "1"
`,
      "/x/Cargo.toml",
    );
    expect(info).toBeNull();
  });

  test("returns null on malformed TOML", () => {
    expect(parseCargoToml("not = toml = maybe", "/x/Cargo.toml")).toBeNull();
  });
});
