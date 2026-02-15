const { ipcMain } = require("electron");
const { readTaskHistory, writeTaskHistory, readChatHistory, writeChatHistory, readMemory, writeMemory } = require("../config.js");

function register() {
  ipcMain.handle("tasks:history:load", (_event, projectId) => {
    const id = projectId || "default";
    if (id === "__none__") return [];
    return readTaskHistory(id);
  });

  ipcMain.handle("tasks:history:delete", (_event, projectId, taskId) => {
    const tasks = readTaskHistory(projectId || "default");
    const filtered = tasks.filter((t) => String(t.id) !== String(taskId));
    writeTaskHistory(projectId || "default", filtered);
    return { ok: true };
  });

  ipcMain.handle("tasks:history:rename", (_event, projectId, taskId, newPrompt) => {
    const tasks = readTaskHistory(projectId || "default");
    for (const task of tasks) {
      if (String(task.id) === String(taskId)) {
        task.prompt = String(newPrompt || "").slice(0, 12000);
        break;
      }
    }
    writeTaskHistory(projectId || "default", tasks);
    return { ok: true };
  });

  ipcMain.handle("tasks:history:save", (_event, projectId, tasks) => {
    writeTaskHistory(projectId || "default", tasks);
    return { ok: true };
  });

  // Chat-specific history
  ipcMain.handle("tasks:chatHistory:load", (_event, projectId, chatId) => {
    if (!chatId) return readTaskHistory(projectId || "default");
    return readChatHistory(projectId || "default", chatId);
  });

  ipcMain.handle("tasks:chatHistory:save", (_event, projectId, chatId, tasks) => {
    if (!chatId) {
      writeTaskHistory(projectId || "default", tasks);
    } else {
      writeChatHistory(projectId || "default", chatId, tasks);
    }
    return { ok: true };
  });

  ipcMain.handle("memory:load", (_event, projectId) => {
    return readMemory(projectId || "default");
  });

  ipcMain.handle("memory:save", (_event, projectId, entries) => {
    writeMemory(projectId || "default", entries);
    return { ok: true };
  });

  ipcMain.handle("memory:add", (_event, projectId, entry) => {
    const id = projectId || "default";
    const entries = readMemory(id);
    entries.push({
      text: String(entry?.text || "").slice(0, 500),
      source: String(entry?.source || "auto"),
      addedAt: new Date().toISOString(),
    });
    writeMemory(id, entries);
    return { ok: true };
  });
}

module.exports = { register };
