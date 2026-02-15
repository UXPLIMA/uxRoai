import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { extractFirstJson } from "../utils.js";

// ── Constants ──────────────────────────────────────────────────────

export const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
export const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
export const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta";

const DEFAULT_CODE_COMMAND = "claude";
const DEFAULT_CODE_ARGS = "-p";
const DEFAULT_CODE_TIMEOUT_MS = 900_000;
const DEFAULT_GEMINI_TIMEOUT_MS = 900_000;
const DEFAULT_CODEX_TIMEOUT_MS = 900_000;
const DEFAULT_CODEX_COMMAND = "codex";
const DEFAULT_CODEX_MODEL = "gpt-5.3-codex";
const DEFAULT_GEMINI_COMMAND = "gemini";
const DEFAULT_GEMINI_MODEL = "gemini-3-pro-preview";

// ── Environment helpers ────────────────────────────────────────────

export function getApiKey() {
  return process.env.CLAUDE_API_KEY || "";
}

export function getOpenaiApiKey() {
  return process.env.OPENAI_API_KEY || "";
}

export function getModel() {
  return process.env.CLAUDE_MODEL || "claude-sonnet-4-5";
}

export function getCodexModel() {
  return process.env.CODEX_MODEL || DEFAULT_CODEX_MODEL;
}

export function getCodeCommand() {
  return String(process.env.CLAUDE_CODE_COMMAND || "").trim() || DEFAULT_CODE_COMMAND;
}

export function getGeminiApiKey() {
  return process.env.GEMINI_API_KEY || "";
}

export function getGeminiModel() {
  return process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
}

export function getCustomInstructions() {
  return process.env.CUSTOM_INSTRUCTIONS || "";
}

export function getGeminiCommand() {
  return String(process.env.GEMINI_COMMAND || "").trim() || DEFAULT_GEMINI_COMMAND;
}

export function getCodexCommand() {
  return String(process.env.CODEX_COMMAND || "").trim() || DEFAULT_CODEX_COMMAND;
}

// ── CLI argument parsing ───────────────────────────────────────────

export function splitCliArgs(text) {
  const source = String(text || "").trim();
  if (!source) return [];

  const args = [];
  let current = "";
  let quote = null;
  let escaping = false;

  for (const char of source) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current !== "") {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (escaping) current += "\\";
  if (current !== "") args.push(current);
  return args;
}

export function getCodeArgs() {
  return splitCliArgs(process.env.CLAUDE_CODE_ARGS || DEFAULT_CODE_ARGS);
}

function clampTimeoutMs(envVar, defaultMs) {
  const value = Number(process.env[envVar] || defaultMs);
  if (!Number.isFinite(value)) return defaultMs;
  return Math.max(5_000, Math.min(1_200_000, Math.floor(value)));
}

export function getCodeTimeoutMs() {
  return clampTimeoutMs("CLAUDE_CODE_TIMEOUT_MS", DEFAULT_CODE_TIMEOUT_MS);
}

export function getGeminiTimeoutMs() {
  return clampTimeoutMs("GEMINI_TIMEOUT_MS", DEFAULT_GEMINI_TIMEOUT_MS);
}

export function getCodexTimeoutMs() {
  return clampTimeoutMs("CODEX_TIMEOUT_MS", DEFAULT_CODEX_TIMEOUT_MS);
}

// ── CLI response parsing ────────────────────────────────────────────

export function parseCliJsonResponse(text, label) {
  try {
    return extractFirstJson(text);
  } catch (err) {
    throw new Error(
      `${label} JSON parse failed: ${err.message}. Output preview: ${text.slice(0, 600)}`
    );
  }
}

// ── Command detection ──────────────────────────────────────────────

export function hasCommandInPath(command) {
  const check = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(check, [command], {
    stdio: "ignore",
    env: process.env,
  });
  return result.status === 0;
}

// ── Temp file helpers ──────────────────────────────────────────────

