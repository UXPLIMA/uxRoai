import { extractFirstJson } from "../utils.js";
import { recordUsage } from "./usage.js";
import {
  GEMINI_API_URL,
  getGeminiApiKey,
  getGeminiModel,
  getGeminiTimeoutMs,
  readImageAsBase64,
  getImageMediaType,
  getImageAttachments,
  consumeSSEStream,
} from "./base.js";

export async function callGeminiApiJson({ systemPrompt, userPrompt, maxTokens = 2000, attachments, onToken, signal }) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) throw new Error("GEMINI_API_KEY is missing");

  const model = getGeminiModel();

  const userParts = [];

  const images = getImageAttachments(attachments);
  for (const img of images) {
    const base64 = readImageAsBase64(img.path);
    if (base64) {
      userParts.push({
        inlineData: {
          mimeType: getImageMediaType(img.ext),
          data: base64,
        },
      });
    }
  }

  userParts.push({ text: userPrompt });

  const payload = {
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    contents: [
      {
        role: "user",
        parts: userParts,
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: maxTokens,
      responseMimeType: "application/json",
    },
  };

  const endpoint = onToken ? "streamGenerateContent" : "generateContent";
  const altParam = onToken ? "&alt=sse" : "";
  const url = `${GEMINI_API_URL}/models/${encodeURIComponent(model)}:${endpoint}?key=${encodeURIComponent(apiKey)}${altParam}`;

  const controller = new AbortController();
  const fetchTimeout = setTimeout(() => controller.abort(), getGeminiTimeoutMs());
  if (signal) {
    if (signal.aborted) { clearTimeout(fetchTimeout); controller.abort(); }
    else signal.addEventListener("abort", () => { clearTimeout(fetchTimeout); controller.abort(); }, { once: true });
  }

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(fetchTimeout);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini API request failed (${response.status}): ${body}`);
  }

  if (onToken && response.body) {
    return consumeSSEStream(response.body, (event) => {
      const parts = event?.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) {
        return parts.filter((p) => p?.text).map((p) => p.text).join("") || null;
      }
      return null;
    }, onToken, (event) => {
      if (event.usageMetadata) {
        recordUsage(event.usageMetadata.promptTokenCount, event.usageMetadata.candidatesTokenCount);
      }
    });
  }

  const data = await response.json();

  if (data?.usageMetadata) {
    recordUsage(data.usageMetadata.promptTokenCount, data.usageMetadata.candidatesTokenCount);
  }

  const text = (data?.candidates?.[0]?.content?.parts || [])
    .filter((part) => part?.text)
    .map((part) => part.text)
    .join("\n");

  if (!text) throw new Error("Gemini API returned empty response");

  return extractFirstJson(text);
}
