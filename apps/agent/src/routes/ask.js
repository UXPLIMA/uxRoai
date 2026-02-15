import { readJsonBody, sendJson } from "../utils.js";
import { generateAskResponse, hasClaudeConfig } from "../ai.js";
import { pushDiagLog } from "../providers/dispatcher.js";

export async function handle(req, res, pathname) {
  if (req.method === "POST" && pathname === "/v1/ask") {
    const body = await readJsonBody(req);
    const question = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    if (!question) {
      sendJson(res, 400, { ok: false, error: "prompt is required" });
      return true;
    }
    if (!hasClaudeConfig()) {
      sendJson(res, 500, { ok: false, error: "AI provider not configured" });
      return true;
    }
    const askStart = Date.now();
    pushDiagLog("info", "request", `Ask started: "${question.slice(0, 80)}"`, { questionLen: question.length });
    const studioContext = body?.studioContext || null;
    const attachments = Array.isArray(body?.attachments) ? body.attachments : [];
    const history = Array.isArray(body?.history) ? body.history : [];
    const raw = await generateAskResponse(question, studioContext, attachments, history);
    const answer = typeof raw?.answer === "string" ? raw.answer : (typeof raw === "string" ? raw : JSON.stringify(raw));
    const duration = Date.now() - askStart;
    pushDiagLog("info", "request", `Ask completed in ${(duration / 1000).toFixed(1)}s`, { duration });
    sendJson(res, 200, { ok: true, answer });
    return true;
  }
  return false;
}
