const path = require("node:path");
const fs = require("node:fs");
const { ipcMain, BrowserWindow, dialog } = require("electron");
const { getProjectDataDir } = require("../config.js");
const { IMAGE_EXTENSIONS, TEXT_EXTENSIONS } = require("../constants.js");

function register() {
  ipcMain.handle("images:pick", async () => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (!mainWindow) return [];
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "All Supported", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "txt", "md", "js", "lua", "json", "csv", "log"] },
        { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] },
        { name: "Text Files", extensions: ["txt", "md", "js", "lua", "json", "csv", "log"] },
      ],
    });
    if (result.canceled || !result.filePaths.length) return [];
    const attachments = [];
    const dir = path.join(getProjectDataDir(), "images");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    for (const filePath of result.filePaths) {
      const ext = path.extname(filePath).toLowerCase();
      const isImage = IMAGE_EXTENSIONS.has(ext);
      const prefix = isImage ? "img" : "file";
      const id = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
      const destPath = path.join(dir, id);
      fs.copyFileSync(filePath, destPath);
      attachments.push({ id, originalName: path.basename(filePath), path: destPath, type: isImage ? "image" : "text", ext });
    }
    return attachments;
  });

  ipcMain.handle("attachments:saveFromPath", (_event, filePath) => {
    const resolved = path.resolve(filePath);
    const ext = path.extname(resolved).toLowerCase();
    const isImage = IMAGE_EXTENSIONS.has(ext);
    const isText = TEXT_EXTENSIONS.has(ext);
    if (!isImage && !isText) throw new Error("Unsupported file type: " + ext);
    if (!fs.existsSync(resolved)) throw new Error("File not found");
    const dir = path.join(getProjectDataDir(), "images");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const prefix = isImage ? "img" : "file";
    const id = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    const destPath = path.join(dir, id);
    fs.copyFileSync(filePath, destPath);
    return { id, originalName: path.basename(filePath), path: destPath, type: isImage ? "image" : "text", ext };
  });

  ipcMain.handle("attachments:saveFromBuffer", (_event, buffer, name) => {
    const ext = path.extname(name).toLowerCase() || ".png";
    const isImage = IMAGE_EXTENSIONS.has(ext);
    const dir = path.join(getProjectDataDir(), "images");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    const destPath = path.join(dir, id);
    fs.writeFileSync(destPath, Buffer.from(buffer));
    return { id, originalName: name, path: destPath, type: isImage ? "image" : "text", ext };
  });

  ipcMain.handle("images:getPath", (_event, imageId) => {
    const imagesDir = path.join(getProjectDataDir(), "images");
    const filePath = path.resolve(imagesDir, String(imageId || ""));
    // Prevent path traversal: ensure resolved path stays within imagesDir
    if (!filePath.startsWith(imagesDir + path.sep) && filePath !== imagesDir) {
      return null;
    }
    if (fs.existsSync(filePath)) {
      return filePath;
    }
    return null;
  });
}

module.exports = { register };
