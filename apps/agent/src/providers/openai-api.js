import { extractFirstJson } from "../utils.js";
import { recordUsage } from "./usage.js";
import {
  OPENAI_API_URL,
  getOpenaiApiKey,
  getCodexModel,
  readImageAsBase64,
  getImageMediaType,
  getImageAttachments,
  consumeSSEStream,
} from "./base.js";

export async function callOpenaiApiJson({ systemPrompt, userPrompt, maxTokens = 2000, attachments, onToken, apiKeyOverride, conversationTurns }) {
  const apiKey = apiKeyOverride || getOpenaiApiKey();
  if (!apiKey) throw new Error("OPENAI_API_KEY is missing");

  const model = getCodexModel();

  const userContent = [];

  const images = getImageAttachments(attachments);
  for (const img of images) {
    const base64 = readImageAsBase64(img.path);
    if (base64) {
      const mediaType = getImageMediaType(img.ext);
      userContent.push({
        type: "image_url",
        image_url: {
          url: `data:${mediaType};base64,${base64}`,
        },
      });
    }
  }

  userContent.push({ type: "text", text: userPrompt });

  const messages = [{ role: "system", content: systemPrompt }];
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

  const payload = {
    model,
    max_completion_tokens: maxTokens,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages,
    ...(onToken ? { stream: true } : {}),
  };

  const controller = new AbortController();
  const fetchTimeout = setTimeout(() => controller.abort(), 900_000);

  let response;
  try {
    response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(fetchTimeout);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI API request failed (${response.status}): ${body}`);
  }

  if (onToken && response.body) {
    return consumeSSEStream(response.body, (event) => {
      return event.choices?.[0]?.delta?.content || null;
    }, onToken, (event) => {
      if (event.usage) {
        recordUsage(event.usage.prompt_tokens, event.usage.completion_tokens);
      }
    });
  }

  const data = await response.json();

  if (data?.usage) {
    recordUsage(data.usage.prompt_tokens, data.usage.completion_tokens);
  }

  const text = data?.choices?.[0]?.message?.content || "";

  if (!text) throw new Error("OpenAI API returned empty response");

  return extractFirstJson(text);
}
