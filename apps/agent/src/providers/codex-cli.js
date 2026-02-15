import { existsSync } from "node:fs";
import {
  getCodexCommand,
  getCodexModel,
  getCodexTimeoutMs,
  hasCommandInPath,
  getImageAttachments,
  runCodeCommand,
  parseCliJsonResponse,
} from "./base.js";

export function hasCodexCliConfig() {
  const command = getCodexCommand();
  if (!command) return false;
  if (command.includes("/") || command.includes("\\")) return existsSync(command);
  return hasCommandInPath(command);
}

export async function callCodexCliJson({ systemPrompt, userPrompt, maxTokens = 2000, attachments }) {
  const command = getCodexCommand();
  if (!command) throw new Error("CODEX_COMMAND is missing");

  const model = getCodexModel();

  const jsonRule = `\n\nOutput strictly valid JSON only — no markdown fences, no explanations. Max ~${maxTokens} tokens.`;
  const stdinPrompt = userPrompt + jsonRule;
  const combinedPrompt = `${systemPrompt}\n\n---\n\n${stdinPrompt}`;

  const args = ["exec", "--model", model, "--full-auto"];

  const images = getImageAttachments(attachments);
  for (const img of images) {
    if (existsSync(img.path)) {
      args.push("--image", img.path);
    }
  }

  const { stdout, stderr } = await runCodeCommand({
    command,
    args,
    timeoutMs: getCodexTimeoutMs(),
    stdinData: combinedPrompt,
  });

  const combined = [stdout, stderr].filter(Boolean).join("\n").trim();
  if (!combined) throw new Error("Codex CLI returned empty output");

  return parseCliJsonResponse(combined, "Codex CLI");
}
