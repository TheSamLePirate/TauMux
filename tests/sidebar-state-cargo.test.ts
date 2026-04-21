import { describe, expect, test } from "bun:test";
import { extractCargoSubcommand } from "../src/views/terminal/sidebar-state";

describe("extractCargoSubcommand", () => {
  test("bare `cargo <sub>`", () => {
    expect(extractCargoSubcommand("cargo build")).toBe("build");
    expect(extractCargoSubcommand("cargo test")).toBe("test");
  });

  test("subcommand with args", () => {
    expect(extractCargoSubcommand("cargo build --release")).toBe("build");
    expect(extractCargoSubcommand("cargo run --bin server --release")).toBe(
      "run",
    );
    expect(
      extractCargoSubcommand("cargo clippy --all-targets -- -D warnings"),
    ).toBe("clippy");
  });

  test("rustup toolchain selector `+nightly`", () => {
    expect(extractCargoSubcommand("cargo +nightly fmt")).toBe("fmt");
    expect(extractCargoSubcommand("cargo +stable build")).toBe("build");
  });

  test("absolute cargo path", () => {
    expect(
      extractCargoSubcommand("/Users/x/.cargo/bin/cargo build --workspace"),
    ).toBe("build");
  });

  test("rejects non-cargo commands", () => {
    expect(extractCargoSubcommand("bun run dev")).toBeNull();
    expect(extractCargoSubcommand("rustc src/main.rs")).toBeNull();
    expect(extractCargoSubcommand("vim Cargo.toml")).toBeNull();
    expect(extractCargoSubcommand("")).toBeNull();
  });

  test("rejects cargo without a subcommand", () => {
    expect(extractCargoSubcommand("cargo")).toBeNull();
    expect(extractCargoSubcommand("cargo --help")).toBeNull();
  });
});
