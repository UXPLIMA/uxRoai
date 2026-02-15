const MAX_BODY_BYTES = 12 * 1024 * 1024;

export async function readJsonBody(req) {
  const chunks = [];
  let bytes = 0;

  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) {
      const error = new Error("Request body too large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("Invalid JSON body");
    error.statusCode = 400;
    throw error;
  }
}

export function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.end(body);
}

export function parseError(error) {
  return {
    message: error?.message || "Unknown error",
    statusCode: Number.isInteger(error?.statusCode) ? error.statusCode : 500,
  };
}

export function extractFirstJson(text) {
  if (typeof text !== "string" || text.length === 0) {
    throw new Error("Model response is empty");
  }

  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;

  const firstBrace = candidate.indexOf("{");
  if (firstBrace === -1) {
    throw new Error("No JSON object found in model response");
  }

  // Use brace-counting to find the matching closing brace,
  // so extra text after the JSON object is ignored.
  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;

  for (let i = firstBrace; i < candidate.length; i++) {
    const ch = candidate[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { if (inString) escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { end = i; break; } }
  }

  if (end === -1) {
    throw new Error("No complete JSON object found in model response");
  }

  const jsonSlice = candidate.slice(firstBrace, end + 1);
  return JSON.parse(jsonSlice);
}

export function safeString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

export function createHttpError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}
