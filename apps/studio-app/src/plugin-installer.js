const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { app } = require("electron");

const PLUGIN_FILENAME = "uxRoai.plugin.lua";

function getPluginSourcePath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "plugin", PLUGIN_FILENAME);
  }
  return path.resolve(__dirname, "..", "..", "studio-plugin", "dist", PLUGIN_FILENAME);
}

function getRobloxPluginsDir() {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || path.join(require("node:os").homedir(), "AppData", "Local");
    return path.join(localAppData, "Roblox", "Plugins");
  }
  if (process.platform === "darwin") {
    return path.join(require("node:os").homedir(), "Documents", "Roblox", "Plugins");
  }
  return null;
}

function fileHash(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash("md5").update(content).digest("hex");
  } catch {
    return null;
  }
}

function checkPluginStatus() {
  const sourcePath = getPluginSourcePath();
  const pluginsDir = getRobloxPluginsDir();

  if (!pluginsDir) {
    return { status: "unsupported", message: "Platform not supported for auto-install" };
  }

  if (!fs.existsSync(sourcePath)) {
    return { status: "no_source", message: "Bundled plugin not found" };
  }

  const installedPath = path.join(pluginsDir, PLUGIN_FILENAME);

  if (!fs.existsSync(pluginsDir)) {
    return { status: "no_plugins_dir", message: "Roblox Plugins folder not found", pluginsDir };
  }

  if (!fs.existsSync(installedPath)) {
    return { status: "not_installed", sourcePath, installedPath, pluginsDir };
  }

  const sourceHash = fileHash(sourcePath);
  const installedHash = fileHash(installedPath);

  if (sourceHash && installedHash && sourceHash === installedHash) {
    return { status: "up_to_date", installedPath };
  }

  return { status: "outdated", sourcePath, installedPath, pluginsDir };
}

function installPlugin() {
  const check = checkPluginStatus();

  if (check.status === "up_to_date") {
    return { installed: false, message: "Plugin already up to date" };
  }

  if (check.status === "unsupported" || check.status === "no_source") {
    return { installed: false, message: check.message };
  }

  if (check.status === "no_plugins_dir") {
    try {
      fs.mkdirSync(check.pluginsDir, { recursive: true });
    } catch (err) {
      return { installed: false, message: `Cannot create plugins dir: ${err.message}` };
    }
  }

  const sourcePath = check.sourcePath || getPluginSourcePath();
  const pluginsDir = check.pluginsDir || getRobloxPluginsDir();
  const installedPath = path.join(pluginsDir, PLUGIN_FILENAME);

  try {
    fs.copyFileSync(sourcePath, installedPath);
    return { installed: true, message: "Plugin installed/updated successfully", path: installedPath };
  } catch (err) {
    return { installed: false, message: `Install failed: ${err.message}` };
  }
}

module.exports = { checkPluginStatus, installPlugin, getRobloxPluginsDir };
