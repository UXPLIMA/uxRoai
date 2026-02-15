const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { app } = require("electron");
const {
  readConfig,
  normalizeAgentUrl,
  normalizeClaudeProvider,
  normalizeClaudeCodeCommand,
  normalizeClaudeCodeArgs,
  normalizeClaudeModel,
  normalizeCodexCommand,
  normalizeCodexModel,
  normalizeGeminiCommand,
  normalizeGeminiModel,
} = require("./config.js");
const { DEFAULT_AGENT_URL, DEFAULT_CLAUDE_PROVIDER, DEFAULT_CLAUDE_CODE_COMMAND, DEFAULT_CLAUDE_CODE_ARGS, DEFAULT_CLAUDE_MODEL, DEFAULT_CODEX_COMMAND, DEFAULT_CODEX_MODEL, DEFAULT_GEMINI_COMMAND, DEFAULT_GEMINI_MODEL } = require("./constants.js");

// ── Paths ─────────────────────────────────────────────────────

const AGENT_DIR = app.isPackaged
  ? path.join(process.resourcesPath, "agent")
  : path.resolve(__dirname, "..", "..", "agent");
const AGENT_ENTRY = path.join(AGENT_DIR, "src", "server.js");

// ── Agent State ───────────────────────────────────────────────

const managedAgent = {
  process: null,
  logs: [],
  lastError: "",
  lastExitCode: null,
  startedAt: null,
  stopRequested: false,
  startInFlight: null,
};

// ── Helpers ───────────────────────────────────────────────────

function pushAgentLog(kind, message) {
  const line = `[${new Date().toISOString()}] [${kind}] ${String(message || "")}`;
  managedAgent.logs.push(line);
  if (managedAgent.logs.length > 400) {
    managedAgent.logs = managedAgent.logs.slice(-400);
  }
}

function getPortFromAgentUrl(agentUrl) {
  try {
    const parsed = new URL(normalizeAgentUrl(agentUrl));
    if (!parsed.port) {
      return parsed.protocol === "https:" ? "443" : "80";
    }
    return parsed.port;
  } catch {
    return "41117";
  }
}

function getManagedAgentStatus() {
  const proc = managedAgent.process;
  return {
    running: Boolean(proc),
    pid: proc ? proc.pid : null,
    startedAt: managedAgent.startedAt,
    lastError: managedAgent.lastError,
    lastExitCode: managedAgent.lastExitCode,
    logs: managedAgent.logs.slice(-120),
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForProcessExit(child, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.removeListener("exit", onExit);
        resolve(false);
      }
    }, timeoutMs);

    const onExit = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(true);
      }
    };

    child.once("exit", onExit);
  });
}

// ── Agent HTTP Requests ───────────────────────────────────────

