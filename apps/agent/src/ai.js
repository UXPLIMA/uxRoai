import { callClaudeJson, hasClaudeConfig } from "./providers/dispatcher.js";
import { getCustomInstructions } from "./providers/base.js";
import {
  buildPlanSystemPrompt,
  buildPlanUserPrompt,
} from "./prompts/plan-prompt.js";
import {
  PLAYTEST_SYSTEM_PROMPT,
  buildPlaytestUserPrompt,
} from "./prompts/playtest-prompt.js";
import {
  ASK_SYSTEM_PROMPT,
  buildAskUserPrompt,
} from "./prompts/ask-prompt.js";
import { PLAYTEST_ANALYZE_PROMPT } from "./prompts/analyze-prompt.js";

export { hasClaudeConfig };

function buildConversationTurns(history) {
  if (!Array.isArray(history) || history.length === 0) return null;
  const convEntries = history.filter(e => e.status !== "memory" && e.prompt && e.summary);
  if (convEntries.length === 0) return null;
  return convEntries.map(entry => ({
    userPrompt: entry.prompt,
    assistantResponse: entry.summary,
  }));
}

export async function generatePlanWithClaude(prompt, studioContext, history, attachments, onToken, overrides, signal) {
  const customInstructions = overrides?.customPrompt || getCustomInstructions();
  const conversationTurns = buildConversationTurns(history);
  return callClaudeJson({
    systemPrompt: buildPlanSystemPrompt(customInstructions),
    userPrompt: buildPlanUserPrompt(prompt, studioContext, history),
    maxTokens: 4000,
    attachments,
    onToken,
    apiKeyOverride: overrides?.apiKey || null,
    conversationTurns,
    studioContext,
    signal,
  });
}

export async function generateAskResponse(question, studioContext, attachments, history) {
  const systemPrompt = ASK_SYSTEM_PROMPT + '\n\nRespond with strictly valid JSON: {"answer": "your full text answer here"}';
  const conversationTurns = buildConversationTurns(history);
  return callClaudeJson({
    systemPrompt,
    userPrompt: buildAskUserPrompt(question, studioContext, history),
    maxTokens: 3000,
    attachments,
    conversationTurns,
  });
}

export async function generatePlaytestWithClaude(goal, studioContext, attachments) {
  return callClaudeJson({
    systemPrompt: PLAYTEST_SYSTEM_PROMPT,
    userPrompt: buildPlaytestUserPrompt(goal, studioContext),
    maxTokens: 3000,
    attachments,
  });
}

export async function analyzePlaytestResult(testOutput) {
  return callClaudeJson({
    systemPrompt: PLAYTEST_ANALYZE_PROMPT,
    userPrompt: JSON.stringify(testOutput, null, 2),
    maxTokens: 800,
  });
}
