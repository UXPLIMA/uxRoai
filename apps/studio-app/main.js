const path = require("node:path");
const { app, BrowserWindow, Menu, nativeImage, ipcMain } = require("electron");

// Suppress GPU/VSync errors on Linux (Chromium gl_surface_presentation_helper)
app.disableHardwareAcceleration();

// Wayland taskbar icon: must match StartupWMClass in .desktop file
app.setName("uxRoai Studio");

// ── Single instance lock ──────────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

const { registerAllHandlers } = require("./src/ipc/register.js");
const { connectSSE, disconnectSSE } = require("./src/sse.js");
const { killAgentSync } = require("./src/agent-process.js");
const { applyWindowEffects } = require("./src/window-effects.js");

// ── Register all IPC handlers ─────────────────────────────────

registerAllHandlers();

// ── Window ────────────────────────────────────────────────────

let mainWindow = null;

function createWindow() {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1080,
    minHeight: 680,
    frame: false,
    titleBarStyle: "hidden",
    titleBarOverlay: false,
    backgroundColor: "#10141e",
    show: false,
    autoHideMenuBar: true,
    icon: nativeImage.createFromPath(path.join(__dirname, "renderer", "icon-512.png")),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  applyWindowEffects(mainWindow);

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });
}

// ── Window control IPC ────────────────────────────────────────

ipcMain.on("window-minimize", () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on("window-maximize", () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
});

ipcMain.on("window-close", () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle("window:getPlatform", () => process.platform);

// ── App Lifecycle ─────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  connectSSE();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  disconnectSSE();
  killAgentSync();
});
