import type { ApplicationMenuItemConfig } from "electrobun/bun";
import type { NativeContextMenuRequest } from "../shared/types";
import { WORKSPACE_COLOR_OPTIONS } from "../shared/workspace-colors";

export const APP_NAME = "τ-mux";
export const ELECTROBUN_DOCS_URL =
  "https://www.electrobun.dev/docs/apis/bun/BrowserWindow";

export const MENU_ACTIONS = {
  newWorkspace: "workspace.new",
  splitRight: "surface.split-right",
  splitDown: "surface.split-down",
  closePane: "surface.close",
  renameWorkspace: "workspace.rename",
  renamePane: "surface.rename",
  closeWorkspace: "workspace.close",
  toggleSidebar: "view.toggle-sidebar",
  toggleCommandPalette: "view.toggle-command-palette",
  nextWorkspace: "workspace.next",
  prevWorkspace: "workspace.prev",
  toggleWebMirror: "network.toggle-web-mirror",
  toggleProcessManager: "view.toggle-process-manager",
  copySelection: "edit.copy-selection",
  pasteClipboard: "edit.paste-clipboard",
  selectAll: "edit.select-all",
  openElectrobunDocs: "help.open-electrobun-docs",
  openSettings: "view.open-settings",
  openProjectReadme: "help.open-project-readme",
  setWorkspaceColor: "workspace.set-color",
  installHtCli: "app.install-ht-cli",
  revealLogFile: "app.reveal-log-file",
  browserSplitRight: "browser.split-right",
  browserSplitDown: "browser.split-down",
  agentNew: "agent.new",
  agentSplitRight: "agent.split-right",
  agentSplitDown: "agent.split-down",
} as const;