export function writeSystemPromptTempFile(content) {
  const name = `uxroai-prompt-${Date.now()}-${randomBytes(4).toString("hex")}.txt`;
  const filePath = join(tmpdir(), name);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

export function cleanupTempFile(filePath) {
  if (!filePath) return;
  try { unlinkSync(filePath); } catch { /* ignore */ }
}

// ── Image helpers ──────────────────────────────────────────────────

const ALLOWED_IMAGE_DIRS = new Set([tmpdir()]);

export function readImageAsBase64(filePath) {
  try {
    // Validate file path to prevent arbitrary file reads
    const resolved = join(filePath);
    const ext = resolved.slice(resolved.lastIndexOf(".")).toLowerCase();
    const allowedExts = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);
    if (!allowedExts.has(ext)) return null;

    const buffer = readFileSync(resolved);
    return buffer.toString("base64");
  } catch {
    return null;
  }
}

export function getImageMediaType(ext) {
  const map = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
  };
  return map[String(ext || "").toLowerCase()] || "image/png";
}

export function getImageAttachments(attachments) {
  if (!Array.isArray(attachments)) return [];
  return attachments.filter((a) => a && a.type === "image" && a.path);
}

// ── Prompt building ────────────────────────────────────────────────

export function buildTemplatePrompt({ systemPrompt, userPrompt, maxTokens }) {
  return [
    "System instructions:",
    systemPrompt,
    "",
    "User request and studio context:",
    userPrompt,
    "",
    "Rules:",
    "- Output strictly valid JSON only.",
    "- Do not wrap output in markdown.",
    `- Keep the response concise and under approximately ${maxTokens} tokens.`,
  ].join("\n");
}

// ── Process spawning ───────────────────────────────────────────────

export async function runCodeCommand({ command, args, timeoutMs, stdinData, env, shell, signal }) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let killTimer = null;

    const useShell = shell !== undefined ? shell : process.platform === "win32";

    const child = spawn(command, args, {
      stdio: [stdinData ? "pipe" : "ignore", "pipe", "pipe"],
      env: env || process.env,
      shell: useShell,
    });

    if (stdinData) {
      child.stdin.on("error", () => {});
      child.stdin.write(stdinData);
      child.stdin.end();
    }

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      error ? reject(error) : resolve(value);
    };

    const timeout = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
      killTimer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* ignore */ }
      }, 1200);
      finish(new Error(`CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    // External abort signal (from task stop) → kill child process
    if (signal) {
      if (signal.aborted) {
        try { child.kill("SIGTERM"); } catch { /* ignore */ }
        finish(new DOMException("Aborted", "AbortError"));
      } else {
        signal.addEventListener("abort", () => {
          try { child.kill("SIGTERM"); } catch { /* ignore */ }
          killTimer = setTimeout(() => {
            try { child.kill("SIGKILL"); } catch { /* ignore */ }
          }, 1200);
          finish(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      }
    }

    child.on("error", (err) => {
      finish(
        new Error(`Failed to start '${command}': ${err.message || String(err)}`)
      );
    });

    const MAX_BUFFER = 10 * 1024 * 1024; // 10MB
    child.stdout.on("data", (chunk) => {
      if (stdout.length < MAX_BUFFER) stdout += String(chunk || "");
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < MAX_BUFFER) stderr += String(chunk || "");
    });

    child.on("close", (code, sig) => {
      if (code !== 0 && !stdout.trim()) {
        finish(
          new Error(
            `'${command}' exited with code ${code} signal=${sig}. ${stderr.trim() || "No stderr output."}`
          )
        );
        return;
      }
      finish(null, { code, signal: sig, stdout, stderr });
    });
  });
}

// ── SSE Stream Consumer ────────────────────────────────────────────

export async function consumeSSEStream(body, extractDelta, onToken, extractUsage) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6).trim();
      if (jsonStr === "[DONE]") continue;
      try {
        const event = JSON.parse(jsonStr);
        const delta = extractDelta(event);
        if (delta) {
          accumulated += delta;
          onToken(accumulated);
        }
        if (extractUsage) extractUsage(event);
      } catch {
        // skip malformed SSE lines
      }
    }
  }

  if (!accumulated) throw new Error("Streaming response returned no text");
  return extractFirstJson(accumulated);
}
