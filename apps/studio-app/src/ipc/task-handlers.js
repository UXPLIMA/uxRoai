const { ipcMain } = require("electron");
const { readConfig } = require("../config.js");
const { requestAgent, buildAgentOfflineMessage, isTransientAgentError } = require("../agent-process.js");

function register() {
  ipcMain.handle("health:get", async () => {
    const config = readConfig();
    try {
      return await requestAgent(config, "/health", "GET");
    } catch (error) {
      if (isTransientAgentError(error)) {
        return {
          ok: false,
          offline: true,
          error: buildAgentOfflineMessage(config, error),
        };
      }
      throw error;
    }
  });

  ipcMain.handle("tasks:list", async (_event, limit) => {
    const config = readConfig();
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 100));
    try {
      return await requestAgent(config, `/v1/studio/tasks?limit=${safeLimit}`, "GET");
    } catch (error) {
      if (isTransientAgentError(error)) {
        return {
          tasks: [],
          offline: true,
          error: buildAgentOfflineMessage(config, error),
        };
      }
      throw error;
    }
  });

  ipcMain.handle("tasks:create", async (_event, prompt, projectId, history, attachments, chatId) => {
    const config = readConfig();
    const text = String(prompt || "").trim();
    if (!text) {
      throw new Error("Prompt cannot be empty");
    }
    try {
      const pid = String(projectId || config.activeProjectId || "default");
      const payload = {
        prompt: text,
        projectId: pid,
        source: "uxroai-studio-app",
        history: Array.isArray(history) ? history.slice(0, 10) : [],
        attachments: Array.isArray(attachments) ? attachments.slice(0, 20) : [],
      };
      if (chatId) payload.chatId = String(chatId);
      if (Number.isFinite(config.maxRetries)) payload.maxRetries = config.maxRetries;
      if (Number.isFinite(config.minPlaytestSeconds)) payload.minPlaytestSeconds = config.minPlaytestSeconds;
      if (Number.isFinite(config.planTimeoutSec)) payload.planTimeoutSec = config.planTimeoutSec;
      // Per-project overrides
      const project = (config.projects || []).find(p => p.id === pid);
      if (project?.apiKey) payload.projectApiKey = project.apiKey;
      if (project?.customPrompt) payload.projectCustomPrompt = project.customPrompt;
      return await requestAgent(config, "/v1/studio/tasks", "POST", payload);
    } catch (error) {
      if (isTransientAgentError(error)) {
        throw new Error(buildAgentOfflineMessage(config, error));
      }
      throw error;
    }
  });

  ipcMain.handle("tasks:ask", async (_event, question, history) => {
    const config = readConfig();
    const text = String(question || "").trim();
    if (!text) throw new Error("Question cannot be empty");
    try {
      const payload = { prompt: text };
      if (Array.isArray(history) && history.length > 0) {
        payload.history = history.slice(0, 20);
      }
      return await requestAgent(config, "/v1/ask", "POST", payload, 900_000);
    } catch (error) {
      if (isTransientAgentError(error)) {
        throw new Error(buildAgentOfflineMessage(config, error));
      }
      throw error;
    }
  });

  ipcMain.handle("tasks:stop", async (_event, taskId) => {
    const config = readConfig();
    const id = String(taskId || "").trim();
    if (!id) {
      throw new Error("Task ID required");
    }
    try {
      return await requestAgent(config, `/v1/studio/tasks/${encodeURIComponent(id)}/stop`, "POST", {});
    } catch (error) {
      if (isTransientAgentError(error)) {
        throw new Error(buildAgentOfflineMessage(config, error));
      }
      throw error;
    }
  });

  ipcMain.handle("logs:fetch", async (_event, category, limit) => {
    const config = readConfig();
    try {
      const params = new URLSearchParams();
      if (category) params.set("category", String(category));
      if (limit) params.set("limit", String(Math.min(500, Number(limit) || 200)));
      return await requestAgent(config, `/v1/logs?${params.toString()}`, "GET");
    } catch (error) {
      if (isTransientAgentError(error)) {
        return { ok: false, offline: true, logs: [], diagnostics: null };
      }
      throw error;
    }
  });

  ipcMain.handle("tasks:approvePlan", async (_event, taskId, approved, editedPlan) => {
    const config = readConfig();
    const id = String(taskId || "").trim();
    if (!id) {
      throw new Error("Task ID required");
    }
    try {
      const payload = { approved: approved !== false };
      if (editedPlan && typeof editedPlan === "object") {
        payload.editedPlan = editedPlan;
      }
      return await requestAgent(config, `/v1/studio/tasks/${encodeURIComponent(id)}/approve`, "POST", payload);
    } catch (error) {
      if (isTransientAgentError(error)) {
        throw new Error(buildAgentOfflineMessage(config, error));
      }
      throw error;
    }
  });
}

module.exports = { register };
