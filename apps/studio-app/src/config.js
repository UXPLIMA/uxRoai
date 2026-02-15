const path = require("node:path");
const fs = require("node:fs");
const { app } = require("electron");
const {
  SUPPORTED_CLAUDE_MODELS,
  SUPPORTED_CODEX_MODELS,
  SUPPORTED_GEMINI_MODELS,
  SUPPORTED_CLAUDE_PROVIDERS,
  SUPPORTED_LANGUAGES,
  DEFAULT_AGENT_URL,
  DEFAULT_LANGUAGE,
  DEFAULT_CLAUDE_PROVIDER,
  DEFAULT_CLAUDE_CODE_COMMAND,
  DEFAULT_CLAUDE_CODE_ARGS,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_CODEX_COMMAND,
  DEFAULT_CODEX_MODEL,
  DEFAULT_GEMINI_COMMAND,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_CUSTOM_INSTRUCTIONS,
} = require("./constants.js");

// ── Normalizer factories ────────────────────────────────────────

function createValidatedNormalizer(validSet, defaultVal, lowercase = false) {
  return (value) => {
    let text = String(value || "").trim();
    if (lowercase) text = text.toLowerCase();
    return validSet.includes(text) ? text : defaultVal;
  };
}

function createDefaultNormalizer(defaultVal) {
  return (value) => String(value || "").trim() || defaultVal;
}

function createPassthroughNormalizer() {
  return (value) => String(value || "").trim();
}

// ── Normalizers ────────────────────────────────────────────────

