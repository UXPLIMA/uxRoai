const os = require("node:os");
const { readConfig } = require("./config.js");

function applyWindowEffects(mainWindow) {
  const config = readConfig();
  if (!config.transparencyEnabled) return;

  const platform = process.platform;

  if (platform === "win32") {
    const release = os.release(); // e.g. "10.0.22621"
    const buildNumber = parseInt(release.split(".")[2] || "0", 10);

    if (buildNumber >= 22000) {
      // Windows 11 — use native Electron acrylic
      try {
        mainWindow.setBackgroundMaterial("acrylic");
        mainWindow.webContents.once("did-finish-load", () => {
          mainWindow.webContents.send("native-blur-status", true);
        });
      } catch {
        // Electron version may not support setBackgroundMaterial
      }
    } else {
      // Windows 10 — try mica-electron
      try {
        const { PARAMS, VALUE, MicaBrowserWindow } = require("mica-electron");
        if (MicaBrowserWindow && mainWindow.setMicaAcrylicEffect) {
          mainWindow.setMicaAcrylicEffect();
          mainWindow.webContents.once("did-finish-load", () => {
            mainWindow.webContents.send("native-blur-status", true);
          });
        }
      } catch {
        // mica-electron not installed — fallback to CSS
        mainWindow.webContents.once("did-finish-load", () => {
          mainWindow.webContents.send("native-blur-status", false);
        });
      }
    }
  } else if (platform === "darwin") {
    try {
      mainWindow.setVibrancy("under-window");
      mainWindow.setBackgroundColor("#00000000");
      mainWindow.webContents.once("did-finish-load", () => {
        mainWindow.webContents.send("native-blur-status", true);
      });
    } catch {
      mainWindow.webContents.once("did-finish-load", () => {
        mainWindow.webContents.send("native-blur-status", false);
      });
    }
  } else {
    // Linux — CSS fallback only
    mainWindow.webContents.once("did-finish-load", () => {
      mainWindow.webContents.send("native-blur-status", false);
    });
  }
}

module.exports = { applyWindowEffects };
