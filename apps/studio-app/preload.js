const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("uxRoaiStudio", {
  // Window controls
  minimizeWindow: () => ipcRenderer.send("window-minimize"),
  maximizeWindow: () => ipcRenderer.send("window-maximize"),
  closeWindow: () => ipcRenderer.send("window-close"),
  getPlatform: () => ipcRenderer.invoke("window:getPlatform"),
  onNativeBlurStatus: (callback) => {
    const handler = (_event, success) => callback(success);
    ipcRenderer.on("native-blur-status", handler);
    return () => ipcRenderer.removeListener("native-blur-status", handler);
  },
  getConfig: () => ipcRenderer.invoke("config:get"),
  setAgentUrl: (url) => ipcRenderer.invoke("config:setAgentUrl", url),
  setAgentSettings: (settings) => ipcRenderer.invoke("config:setAgentSettings", settings),
  createProject: (name) => ipcRenderer.invoke("project:create", name),
  deleteProject: (projectId) => ipcRenderer.invoke("project:delete", projectId),
  renameProject: (projectId, newName) => ipcRenderer.invoke("project:rename", projectId, newName),
  setActiveProject: (projectId) => ipcRenderer.invoke("project:setActive", projectId),
  setProjectFolder: (projectId, folderId) => ipcRenderer.invoke("project:setFolder", projectId, folderId),
  setProjectSettings: (projectId, settings) => ipcRenderer.invoke("project:setSettings", projectId, settings),
  createFolder: (name) => ipcRenderer.invoke("folder:create", name),
  renameFolder: (folderId, newName) => ipcRenderer.invoke("folder:rename", folderId, newName),
  deleteFolder: (folderId) => ipcRenderer.invoke("folder:delete", folderId),
  reorderFolder: (folderId, newIndex) => ipcRenderer.invoke("folder:reorder", folderId, newIndex),
  getHealth: () => ipcRenderer.invoke("health:get"),
  listTasks: (limit) => ipcRenderer.invoke("tasks:list", limit),
  createTask: (prompt, projectId, history, attachments, chatId) => ipcRenderer.invoke("tasks:create", prompt, projectId, history, attachments, chatId),
  stopTask: (taskId) => ipcRenderer.invoke("tasks:stop", taskId),
  askQuestion: (question, history) => ipcRenderer.invoke("tasks:ask", question, history),
  approvePlan: (taskId, approved, editedPlan) => ipcRenderer.invoke("tasks:approvePlan", taskId, approved, editedPlan),
  pickImages: () => ipcRenderer.invoke("images:pick"),
  getImagePath: (imageId) => ipcRenderer.invoke("images:getPath", imageId),
  loadTaskHistory: (projectId) => ipcRenderer.invoke("tasks:history:load", projectId),
  saveTaskHistory: (projectId, tasks) => ipcRenderer.invoke("tasks:history:save", projectId, tasks),
  deleteTaskHistory: (projectId, taskId, chatId) => ipcRenderer.invoke("tasks:history:delete", projectId, taskId, chatId),
  createChat: (projectId, title) => ipcRenderer.invoke("chat:create", projectId, title),
  deleteChat: (projectId, chatId) => ipcRenderer.invoke("chat:delete", projectId, chatId),
  renameChat: (projectId, chatId, newTitle) => ipcRenderer.invoke("chat:rename", projectId, chatId, newTitle),
  setActiveChat: (projectId, chatId) => ipcRenderer.invoke("chat:setActive", projectId, chatId),
  loadChatHistory: (projectId, chatId) => ipcRenderer.invoke("tasks:chatHistory:load", projectId, chatId),
  saveChatHistory: (projectId, chatId, tasks) => ipcRenderer.invoke("tasks:chatHistory:save", projectId, chatId, tasks),
  renameTaskHistory: (projectId, taskId, newPrompt, chatId) => ipcRenderer.invoke("tasks:history:rename", projectId, taskId, newPrompt, chatId),
  loadMemory: (projectId) => ipcRenderer.invoke("memory:load", projectId),
  saveMemory: (projectId, entries) => ipcRenderer.invoke("memory:save", projectId, entries),
  addMemory: (projectId, entry) => ipcRenderer.invoke("memory:add", projectId, entry),
  saveAttachmentFromPath: (filePath) => ipcRenderer.invoke("attachments:saveFromPath", filePath),
  saveAttachmentFromBuffer: (buffer, name) => ipcRenderer.invoke("attachments:saveFromBuffer", buffer, name),
  getAgentStatus: () => ipcRenderer.invoke("agent:status"),
  startAgent: () => ipcRenderer.invoke("agent:start"),
  stopAgent: () => ipcRenderer.invoke("agent:stop"),
  onTaskEvent: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("sse:task-event", handler);
    return () => ipcRenderer.removeListener("sse:task-event", handler);
  },
  checkPluginStatus: () => ipcRenderer.invoke("plugin:status"),
  installPlugin: () => ipcRenderer.invoke("plugin:install"),
  fetchDiagLogs: (category, limit) => ipcRenderer.invoke("logs:fetch", category, limit),
});