function normalizeAgentUrl(url) {
  const text = String(url || "").trim();
  const base = text || DEFAULT_AGENT_URL;
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

function normalizeCustomInstructions(value) {
  if (value === null || value === undefined) return DEFAULT_CUSTOM_INSTRUCTIONS;
  return String(value);
}

function normalizeTimeoutSeconds(value, defaultVal, maxVal = 600) {
  const num = Number(value);
  if (!Number.isFinite(num)) return defaultVal;
  return Math.max(5, Math.min(maxVal, Math.round(num)));
}

const normalizeClaudeApiKey = createPassthroughNormalizer();
const normalizeClaudeModel = createValidatedNormalizer(SUPPORTED_CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL);
const normalizeClaudeProvider = createValidatedNormalizer(SUPPORTED_CLAUDE_PROVIDERS, DEFAULT_CLAUDE_PROVIDER, true);
const normalizeClaudeCodeCommand = createDefaultNormalizer(DEFAULT_CLAUDE_CODE_COMMAND);
const normalizeClaudeCodeArgs = createDefaultNormalizer(DEFAULT_CLAUDE_CODE_ARGS);
const normalizeCodexCommand = createDefaultNormalizer(DEFAULT_CODEX_COMMAND);
const normalizeCodexModel = createValidatedNormalizer(SUPPORTED_CODEX_MODELS, DEFAULT_CODEX_MODEL, true);
const normalizeOpenaiApiKey = createPassthroughNormalizer();
const normalizeGeminiCommand = createDefaultNormalizer(DEFAULT_GEMINI_COMMAND);
const normalizeGeminiModel = createValidatedNormalizer(SUPPORTED_GEMINI_MODELS, DEFAULT_GEMINI_MODEL, true);
const normalizeGeminiApiKey = createPassthroughNormalizer();
const normalizeLanguage = createValidatedNormalizer(SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE, true);

// ── Paths ──────────────────────────────────────────────────────

function getConfigPath() {
  return path.join(app.getPath("userData"), "uxroai-studio-config.json");
}

function getProjectDataDir() {
  return path.join(app.getPath("userData"), "project-data");
}

function ensureProjectDataDir() {
  const dir = getProjectDataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getTaskHistoryPath(projectId) {
  const safeId = String(projectId || "default").replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(getProjectDataDir(), `${safeId}.json`);
}

function getChatHistoryPath(projectId, chatId) {
  const safePid = String(projectId || "default").replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeCid = String(chatId || "default").replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(getProjectDataDir(), `${safePid}_${safeCid}.json`);
}

function readChatHistory(projectId, chatId) {
  const filePath = getChatHistoryPath(projectId, chatId);
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeChatHistory(projectId, chatId, tasks) {
  ensureProjectDataDir();
  const filePath = getChatHistoryPath(projectId, chatId);
  const safeTasks = Array.isArray(tasks) ? tasks.filter(t => t && t.id && t.prompt) : [];
  fs.writeFileSync(filePath, JSON.stringify(safeTasks, null, 2), "utf8");
}

function getMemoryPath(projectId) {
  const safeId = String(projectId || "default").replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(getProjectDataDir(), `${safeId}_memory.json`);
}

// ── Config I/O ─────────────────────────────────────────────────

function getDefaultConfig() {
  return {
    agentUrl: DEFAULT_AGENT_URL,
    claudeProvider: DEFAULT_CLAUDE_PROVIDER,
    claudeCodeCommand: DEFAULT_CLAUDE_CODE_COMMAND,
    claudeCodeArgs: DEFAULT_CLAUDE_CODE_ARGS,
    claudeApiKey: "",
    claudeModel: DEFAULT_CLAUDE_MODEL,
    codexCommand: DEFAULT_CODEX_COMMAND,
    codexModel: DEFAULT_CODEX_MODEL,
    openaiApiKey: "",
    geminiCommand: DEFAULT_GEMINI_COMMAND,
    geminiModel: DEFAULT_GEMINI_MODEL,
    geminiApiKey: "",
    language: DEFAULT_LANGUAGE,
    customInstructions: DEFAULT_CUSTOM_INSTRUCTIONS,
    maxRetries: 10,
    minPlaytestSeconds: 10,
    planTimeoutSec: 600,
    claudeCodeTimeoutSec: 90,
    codexTimeoutSec: 180,
    geminiTimeoutSec: 300,
    activeProjectId: "default",
    projects: [{ id: "default", name: "Default" }],
    folders: [],
    sidebarCollapsed: false,
    transparencyEnabled: false,
    setupCompleted: false,
    welcomeDismissed: false,
  };
}

const CONFIG_NORMALIZERS = [
  ["agentUrl", normalizeAgentUrl, DEFAULT_AGENT_URL],
  ["claudeProvider", normalizeClaudeProvider, DEFAULT_CLAUDE_PROVIDER],
  ["claudeCodeCommand", normalizeClaudeCodeCommand, DEFAULT_CLAUDE_CODE_COMMAND],
  ["claudeCodeArgs", normalizeClaudeCodeArgs, DEFAULT_CLAUDE_CODE_ARGS],
  ["claudeApiKey", normalizeClaudeApiKey, ""],
  ["claudeModel", normalizeClaudeModel, DEFAULT_CLAUDE_MODEL],
  ["codexCommand", normalizeCodexCommand, DEFAULT_CODEX_COMMAND],
  ["codexModel", normalizeCodexModel, DEFAULT_CODEX_MODEL],
  ["openaiApiKey", normalizeOpenaiApiKey, ""],
  ["geminiCommand", normalizeGeminiCommand, DEFAULT_GEMINI_COMMAND],
  ["geminiModel", normalizeGeminiModel, DEFAULT_GEMINI_MODEL],
  ["geminiApiKey", normalizeGeminiApiKey, ""],
  ["language", normalizeLanguage, DEFAULT_LANGUAGE],
];

function normalizeAllConfig(raw) {
  const result = { ...getDefaultConfig(), ...raw };
  for (const [key, fn, fallback] of CONFIG_NORMALIZERS) {
    result[key] = fn(raw[key] || fallback);
  }
  result.customInstructions = normalizeCustomInstructions(raw.customInstructions);
  return result;
}

function readConfig() {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return getDefaultConfig();
  }

  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    const config = normalizeAllConfig(parsed);
    config.projects = Array.isArray(parsed.projects) && parsed.projects.length > 0 ? parsed.projects : [{ id: "default", name: "Default" }];
    config.folders = Array.isArray(parsed.folders) ? parsed.folders : [];
    // Migration: existing configs without setupCompleted should skip setup
    if (parsed.setupCompleted === undefined) {
      config.setupCompleted = true;
    }
    // Migration: existing users already know the app, skip welcome
    if (parsed.welcomeDismissed === undefined) {
      config.welcomeDismissed = true;
    }
    return config;
  } catch {
    return getDefaultConfig();
  }
}

function writeConfig(nextConfig) {
  const configPath = getConfigPath();
  const normalized = normalizeAllConfig(nextConfig);
  // Preserve complex structures that normalizeAllConfig doesn't handle
  normalized.projects = Array.isArray(nextConfig.projects) && nextConfig.projects.length > 0
    ? nextConfig.projects
    : [{ id: "default", name: "Default" }];
  normalized.folders = Array.isArray(nextConfig.folders) ? nextConfig.folders : [];
  fs.writeFileSync(configPath, JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}

function buildConfigResponse(config) {
  return {
    ...config,
    supportedClaudeModels: SUPPORTED_CLAUDE_MODELS.slice(),
    supportedCodexModels: SUPPORTED_CODEX_MODELS.slice(),
    supportedGeminiModels: SUPPORTED_GEMINI_MODELS.slice(),
    supportedClaudeProviders: SUPPORTED_CLAUDE_PROVIDERS.slice(),
    supportedLanguages: SUPPORTED_LANGUAGES.slice(),
  };
}

// ── Task History ───────────────────────────────────────────────

function readTaskHistory(projectId) {
  const filePath = getTaskHistoryPath(projectId);
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeTaskHistory(projectId, tasks) {
  ensureProjectDataDir();
  const filePath = getTaskHistoryPath(projectId);
  const safeTasks = Array.isArray(tasks) ? tasks.filter(t => t && t.id && t.prompt) : [];
  fs.writeFileSync(filePath, JSON.stringify(safeTasks, null, 2), "utf8");
}

// ── Project Memory ─────────────────────────────────────────────

function readMemory(projectId) {
  const filePath = getMemoryPath(projectId);
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeMemory(projectId, entries) {
  ensureProjectDataDir();
  const filePath = getMemoryPath(projectId);
  const safe = Array.isArray(entries) ? entries.slice(-30) : [];
  fs.writeFileSync(filePath, JSON.stringify(safe, null, 2), "utf8");
}

function deleteChatHistoryFile(projectId, chatId) {
  try {
    const filePath = getChatHistoryPath(projectId, chatId);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch { /* silent */ }
}

function deleteAllProjectFiles(projectId, chats) {
  // Delete main project history
  try {
    const mainPath = getTaskHistoryPath(projectId);
    if (fs.existsSync(mainPath)) fs.unlinkSync(mainPath);
  } catch { /* silent */ }
  // Delete all chat history files
  if (Array.isArray(chats)) {
    for (const chat of chats) {
      if (chat && chat.id) deleteChatHistoryFile(projectId, chat.id);
    }
  }
  // Delete memory file
  try {
    const memPath = getMemoryPath(projectId);
    if (fs.existsSync(memPath)) fs.unlinkSync(memPath);
  } catch { /* silent */ }
}

module.exports = {
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
  getProjectDataDir,
  getTaskHistoryPath,
  getChatHistoryPath,
  readConfig,
  writeConfig,
  buildConfigResponse,
  readTaskHistory,
  writeTaskHistory,
  readChatHistory,
  writeChatHistory,
  readMemory,
  writeMemory,
  deleteChatHistoryFile,
  deleteAllProjectFiles,
};
