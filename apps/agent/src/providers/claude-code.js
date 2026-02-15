import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  getCodeCommand,
  getCodeArgs,
  getCodeTimeoutMs,
  getModel,
  hasCommandInPath,
  writeSystemPromptTempFile,
  cleanupTempFile,
  buildTemplatePrompt,
  runCodeCommand,
  parseCliJsonResponse,
} from "./base.js";

// Cached resolved command so we only probe once
let _resolvedCodeCommand = undefined;

export function resolveCodeCommand() {
  if (_resolvedCodeCommand !== undefined) return _resolvedCodeCommand;

  const command = getCodeCommand();
  if (!command) {
    _resolvedCodeCommand = null;
    return null;
  }

  // Explicit absolute path provided
  if (command.includes("/") || command.includes("\\")) {
    if (existsSync(command)) {
      _resolvedCodeCommand = command;
      return command;
    }
    console.info(`[uxRoai-agent] Claude Code CLI not found at configured path: ${command}`);
    _resolvedCodeCommand = null;
    return null;
  }

  // Found in PATH
  if (hasCommandInPath(command)) {
    _resolvedCodeCommand = command;
    return command;
  }

  // Fallback: check common install locations (~/.local/bin on all platforms)
  const fallbackPaths = [
    join(homedir(), ".local", "bin", process.platform === "win32" ? `${command}.exe` : command),
  ];

  for (const fallback of fallbackPaths) {
    if (existsSync(fallback)) {
      console.info(`[uxRoai-agent] Claude Code CLI not in PATH, using fallback: ${fallback}`);
      _resolvedCodeCommand = fallback;
      return fallback;
    }
  }

  console.info(
    `[uxRoai-agent] Claude Code CLI "${command}" not found in PATH or ~/.local/bin. ` +
    `Set CLAUDE_CODE_COMMAND to the full path, or add its directory to PATH.`
  );
  _resolvedCodeCommand = null;
  return null;
}

export function hasClaudeCodeConfig() {
  return resolveCodeCommand() !== null;
}

export async function callClaudeCodeJson({ systemPrompt, userPrompt, maxTokens = 2000, signal }) {
  const command = resolveCodeCommand();
  if (!command) throw new Error("Claude Code CLI not found. Set CLAUDE_CODE_COMMAND or add 'claude' to PATH.");

  const rawArgs = getCodeArgs();
  const hasPlaceholder = rawArgs.some((a) => a.includes("{prompt}"));

  let args;
  let stdinData = null;
  let tempFile = null;

  const jsonRule = `\n\nOutput strictly valid JSON only — no markdown fences, no explanations. Max ~${maxTokens} tokens.`;

  if (hasPlaceholder) {
    const prompt = buildTemplatePrompt({ systemPrompt, userPrompt, maxTokens });
    args = rawArgs.map((a) =>
      a
        .replaceAll("{prompt}", prompt)
        .replaceAll("{max_tokens}", String(maxTokens))
        .replaceAll("{model}", getModel())
    );
  } else if (process.platform === "win32") {
    tempFile = writeSystemPromptTempFile(systemPrompt);
    stdinData = userPrompt + jsonRule;
    args = ["--system-prompt-file", tempFile, ...rawArgs];
  } else {
    stdinData = userPrompt + jsonRule;
    args = ["--system-prompt", systemPrompt, ...rawArgs];
  }

  try {
    const { stdout, stderr } = await runCodeCommand({
      command,
      args,
      timeoutMs: getCodeTimeoutMs(),
      stdinData,
      signal,
    });

    const combined = [stdout, stderr].filter(Boolean).join("\n").trim();
    if (!combined) throw new Error("Claude Code returned empty output");

    return parseCliJsonResponse(combined, "Claude Code");
  } finally {
    cleanupTempFile(tempFile);
  }
}
