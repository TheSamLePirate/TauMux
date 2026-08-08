/**
 * Path arithmetic behind "reveal this directory in the sidebar".
 *
 * Clicking a directory in terminal output expands the explorer down to
 * it. Getting the containment test wrong either reveals nothing (root
 * rejected a path it does own) or expands the wrong workspace's tree
 * (`/foo` matched `/foobar`).
 */
import { describe, expect, test } from "bun:test";
import {
  ancestorChain,
  isWithin,
  planReveal,
} from "../src/views/terminal/sidebar-reveal";

describe("isWithin", () => {
  test("a root contains itself", () => {
    expect(isWithin("/repo", "/repo")).toBe(true);
  });

  test("a descendant is contained", () => {
    expect(isWithin("/repo/src/bun", "/repo")).toBe(true);
  });

  test("a sibling with a shared prefix is NOT contained", () => {
    // The bug this exists to prevent: /repo must not claim /repo-other.
    expect(isWithin("/repo-other/src", "/repo")).toBe(false);
  });

  test("a trailing slash on the root does not change the answer", () => {
    expect(isWithin("/repo/src", "/repo/")).toBe(true);
  });

  test("an ancestor is not contained by its child", () => {
    expect(isWithin("/repo", "/repo/src")).toBe(false);
  });
});

describe("ancestorChain", () => {
  test("lists every directory root-first, inclusive of both ends", () => {
    expect(ancestorChain("/repo/src/views/terminal", "/repo")).toEqual([
      "/repo",
      "/repo/src",
      "/repo/src/views",
      "/repo/src/views/terminal",
    ]);
  });

  test("the root itself is a one-element chain", () => {
    expect(ancestorChain("/repo", "/repo")).toEqual(["/repo"]);
  });

  test("a path outside the root has no chain", () => {
    expect(ancestorChain("/elsewhere/x", "/repo")).toEqual([]);
  });

  test("tolerates a trailing slash on the root", () => {
    expect(ancestorChain("/repo/src", "/repo/")).toEqual([
      "/repo",
      "/repo/src",
    ]);
  });
});

describe("planReveal", () => {
  const workspaces = [
    { id: "ws1", root: "/a" },
    { id: "ws2", root: "/b" },
  ];

  test("picks the workspace whose root contains the path", () => {
    expect(planReveal("/b/deep/dir", workspaces)).toEqual({
      workspaceId: "ws2",
      root: "/b",
      expand: ["/b", "/b/deep", "/b/deep/dir"],
    });
  });

  test("returns null when no root contains it, so the caller can say so", () => {
    expect(planReveal("/c/x", workspaces)).toBeNull();
  });

  test("skips workspaces with no explorer root", () => {
    expect(
      planReveal("/b/x", [{ id: "ws0", root: null }, ...workspaces]),
    ).toMatchObject({ workspaceId: "ws2" });
  });

  test("a trailing slash on the target is normalised away", () => {
    expect(planReveal("/a/src/", workspaces)!.expand).toEqual(["/a", "/a/src"]);
  });
});