export function buildApplicationMenu(): ApplicationMenuItemConfig[] {
  return [
    {
      label: APP_NAME,
      submenu: [
        { role: "about" },
        { type: "divider" },
        {
          label: "Settings\u2026",
          action: MENU_ACTIONS.openSettings,
          accelerator: "CmdOrCtrl+,",
        },
        { type: "divider" },
        {
          label: "Install 'ht' Command in PATH",
          action: MENU_ACTIONS.installHtCli,
        },
        {
          label: "Reveal Log File in Finder",
          action: MENU_ACTIONS.revealLogFile,
        },
        { type: "divider" },
        {
          label: "Project README",
          action: MENU_ACTIONS.openProjectReadme,
        },
        {
          label: "Electrobun Documentation",
          action: MENU_ACTIONS.openElectrobunDocs,
        },
        { type: "divider" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "showAll" },
        { type: "divider" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        {
          label: "New Workspace",
          action: MENU_ACTIONS.newWorkspace,
          accelerator: "CmdOrCtrl+N",
        },
        { type: "divider" },
        {
          label: "Split Right",
          action: MENU_ACTIONS.splitRight,
          accelerator: "CmdOrCtrl+D",
        },
        {
          label: "Split Down",
          action: MENU_ACTIONS.splitDown,
          accelerator: "CmdOrCtrl+Shift+D",
        },
        { type: "divider" },
        {
          label: "Split Browser Right",
          action: MENU_ACTIONS.browserSplitRight,
          accelerator: "CmdOrCtrl+Shift+L",
        },
        {
          label: "Split Browser Down",
          action: MENU_ACTIONS.browserSplitDown,
        },
        { type: "divider" },
        {
          label: "New Agent Workspace",
          action: MENU_ACTIONS.agentNew,
        },
        {
          label: "Split Agent Right",
          action: MENU_ACTIONS.agentSplitRight,
        },
        {
          label: "Split Agent Down",
          action: MENU_ACTIONS.agentSplitDown,
        },
        { type: "divider" },
        {
          label: "Rename Workspace...",
          action: MENU_ACTIONS.renameWorkspace,
          accelerator: "CmdOrCtrl+Shift+R",
        },
        {
          label: "Rename Pane...",
          action: MENU_ACTIONS.renamePane,
          accelerator: "CmdOrCtrl+Alt+R",
        },
        { type: "divider" },
        {
          label: "Close Pane",
          action: MENU_ACTIONS.closePane,
          accelerator: "CmdOrCtrl+W",
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "divider" },
        {
          label: "Copy",
          action: MENU_ACTIONS.copySelection,
          accelerator: "CmdOrCtrl+C",
        },
        {
          label: "Paste",
          action: MENU_ACTIONS.pasteClipboard,
          accelerator: "CmdOrCtrl+V",
        },
        {
          label: "Select All",
          action: MENU_ACTIONS.selectAll,
          accelerator: "CmdOrCtrl+A",
        },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Toggle Sidebar",
          action: MENU_ACTIONS.toggleSidebar,
          accelerator: "CmdOrCtrl+B",
        },
        {
          label: "Command Palette...",
          action: MENU_ACTIONS.toggleCommandPalette,
          accelerator: "CmdOrCtrl+Shift+P",
        },
        {
          label: "Process Manager...",
          action: MENU_ACTIONS.toggleProcessManager,
          accelerator: "CmdOrCtrl+Alt+P",
        },
        { type: "divider" },
        {
          label: "Previous Workspace",
          action: MENU_ACTIONS.prevWorkspace,
        },
        {
          label: "Next Workspace",
          action: MENU_ACTIONS.nextWorkspace,
        },
        { type: "divider" },
        {
          label: "Toggle Web Mirror",
          action: MENU_ACTIONS.toggleWebMirror,
        },
        { role: "toggleFullScreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "divider" },
        { role: "bringAllToFront" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Project README",
          action: MENU_ACTIONS.openProjectReadme,
        },
        {
          label: "Electrobun Documentation",
          action: MENU_ACTIONS.openElectrobunDocs,
        },
      ],
    },
  ];
}

export function buildContextMenu(
  request: NativeContextMenuRequest,
): ApplicationMenuItemConfig[] {
  if (request.kind === "workspace") {
    return [
      {
        label: "Rename Workspace...",
        action: MENU_ACTIONS.renameWorkspace,
        data: {
          workspaceId: request.workspaceId,
          name: request.name,
        },
      },
      {
        label: "Color",
        submenu: WORKSPACE_COLOR_OPTIONS.map((option) => ({
          label: option.label,
          action: MENU_ACTIONS.setWorkspaceColor,
          checked: option.value === request.color,
          data: {
            workspaceId: request.workspaceId,
            color: option.value,
          },
        })),
      },
      { type: "divider" },
      {
        label: "Next Workspace",
        action: MENU_ACTIONS.nextWorkspace,
      },
      {
        label: "Previous Workspace",
        action: MENU_ACTIONS.prevWorkspace,
      },
      { type: "divider" },
      {
        label: "Close Workspace",
        action: MENU_ACTIONS.closeWorkspace,
        data: {
          workspaceId: request.workspaceId,
        },
      },
    ];
  }

  return [
    {
      label: "Rename Pane...",
      action: MENU_ACTIONS.renamePane,
      data: {
        surfaceId: request.surfaceId,
        title: request.title,
      },
    },
    { type: "divider" },
    {
      label: "Split Right",
      action: MENU_ACTIONS.splitRight,
      data: {
        surfaceId: request.surfaceId,
      },
    },
    {
      label: "Split Down",
      action: MENU_ACTIONS.splitDown,
      data: {
        surfaceId: request.surfaceId,
      },
    },
    { type: "divider" },
    {
      label: "Copy",
      action: MENU_ACTIONS.copySelection,
    },
    {
      label: "Paste",
      action: MENU_ACTIONS.pasteClipboard,
    },
    { type: "divider" },
    {
      label: "Close Pane",
      action: MENU_ACTIONS.closePane,
      data: {
        surfaceId: request.surfaceId,
      },
    },
  ];
}

export function formatWindowTitle(workspaceName: string | null): string {
  return workspaceName ? `${workspaceName} - ${APP_NAME}` : APP_NAME;
}
