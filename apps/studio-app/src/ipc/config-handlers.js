const { ipcMain } = require("electron");
const {
  readConfig,
  writeConfig,
  buildConfigResponse,
  normalizeAgentUrl,
  normalizeClaudeProvider,
  normalizeClaudeCodeCommand,
  normalizeClaudeCodeArgs,
  normalizeClaudeApiKey,
  normalizeClaudeModel,
  normalizeCodexCommand,
  normalizeCodexModel,
  normalizeOpenaiApiKey,
  normalizeGeminiCommand,
  normalizeGeminiModel,
  normalizeGeminiApiKey,
  normalizeLanguage,
  normalizeCustomInstructions,
  normalizeTimeoutSeconds,
} = require("../config.js");
const { getManagedAgentStatus, stopManagedAgent, startManagedAgent } = require("../agent-process.js");
const { connectSSE } = require("../sse.js");

function register() {
  ipcMain.handle("config:get", () => {
    return buildConfigResponse(readConfig());
  });

  ipcMain.handle("config:setAgentUrl", (_event, value) => {
    const current = readConfig();
    const config = writeConfig({
      ...current,
      agentUrl: normalizeAgentUrl(value),
    });
    return buildConfigResponse(config);
  });

  ipcMain.handle("config:setAgentSettings", async (_event, payload) => {
    const current = readConfig();
    const next = payload && typeof payload === "object" ? payload : {};
    const config = writeConfig({
      ...current,
      agentUrl: normalizeAgentUrl(next.agentUrl ?? current.agentUrl),
      claudeProvider: normalizeClaudeProvider(next.claudeProvider ?? current.claudeProvider),
      claudeCodeCommand: normalizeClaudeCodeCommand(next.claudeCodeCommand ?? current.claudeCodeCommand),
      claudeCodeArgs: normalizeClaudeCodeArgs(next.claudeCodeArgs ?? current.claudeCodeArgs),
      claudeApiKey: normalizeClaudeApiKey(next.claudeApiKey ?? current.claudeApiKey),
      claudeModel: normalizeClaudeModel(next.claudeModel ?? current.claudeModel),
      codexCommand: normalizeCodexCommand(next.codexCommand ?? current.codexCommand),
      codexModel: normalizeCodexModel(next.codexModel ?? current.codexModel),
      openaiApiKey: normalizeOpenaiApiKey(next.openaiApiKey ?? current.openaiApiKey),
      geminiCommand: normalizeGeminiCommand(next.geminiCommand ?? current.geminiCommand),
      geminiModel: normalizeGeminiModel(next.geminiModel ?? current.geminiModel),
      geminiApiKey: normalizeGeminiApiKey(next.geminiApiKey ?? current.geminiApiKey),
      language: normalizeLanguage(next.language ?? current.language),
      customInstructions: normalizeCustomInstructions(next.customInstructions ?? current.customInstructions),
      maxRetries: Math.max(1, Math.min(20, Math.round(Number(next.maxRetries ?? current.maxRetries) || 10))),
      minPlaytestSeconds: Math.max(0, Math.min(120, Math.round(Number(next.minPlaytestSeconds ?? current.minPlaytestSeconds) || 10))),
      planTimeoutSec: normalizeTimeoutSeconds(next.planTimeoutSec ?? current.planTimeoutSec, 600, 1200),
      claudeCodeTimeoutSec: normalizeTimeoutSeconds(next.claudeCodeTimeoutSec ?? current.claudeCodeTimeoutSec, 90, 1200),
      codexTimeoutSec: normalizeTimeoutSeconds(next.codexTimeoutSec ?? current.codexTimeoutSec, 180, 1200),
      geminiTimeoutSec: normalizeTimeoutSeconds(next.geminiTimeoutSec ?? current.geminiTimeoutSec, 300, 1200),
      sidebarCollapsed: Boolean(next.sidebarCollapsed ?? current.sidebarCollapsed),
      transparencyEnabled: Boolean(next.transparencyEnabled ?? current.transparencyEnabled),
      setupCompleted: Boolean(next.setupCompleted ?? current.setupCompleted),
      welcomeDismissed: Boolean(next.welcomeDismissed ?? current.welcomeDismissed),
    });

    // Auto-restart managed agent so new env vars (timeouts, provider, API keys) take effect
    const agentStatus = getManagedAgentStatus();
    if (agentStatus && agentStatus.running) {
      try {
        await stopManagedAgent();
        await startManagedAgent();
        connectSSE();
      } catch {
        // Agent restart failed — user can manually restart
      }
    }

    return buildConfigResponse(config);
  });
}

module.exports = { register };
