import { getModel, getCodexModel, getGeminiModel, getCodeTimeoutMs, getGeminiTimeoutMs, getCodexTimeoutMs } from "./base.js";
import { callClaudeCodeJson, hasClaudeCodeConfig } from "./claude-code.js";
import { callCodexCliJson, hasCodexCliConfig } from "./codex-cli.js";
import { callGeminiCliJson, hasGeminiCliConfig } from "./gemini-cli.js";

const PROVIDER_REGISTRY = {
  codex:      { hasConfig: hasCodexCliConfig,                call: callCodexCliJson },
  gemini:     { hasConfig: hasGeminiCliConfig,                call: callGeminiCliJson },
  code:       { hasConfig: hasClaudeCodeConfig,               call: callClaudeCodeJson },
};

const DEFAULT_PROVIDER = "code";

// ── Diagnostic log buffer ───────────────────────────────────────────
const MAX_DIAG_LOGS = 500;
const _diagLogs = [];

export function pushDiagLog(level, category, message, meta) {
  const entry = {
    ts: new Date().toISOString(),
    level,     // "info" | "warn" | "error" | "debug"
    cat: category, // "provider" | "config" | "request" | "playtest" | "plugin"
    msg: message,
    ...(meta ? { meta } : {}),
  };
  _diagLogs.push(entry);
  if (_diagLogs.length > MAX_DIAG_LOGS) _diagLogs.splice(0, _diagLogs.length - MAX_DIAG_LOGS);
  // Also console.log for agent process logs
  const tag = `[uxRoai-${category}]`;
  if (level === "error") console.error(tag, message, meta ? JSON.stringify(meta) : "");
  else console.log(tag, message, meta ? JSON.stringify(meta) : "");
}

export function getDiagLogs(limit = 200, category) {
  let logs = _diagLogs;
  if (category) logs = logs.filter(l => l.cat === category);
  return logs.slice(-limit);
}

function normalizeProvider(value) {
  const text = String(value || "").trim().toLowerCase();
  return text in PROVIDER_REGISTRY ? text : DEFAULT_PROVIDER;
}

export function getProvider() {
  return normalizeProvider(process.env.CLAUDE_PROVIDER || DEFAULT_PROVIDER);
}

export function getClaudeProvider() {
  return getProvider();
}

export function hasClaudeConfig() {
  return PROVIDER_REGISTRY[getProvider()].hasConfig();
}

/** Returns the active model based on the current provider */
export function getActiveModel() {
  const provider = getProvider();
  if (provider === "gemini") return getGeminiModel();
  if (provider === "codex") return getCodexModel();
  return getModel();
}

/** Returns a snapshot of the current provider configuration for diagnostics */
export function getProviderDiagnostics() {
  const provider = getProvider();
  return {
    provider,
    configured: PROVIDER_REGISTRY[provider].hasConfig(),
    model: getActiveModel(),
    timeoutMs: provider === "code" ? getCodeTimeoutMs()
      : provider === "gemini" ? getGeminiTimeoutMs()
      : provider === "codex" ? getCodexTimeoutMs()
      : 900_000,
  };
}

export async function callClaudeJson({ systemPrompt, userPrompt, maxTokens = 2000, attachments, onToken, apiKeyOverride, conversationTurns, studioContext, signal }) {
  // Check abort before starting
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const provider = getProvider();
  const entry = PROVIDER_REGISTRY[provider];
  const diag = getProviderDiagnostics();
  const startTime = Date.now();

  pushDiagLog("info", "provider", `AI call started`, {
    provider, model: diag.model, maxTokens, timeoutMs: diag.timeoutMs,
    hasAttachments: Array.isArray(attachments) && attachments.length > 0,
    hasConversation: Array.isArray(conversationTurns) && conversationTurns.length > 0,
    hasStudioContext: Boolean(studioContext),
    promptPreview: String(userPrompt || "").slice(0, 120),
  });

  try {
    const result = await entry.call({ systemPrompt, userPrompt, maxTokens, attachments, onToken, apiKeyOverride, conversationTurns, studioContext, signal });
    const duration = Date.now() - startTime;
    pushDiagLog("info", "provider", `AI call completed in ${(duration / 1000).toFixed(1)}s`, {
      provider, duration, resultKeys: result ? Object.keys(result) : [],
    });
    return result;
  } catch (err) {
    const duration = Date.now() - startTime;
    pushDiagLog("error", "provider", `AI call FAILED after ${(duration / 1000).toFixed(1)}s: ${err.message}`, {
      provider, model: diag.model, timeoutMs: diag.timeoutMs, duration,
      error: err.message, stack: String(err.stack || "").split("\n").slice(0, 5).join(" | "),
    });
    // Enhance error message with diagnostics
    const enhanced = new Error(
      `[${provider}] ${err.message} (model=${diag.model}, timeout=${(diag.timeoutMs / 1000).toFixed(0)}s, took=${(duration / 1000).toFixed(1)}s)`
    );
    enhanced.statusCode = err.statusCode || 500;
    throw enhanced;
  }
}
