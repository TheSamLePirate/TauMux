import { describe, expect, test } from "bun:test";
import {
  APP_NAME,
  buildApplicationMenu,
  buildContextMenu,
  formatWindowTitle,
  MENU_ACTIONS,
} from "../src/bun/native-menus";
import { WORKSPACE_COLOR_OPTIONS } from "../src/shared/workspace-colors";

describe("native menus", () => {
  test("buildApplicationMenu exposes essential Mac app sections", () => {
    const menu = buildApplicationMenu();

    expect(menu).toHaveLength(6);
    expect((menu[0] as { label: string }).label).toBe(APP_NAME);
    expect((menu[1] as { label: string }).label).toBe("File");
    expect((menu[2] as { label: string }).label).toBe("Edit");
    expect((menu[3] as { label: string }).label).toBe("View");
    expect((menu[4] as { label: string }).label).toBe("Window");
    expect((menu[5] as { label: string }).label).toBe("Help");
  });

  test("workspace context menu includes rename, colors, and close", () => {
    // Drive this from the palette constant rather than a literal hex, so
    // retuning WORKSPACE_COLOR_OPTIONS does not require editing a test
    // that is really about menu structure, not about a specific colour.
    const selected = WORKSPACE_COLOR_OPTIONS[2].value;
    const menu = buildContextMenu({
      kind: "workspace",
      workspaceId: "ws:2",
      name: "Builds",
      color: selected,
    });

    expect((menu[0] as { action: string }).action).toBe(
      MENU_ACTIONS.renameWorkspace,
    );

    const colorMenu = menu[1] as {
      submenu: { checked?: boolean; data?: { color?: string } }[];
    };
    expect(colorMenu.submenu.some((item) => item.checked)).toBe(true);
    expect(
      colorMenu.submenu.some((item) => item.data?.color === selected),
    ).toBe(true);
    // Every palette entry should be offered.
    expect(colorMenu.submenu.length).toBe(WORKSPACE_COLOR_OPTIONS.length);

    const closeItem = menu[menu.length - 1] as { action: string };
    expect(closeItem.action).toBe(MENU_ACTIONS.closeWorkspace);
  });

  test("surface context menu includes split and clipboard actions", () => {
    const menu = buildContextMenu({
      kind: "surface",
      surfaceId: "surface:4",
      title: "Server",
    });

    expect((menu[0] as { action: string }).action).toBe(
      MENU_ACTIONS.renamePane,
    );
    expect((menu[2] as { action: string }).action).toBe(
      MENU_ACTIONS.splitRight,
    );
    expect((menu[3] as { action: string }).action).toBe(MENU_ACTIONS.splitDown);
    expect((menu[5] as { action: string }).action).toBe(
      MENU_ACTIONS.copySelection,
    );
    expect((menu[6] as { action: string }).action).toBe(
      MENU_ACTIONS.pasteClipboard,
    );
  });

  test("formatWindowTitle reflects the active workspace when present", () => {
    expect(formatWindowTitle("Workspace A")).toBe("Workspace A - τ-mux");
    expect(formatWindowTitle(null)).toBe(APP_NAME);
  });
});
