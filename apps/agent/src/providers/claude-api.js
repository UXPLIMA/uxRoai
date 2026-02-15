import { extractFirstJson } from "../utils.js";
import { recordUsage } from "./usage.js";
import {
  CLAUDE_API_URL,
  getApiKey,
  getModel,
  readImageAsBase64,
  getImageMediaType,
  getImageAttachments,
  consumeSSEStream,
} from "./base.js";
import { EXPLORATION_TOOL_DEFINITIONS, executeExplorationTool } from "./exploration-tools.js";

const MAX_TOOL_ROUNDS = 5;

function buildMultiTurnMessages(conversationTurns, userContent) {
  const messages = [];
  if (Array.isArray(conversationTurns) && conversationTurns.length > 0) {
    for (const turn of conversationTurns) {
      if (!turn.userPrompt) continue;
      messages.push({ role: "user", content: turn.userPrompt });
      if (turn.assistantResponse) {
        messages.push({ role: "assistant", content: turn.assistantResponse });
      }
    }
  }
  messages.push({ role: "user", content: userContent });
  return messages;
}

async function callClaudeApiRaw(apiKey, payload, externalSignal, timeoutMs) {
  const controller = new AbortController();
  const fetchTimeout = setTimeout(() => controller.abort(), timeoutMs || 900_000);
  // Wire external abort signal (from task stop) to this controller
  if (externalSignal) {
    if (externalSignal.aborted) { clearTimeout(fetchTimeout); controller.abort(); }
    else externalSignal.addEventListener("abort", () => { clearTimeout(fetchTimeout); controller.abort(); }, { once: true });
  }
  let response;
  try {
    response = await fetch(CLAUDE_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(fetchTimeout);
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Claude API request failed (${response.status}): ${body}`);
  }
  return response;
}

export async function callClaudeApiJson({ systemPrompt, userPrompt, maxTokens = 2000, attachments, onToken, apiKeyOverride, conversationTurns, studioContext, signal }) {
  const apiKey = apiKeyOverride || getApiKey();
  if (!apiKey) throw new Error("CLAUDE_API_KEY is missing");

  const userContent = [];
  const images = getImageAttachments(attachments);
  for (const img of images) {
    const base64 = readImageAsBase64(img.path);
    if (base64) {
      userContent.push({
        type: "image",
        source: { type: "base64", media_type: getImageMediaType(img.ext), data: base64 },
      });
    }
  }
  userContent.push({ type: "text", text: userPrompt });

  const messages = buildMultiTurnMessages(conversationTurns, userContent);
  const hasContext = studioContext && typeof studioContext === "object";
  const tools = hasContext ? EXPLORATION_TOOL_DEFINITIONS : undefined;

  // Streaming path (no tool use loop, falls back to original behavior)
  if (onToken && !hasContext) {
    const payload = {
      model: getModel(),
      max_tokens: maxTokens,
      temperature: 0.2,
      system: systemPrompt,
      messages,
      stream: true,
    };
    const response = await callClaudeApiRaw(apiKey, payload, signal);
    let streamInputTokens = 0;
    let streamOutputTokens = 0;
    return consumeSSEStream(response.body, (event) => {
      if (event.type === "content_block_delta" && event.delta?.text) {
        return event.delta.text;
      }
      return null;
    }, onToken, (event) => {
      if (event.type === "message_start" && event.message?.usage) {
        streamInputTokens = event.message.usage.input_tokens || 0;
      }
      if (event.type === "message_delta" && event.usage) {
        streamOutputTokens = event.usage.output_tokens || 0;
        recordUsage(streamInputTokens, streamOutputTokens);
      }
    });
  }

  // Non-streaming path with optional tool use loop
  let totalInput = 0;
  let totalOutput = 0;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const payload = {
      model: getModel(),
      max_tokens: maxTokens,
      temperature: 0.2,
      system: systemPrompt,
      messages,
      ...(tools ? { tools } : {}),
      ...(onToken ? { stream: true } : {}),
    };

    if (onToken) {
      // Streaming with tool use - process stream and check for tool calls
      const response = await callClaudeApiRaw(apiKey, payload, signal);
      let streamInputTokens = 0;
      let streamOutputTokens = 0;
      let accumulatedText = "";
      let toolUseBlocks = [];
      let stopReason = "end_turn";

      // For streaming with tools, we need to collect the full response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentToolUse = null;
      let currentToolInput = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") continue;
          let event;
          try { event = JSON.parse(raw); } catch { continue; }

          if (event.type === "message_start" && event.message?.usage) {
            streamInputTokens = event.message.usage.input_tokens || 0;
          }
          if (event.type === "message_delta") {
            if (event.usage) streamOutputTokens = event.usage.output_tokens || 0;
            if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
          }
          if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
            currentToolUse = { id: event.content_block.id, name: event.content_block.name };
            currentToolInput = "";
          }
          if (event.type === "content_block_delta") {
            if (event.delta?.text) {
              accumulatedText += event.delta.text;
              if (onToken) onToken(accumulatedText);
            }
            if (event.delta?.partial_json) {
              currentToolInput += event.delta.partial_json;
            }
          }
          if (event.type === "content_block_stop" && currentToolUse) {
            let parsed = {};
            try { parsed = JSON.parse(currentToolInput); } catch { /* empty */ }
            toolUseBlocks.push({ ...currentToolUse, input: parsed });
            currentToolUse = null;
            currentToolInput = "";
          }
        }
      }

      totalInput += streamInputTokens;
      totalOutput += streamOutputTokens;

      if (stopReason !== "tool_use" || toolUseBlocks.length === 0) {
        recordUsage(totalInput, totalOutput);
        return extractFirstJson(accumulatedText);
      }

      // Process tool calls
      const assistantContent = [];
      if (accumulatedText) assistantContent.push({ type: "text", text: accumulatedText });
      for (const tb of toolUseBlocks) {
        assistantContent.push({ type: "tool_use", id: tb.id, name: tb.name, input: tb.input });
      }
      messages.push({ role: "assistant", content: assistantContent });

      const toolResults = [];
      for (const tb of toolUseBlocks) {
        const result = executeExplorationTool(tb.name, tb.input, studioContext);
        toolResults.push({ type: "tool_result", tool_use_id: tb.id, content: result });
      }
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    // Non-streaming path
    const response = await callClaudeApiRaw(apiKey, payload, signal);
    const data = await response.json();

    if (data?.usage) {
      totalInput += data.usage.input_tokens || 0;
      totalOutput += data.usage.output_tokens || 0;
    }

    const contentBlocks = data?.content || [];
    const textBlocks = contentBlocks.filter(b => b?.type === "text");
    const toolUseBlocks = contentBlocks.filter(b => b?.type === "tool_use");

    if (data?.stop_reason !== "tool_use" || toolUseBlocks.length === 0) {
      recordUsage(totalInput, totalOutput);
      const text = textBlocks.map(b => b.text).join("\n");
      return extractFirstJson(text);
    }

    // Add assistant response with tool calls to messages
    messages.push({ role: "assistant", content: contentBlocks });

    // Execute tools and add results
    const toolResults = [];
    for (const toolBlock of toolUseBlocks) {
      const result = executeExplorationTool(toolBlock.name, toolBlock.input, studioContext);
      toolResults.push({ type: "tool_result", tool_use_id: toolBlock.id, content: result });
    }
    messages.push({ role: "user", content: toolResults });
  }

  throw new Error("Exceeded maximum tool use rounds");
}
