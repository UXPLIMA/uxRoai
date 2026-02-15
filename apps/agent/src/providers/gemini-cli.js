import { existsSync } from "node:fs";
import {
  getGeminiCommand,
  getGeminiModel,
  getGeminiTimeoutMs,
  hasCommandInPath,
  runCodeCommand,
  parseCliJsonResponse,
} from "./base.js";

export function hasGeminiCliConfig() {
  const command = getGeminiCommand();
  if (!command) return false;
  if (command.includes("/") || command.includes("\\")) return existsSync(command);
  return hasCommandInPath(command);
}

export async function callGeminiCliJson({ systemPrompt, userPrompt, maxTokens = 2000, signal }) {
  const command = getGeminiCommand();
  if (!command) throw new Error("GEMINI_COMMAND is missing");

  const model = getGeminiModel();

  const jsonRule = `\n\nOutput strictly valid JSON only — no markdown fences, no explanations. Max ~${maxTokens} tokens.`;
  const combinedPrompt = systemPrompt + "\n\n---\n\n" + userPrompt + jsonRule;

  const args = ["-p", ".", "-o", "text", "-m", model, "--allowed-tools", "none"];

  try {
    const { stdout, stderr } = await runCodeCommand({
      command,
      args,
      timeoutMs: getGeminiTimeoutMs(),
      stdinData: combinedPrompt,
      signal,
    });

    const responseText = stdout.trim() || [stdout, stderr].filter(Boolean).join("\n").trim();
    if (!responseText) throw new Error("Gemini CLI returned empty output");

    return parseCliJsonResponse(responseText, "Gemini CLI");
  } catch (err) {
    if (!err.message.includes("Gemini")) {
      throw new Error(`Gemini CLI error: ${err.message}`);
    }
    throw err;
  }
}
