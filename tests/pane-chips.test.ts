import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

import { chipsSignature, renderSurfaceChips } from "../src/shared/pane-chips";
import type { SurfaceMetadata } from "../src/shared/types";

function meta(overrides: Partial<SurfaceMetadata> = {}): SurfaceMetadata {
  return {
    pid: 1,
    foregroundPid: 1,
    cwd: "/tmp",
    tree: [],
    listeningPorts: [],
    git: null,
    packageJson: null,
    updatedAt: 0,
    ...overrides,
  };
}

describe("shared pane-chips", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  test("foreground command chip omitted when fg is the shell itself", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    renderSurfaceChips(
      host,
      meta({
        pid: 100,
        foregroundPid: 100, // same as shell pid
        tree: [{ pid: 100, ppid: 1, command: "/bin/zsh", cpu: 0, rssKb: 0 }],
      }),
      { onPortClick: () => {} },
    );
    expect(host.querySelector(".chip-command")).toBeNull();
  });

  test("foreground command chip shown when fg differs + truncated past 48 chars", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const longCmd = "node ".repeat(20).trim();
    renderSurfaceChips(
      host,
      meta({
        pid: 100,
        foregroundPid: 200,
        tree: [
          { pid: 100, ppid: 1, command: "/bin/zsh", cpu: 0, rssKb: 0 },
          { pid: 200, ppid: 100, command: longCmd, cpu: 0, rssKb: 0 },
        ],
      }),
      { onPortClick: () => {} },
    );
    const chip = host.querySelector(".chip-command")!;
    expect(chip).not.toBeNull();
    expect(chip.textContent!.length).toBeLessThanOrEqual(48);
    expect(chip.textContent!.endsWith("…")).toBe(true);
  });

  test("port chips dedup duplicate ports + click invokes onPortClick", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const seen: number[] = [];
    renderSurfaceChips(
      host,
      meta({
        listeningPorts: [
          { pid: 1, port: 3000, proto: "tcp", address: "127.0.0.1" },
          { pid: 1, port: 3000, proto: "tcp", address: "::1" }, // dup
          { pid: 2, port: 8080, proto: "tcp", address: "127.0.0.1" },
        ],
      }),
      { onPortClick: (port) => seen.push(port) },
    );
    const chips = host.querySelectorAll(".chip-port");
    expect(chips.length).toBe(2);
    (chips[0] as HTMLElement).click();
    (chips[1] as HTMLElement).click();
    expect(seen).toEqual([3000, 8080]);
  });

  test("git chip is dirty when any of staged/unstaged/untracked/conflicts/insertions/deletions > 0", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    renderSurfaceChips(
      host,
      meta({
        git: {
          branch: "main",
          head: "deadbeef",
          upstream: "origin/main",
          ahead: 0,
          behind: 0,
          staged: 0,
          unstaged: 1,
          untracked: 0,
          conflicts: 0,
          insertions: 0,
          deletions: 0,
          detached: false,
        },
      }),
      { onPortClick: () => {} },
    );
    const chip = host.querySelector(".chip-git");
    expect(chip).not.toBeNull();
    expect(chip!.classList.contains("dirty")).toBe(true);
    expect(chip!.querySelector(".chip-git-branch")?.textContent).toContain(
      "main",
    );
  });

  test("signature cache short-circuits an unchanged re-render", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const m = meta({ cwd: "/work" });
    renderSurfaceChips(host, m, { onPortClick: () => {} });
    const sig1 = host.dataset["chipsSig"];
    const firstChild = host.firstChild;
    // Re-render with byte-identical inputs — same signature, same DOM nodes.
    renderSurfaceChips(host, m, { onPortClick: () => {} });
    expect(host.dataset["chipsSig"]).toBe(sig1);
    expect(host.firstChild).toBe(firstChild);
  });

  test("chipsSignature is stable across the timestamp `updatedAt` field", () => {
    const a = chipsSignature(meta({ cwd: "/x", updatedAt: 1000 }));
    const b = chipsSignature(meta({ cwd: "/x", updatedAt: 9999 }));
    expect(a).toBe(b);
  });

  // P7 S3 — A11y. The chip row is a derived telemetry surface; AT
  // users get nothing from the icons + numbers alone, so the host is
  // marked aria-live="polite" and each chip carries an aria-label
  // with the spoken version of its value.
  test("host carries an aria-live status region marker", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    renderSurfaceChips(host, meta({ cwd: "/work" }), { onPortClick: () => {} });
    expect(host.getAttribute("role")).toBe("status");
    expect(host.getAttribute("aria-live")).toBe("polite");
  });

  test("cwd chip aria-label spells out the full working directory", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    renderSurfaceChips(
      host,
      meta({ cwd: "/Users/me/Documents/DEV/crazyShell" }),
      { onPortClick: () => {} },
    );
    const cwdChip = host.querySelector(".chip-cwd")!;
    expect(cwdChip.getAttribute("aria-label")).toBe(
      "Working directory: /Users/me/Documents/DEV/crazyShell",
    );
  });

  test("command chip aria-label spells out the full command (no truncation)", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const longCmd = "node ".repeat(20).trim();
    renderSurfaceChips(
      host,
      meta({
        pid: 100,
        foregroundPid: 200,
        tree: [
          { pid: 100, ppid: 1, command: "/bin/zsh", cpu: 0, rssKb: 0 },
          { pid: 200, ppid: 100, command: longCmd, cpu: 0, rssKb: 0 },
        ],
      }),
      { onPortClick: () => {} },
    );
    const chip = host.querySelector(".chip-command")!;
    // Visible text is truncated for the chip; the aria-label keeps the
    // full command so AT users hear what's actually running.
    expect(chip.getAttribute("aria-label")).toBe(
      `Foreground command: ${longCmd}`,
    );
  });

  test("port chip aria-label tells AT users what the click does", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    renderSurfaceChips(
      host,
      meta({
        listeningPorts: [
          { pid: 42, port: 3000, proto: "tcp", address: "127.0.0.1" },
        ],
      }),
      { onPortClick: () => {} },
    );
    const chip = host.querySelector(".chip-port")!;
    expect(chip.getAttribute("aria-label")).toBe(
      "Open port 3000 (tcp 127.0.0.1, pid 42)",
    );
  });

  test("git chip aria-label folds branch + ahead/behind/dirty into prose", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    renderSurfaceChips(
      host,
      meta({
        git: {
          branch: "feature/x",
          head: "abc",
          upstream: "origin/feature/x",
          ahead: 2,
          behind: 1,
          staged: 0,
          unstaged: 3,
          untracked: 0,
          conflicts: 0,
          insertions: 12,
          deletions: 4,
          detached: false,
        },
      }),
      { onPortClick: () => {} },
    );
    const chip = host.querySelector(".chip-git")!;
    expect(chip.getAttribute("aria-label")).toBe(
      "Git: branch feature/x, 2 ahead, 1 behind, +12 lines, -4 lines",
    );
  });

  test("git chip aria-label says 'clean' when the working tree is unmodified", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    renderSurfaceChips(
      host,
      meta({
        git: {
          branch: "main",
          head: "abc",
          upstream: "origin/main",
          ahead: 0,
          behind: 0,
          staged: 0,
          unstaged: 0,
          untracked: 0,
          conflicts: 0,
          insertions: 0,
          deletions: 0,
          detached: false,
        },
      }),
      { onPortClick: () => {} },
    );
    const chip = host.querySelector(".chip-git")!;
    expect(chip.getAttribute("aria-label")).toBe("Git: branch main, clean");
  });
});
