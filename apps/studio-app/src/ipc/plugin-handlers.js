const { ipcMain } = require("electron");
const { checkPluginStatus, installPlugin } = require("../plugin-installer.js");

function register() {
  ipcMain.handle("plugin:status", () => {
    return checkPluginStatus();
  });

  ipcMain.handle("plugin:install", () => {
    return installPlugin();
  });
}

module.exports = { register };