async function requestAgent(config, route, method = "GET", payload = null, timeoutMs = 12_000) {
  const url = `${normalizeAgentUrl(config.agentUrl)}${route}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const options = {
      method,
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
    };
    if (payload) {
      options.body = JSON.stringify(payload);
    }

    const response = await fetch(url, options);
    const text = await response.text();
    let body = {};
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text };
      }
    }

    if (!response.ok) {
      const message = body?.error || `HTTP ${response.status}`;
      throw new Error(message);
    }

    return body;
  } finally {
    clearTimeout(timeout);
  }
}

function getErrorCode(error) {
  return error?.cause?.code || error?.code || "";
}

function buildAgentOfflineMessage(config, error) {
  const url = normalizeAgentUrl(config?.agentUrl || DEFAULT_AGENT_URL);
  const code = getErrorCode(error);
  if (code === "ECONNREFUSED") {
    return `Agent is offline or unreachable: ${url}`;
  }
  if (code === "ENOTFOUND") {
    return `Agent host not found: ${url}`;
  }
  if (code === "ETIMEDOUT" || error?.name === "AbortError") {
    return `Agent timeout: ${url}`;
  }
  return String(error?.message || "Agent request failed");
}

function isTransientAgentError(error) {
  if (!error) return false;
  const code = getErrorCode(error);
  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ETIMEDOUT") {
    return true;
  }
  return error?.name === "AbortError";
}

// ── Health Checks ─────────────────────────────────────────────

async function isAgentReachable(config) {
  try {
    await requestAgent(config, "/health", "GET");
    return true;
  } catch {
    return false;
  }
}

async function waitForAgentHealth(config, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    const alive = await isAgentReachable(config);
    if (alive) return true;
    await delay(250);
  }
  return false;
}

// ── Start / Stop ──────────────────────────────────────────────

async function startManagedAgent() {
  if (managedAgent.process) {
    return getManagedAgentStatus();
  }

  if (managedAgent.startInFlight) {
    return managedAgent.startInFlight;
  }

  managedAgent.startInFlight = (async () => {
    const config = readConfig();
    const reachable = await isAgentReachable(config);
    if (reachable) {
      pushAgentLog("info", "Agent already reachable. Skipping managed start.");
      return getManagedAgentStatus();
    }

    if (!fs.existsSync(AGENT_ENTRY)) {
      const message = `Agent entry not found: ${AGENT_ENTRY}`;
      managedAgent.lastError = message;
      pushAgentLog("error", message);
      throw new Error(message);
    }

    const portFromUrl = getPortFromAgentUrl(config.agentUrl || DEFAULT_AGENT_URL);
    const ENV_FIELD_MAP = [
      ["CLAUDE_PROVIDER", normalizeClaudeProvider, config.claudeProvider || DEFAULT_CLAUDE_PROVIDER],
      ["CLAUDE_CODE_COMMAND", normalizeClaudeCodeCommand, config.claudeCodeCommand || DEFAULT_CLAUDE_CODE_COMMAND],
      ["CLAUDE_CODE_ARGS", normalizeClaudeCodeArgs, config.claudeCodeArgs || DEFAULT_CLAUDE_CODE_ARGS],
      ["CLAUDE_MODEL", normalizeClaudeModel, config.claudeModel || DEFAULT_CLAUDE_MODEL],
      ["CODEX_COMMAND", normalizeCodexCommand, config.codexCommand || DEFAULT_CODEX_COMMAND],
      ["CODEX_MODEL", normalizeCodexModel, config.codexModel || DEFAULT_CODEX_MODEL],
      ["GEMINI_COMMAND", normalizeGeminiCommand, config.geminiCommand || DEFAULT_GEMINI_COMMAND],
      ["GEMINI_MODEL", normalizeGeminiModel, config.geminiModel || DEFAULT_GEMINI_MODEL],
    ];
    const mergedEnv = { ...process.env };
    mergedEnv.PORT = portFromUrl || "41117";
    for (const [envKey, normalizer, value] of ENV_FIELD_MAP) {
      mergedEnv[envKey] = normalizer(value);
    }
    mergedEnv.CUSTOM_INSTRUCTIONS = config.customInstructions || "";
    mergedEnv.CLAUDE_CODE_TIMEOUT_MS = String((config.claudeCodeTimeoutSec || 90) * 1000);
    mergedEnv.CODEX_TIMEOUT_MS = String((config.codexTimeoutSec || 180) * 1000);
    mergedEnv.GEMINI_TIMEOUT_MS = String((config.geminiTimeoutSec || 300) * 1000);
    const child = spawn(process.execPath, [AGENT_ENTRY], {
      cwd: AGENT_DIR,
      env: { ...mergedEnv, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    managedAgent.process = child;
    managedAgent.stopRequested = false;
    managedAgent.lastError = "";
    managedAgent.lastExitCode = null;
    managedAgent.startedAt = new Date().toISOString();
    pushAgentLog("info", `Managed agent starting (pid=${child.pid})`);

    child.stdout.on("data", (chunk) => {
      const lines = String(chunk || "").split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        pushAgentLog("stdout", line);
      }
    });

    child.stderr.on("data", (chunk) => {
      const lines = String(chunk || "").split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        pushAgentLog("stderr", line);
      }
    });

    child.on("error", (error) => {
      managedAgent.lastError = error.message || String(error);
      pushAgentLog("error", `Spawn error: ${managedAgent.lastError}`);
    });

    child.on("exit", (code, signal) => {
      managedAgent.lastExitCode = Number.isInteger(code) ? code : null;
      managedAgent.process = null;
      pushAgentLog("info", `Managed agent exited (code=${String(code)}, signal=${String(signal)})`);
      if (!managedAgent.stopRequested && code !== 0) {
        managedAgent.lastError = `Agent exited unexpectedly with code ${String(code)}`;
      }
    });

    const ok = await waitForAgentHealth(config, 10000);
    if (!ok) {
      managedAgent.lastError = "Agent process started but /health did not respond in time";
      pushAgentLog("error", managedAgent.lastError);
    } else {
      pushAgentLog("info", "Managed agent is healthy.");
    }

    return getManagedAgentStatus();
  })();

  try {
    return await managedAgent.startInFlight;
  } finally {
    managedAgent.startInFlight = null;
  }
}

async function stopManagedAgent() {
  const child = managedAgent.process;
  if (!child) {
    return getManagedAgentStatus();
  }

  managedAgent.stopRequested = true;
  pushAgentLog("info", `Stopping managed agent (pid=${child.pid})`);

  let exited = false;
  try {
    child.kill("SIGTERM");
    exited = await waitForProcessExit(child, 4500);
  } catch {
    exited = false;
  }

  if (!exited) {
    try {
      child.kill("SIGKILL");
      await waitForProcessExit(child, 1500);
    } catch {
      // ignore
    }
  }

  return getManagedAgentStatus();
}

function killAgentSync() {
  if (managedAgent.process) {
    managedAgent.stopRequested = true;
    try {
      managedAgent.process.kill("SIGTERM");
    } catch {
      // ignore
    }
  }
}

module.exports = {
  getManagedAgentStatus,
  startManagedAgent,
  stopManagedAgent,
  killAgentSync,
  requestAgent,
  buildAgentOfflineMessage,
  isTransientAgentError,
};
