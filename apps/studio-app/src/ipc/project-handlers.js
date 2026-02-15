const fs = require("node:fs");
const { ipcMain } = require("electron");
const { readConfig, writeConfig, buildConfigResponse, getTaskHistoryPath, getChatHistoryPath, deleteAllProjectFiles } = require("../config.js");

function register() {
  ipcMain.handle("project:create", (_event, name) => {
    const current = readConfig();
    const projectName = String(name || "").trim();
    if (!projectName) {
      throw new Error("Project name required");
    }
    const id = `project_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const project = { id, name: projectName.slice(0, 80) };
    const projects = [project, ...current.projects];
    const config = writeConfig({ ...current, projects, activeProjectId: id });
    return buildConfigResponse(config);
  });

  ipcMain.handle("project:delete", (_event, projectId) => {
    const current = readConfig();
    // Find the project being deleted to get its chats list for cleanup
    const deletedProject = (current.projects || []).find((p) => p.id === projectId);
    const projects = (current.projects || []).filter((p) => p.id !== projectId);
    const activeProjectId =
      current.activeProjectId === projectId
        ? projects.length > 0
          ? projects[0].id
          : "__none__"
        : current.activeProjectId;
    const config = writeConfig({ ...current, projects, activeProjectId });
    // Delete all project files: main history, all chat histories, memory
    deleteAllProjectFiles(projectId, deletedProject?.chats);
    return buildConfigResponse(config);
  });

  ipcMain.handle("project:rename", (_event, projectId, newName) => {
    const current = readConfig();
    const trimmed = String(newName || "").trim().slice(0, 80);
    if (!trimmed) return buildConfigResponse(current);
    const projects = (current.projects || []).map((p) =>
      p.id === projectId ? { ...p, name: trimmed } : p
    );
    const config = writeConfig({ ...current, projects });
    return buildConfigResponse(config);
  });

  ipcMain.handle("project:setActive", (_event, projectId) => {
    const current = readConfig();
    const config = writeConfig({
      ...current,
      activeProjectId: String(projectId || "default"),
    });
    return buildConfigResponse(config);
  });

  ipcMain.handle("project:setFolder", (_event, projectId, folderId) => {
    const current = readConfig();
    const projects = (current.projects || []).map((p) =>
      p.id === projectId ? { ...p, folderId: folderId || null } : p
    );
    const config = writeConfig({ ...current, projects });
    return buildConfigResponse(config);
  });

  ipcMain.handle("folder:create", (_event, name) => {
    const current = readConfig();
    const folderName = String(name || "").trim();
    if (!folderName) {
      throw new Error("Folder name required");
    }
    const id = `folder_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const folder = { id, name: folderName.slice(0, 80) };
    const folders = [...(current.folders || []), folder];
    const config = writeConfig({ ...current, folders });
    return buildConfigResponse(config);
  });

  ipcMain.handle("folder:rename", (_event, folderId, newName) => {
    const current = readConfig();
    const folders = (current.folders || []).map((f) =>
      f.id === folderId ? { ...f, name: String(newName || "").trim().slice(0, 80) || f.name } : f
    );
    const config = writeConfig({ ...current, folders });
    return buildConfigResponse(config);
  });

  ipcMain.handle("folder:delete", (_event, folderId) => {
    const current = readConfig();
    const folders = (current.folders || []).filter((f) => f.id !== folderId);
    const projects = (current.projects || []).map((p) =>
      p.folderId === folderId ? { ...p, folderId: null } : p
    );
    const config = writeConfig({ ...current, folders, projects });
    return buildConfigResponse(config);
  });

  ipcMain.handle("folder:reorder", (_event, folderId, newIndex) => {
    const current = readConfig();
    const folders = [...(current.folders || [])];
    const oldIndex = folders.findIndex((f) => f.id === folderId);
    if (oldIndex === -1) return buildConfigResponse(current);
    const [moved] = folders.splice(oldIndex, 1);
    folders.splice(newIndex, 0, moved);
    const config = writeConfig({ ...current, folders });
    return buildConfigResponse(config);
  });

  // ── Per-Project Settings ───────────────────────────────────

  ipcMain.handle("project:setSettings", (_event, projectId, settings) => {
    const current = readConfig();
    const projects = (current.projects || []).map((p) => {
      if (p.id !== projectId) return p;
      const updated = { ...p };
      if (settings.apiKey !== undefined) updated.apiKey = String(settings.apiKey || "").trim();
      if (settings.customPrompt !== undefined) updated.customPrompt = String(settings.customPrompt || "");
      return updated;
    });
    const config = writeConfig({ ...current, projects });
    return buildConfigResponse(config);
  });

  // ── Chat Threads ───────────────────────────────────────────

  ipcMain.handle("chat:create", (_event, projectId, title) => {
    const current = readConfig();
    const chatTitle = String(title || "").trim() || `Chat ${Date.now()}`;
    const chatId = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const projects = (current.projects || []).map((p) => {
      if (p.id !== projectId) return p;
      const chats = Array.isArray(p.chats) ? [...p.chats] : [];
      chats.push({ id: chatId, title: chatTitle.slice(0, 80), createdAt: new Date().toISOString() });
      return { ...p, chats, activeChatId: chatId };
    });
    const config = writeConfig({ ...current, projects });
    return buildConfigResponse(config);
  });

  ipcMain.handle("chat:delete", (_event, projectId, chatId) => {
    const current = readConfig();
    const projects = (current.projects || []).map((p) => {
      if (p.id !== projectId) return p;
      const chats = (p.chats || []).filter((c) => c.id !== chatId);
      const activeChatId = p.activeChatId === chatId
        ? (chats.length > 0 ? chats[0].id : null)
        : p.activeChatId;
      return { ...p, chats, activeChatId };
    });
    const config = writeConfig({ ...current, projects });
    // Delete chat history file
    try {
      const historyPath = getChatHistoryPath(projectId, chatId);
      if (fs.existsSync(historyPath)) fs.unlinkSync(historyPath);
    } catch { /* silent */ }
    return buildConfigResponse(config);
  });

  ipcMain.handle("chat:rename", (_event, projectId, chatId, newTitle) => {
    const current = readConfig();
    const trimmed = String(newTitle || "").trim().slice(0, 80);
    if (!trimmed) return buildConfigResponse(current);
    const projects = (current.projects || []).map((p) => {
      if (p.id !== projectId) return p;
      const chats = (p.chats || []).map((c) =>
        c.id === chatId ? { ...c, title: trimmed } : c
      );
      return { ...p, chats };
    });
    const config = writeConfig({ ...current, projects });
    return buildConfigResponse(config);
  });

  ipcMain.handle("chat:setActive", (_event, projectId, chatId) => {
    const current = readConfig();
    const projects = (current.projects || []).map((p) => {
      if (p.id !== projectId) return p;
      return { ...p, activeChatId: chatId || null };
    });
    const config = writeConfig({ ...current, projects });
    return buildConfigResponse(config);
  });
}

module.exports = { register };
