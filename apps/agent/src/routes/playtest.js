import { readJsonBody, sendJson, createHttpError } from "../utils.js";
import { validatePlaytestRequest } from "../schemas/validators.js";
import { normalizePlaytest } from "../schemas/normalize-playtest.js";
import {
  generatePlaytestWithClaude,
  analyzePlaytestResult,
  hasClaudeConfig,
} from "../ai.js";
import { pushDiagLog } from "../providers/dispatcher.js";

async function resolvePlaytest(goal, studioContext, attachments) {
  if (!hasClaudeConfig()) {
    throw createHttpError("AI provider is not configured. Ensure 'claude', 'codex', or 'gemini' CLI is installed and in PATH.", 503);
  }

  const raw = await generatePlaytestWithClaude(goal, studioContext, attachments);
  return normalizePlaytest(raw);
}

export async function handle(req, res, pathname) {
  if (req.method === "POST" && pathname === "/v1/playtests") {
    const body = await readJsonBody(req);
    const { goal, studioContext } = validatePlaytestRequest(body);
    const attachments = Array.isArray(body?.attachments) ? body.attachments : [];
    const ptStart = Date.now();
    pushDiagLog("info", "playtest", `Playtest generation started: "${String(goal).slice(0, 80)}"`, { goalLen: goal?.length || 0 });
    const playtest = await resolvePlaytest(goal, studioContext, attachments);
    pushDiagLog("info", "playtest", `Playtest generated in ${((Date.now() - ptStart) / 1000).toFixed(1)}s`, { duration: Date.now() - ptStart });
    sendJson(res, 200, { ok: true, playtest });
    return true;
  }

  if (req.method === "POST" && pathname === "/v1/playtest-analyze") {
    const body = await readJsonBody(req);
    const testOutput = body?.testOutput || body;
    if (!testOutput || typeof testOutput !== "object") {
      sendJson(res, 400, { ok: false, error: "testOutput is required" });
      return true;
    }
    if (!hasClaudeConfig()) {
      const passed = testOutput.ok !== false;
      const failedAssertions = Array.isArray(testOutput.failedAssertions) ? testOutput.failedAssertions : [];
      sendJson(res, 200, {
        ok: true,
        analysis: {
          passed,
          summary: passed ? "All assertions passed." : `${failedAssertions.length} assertion(s) failed.`,
          failedAssertions,
          suggestions: [],
        },
      });
      return true;
    }
    const analyzeStart = Date.now();
    pushDiagLog("info", "playtest", "Playtest analysis started", { testOutputKeys: Object.keys(testOutput) });
    const analysis = await analyzePlaytestResult(testOutput);
    pushDiagLog("info", "playtest", `Playtest analysis completed in ${((Date.now() - analyzeStart) / 1000).toFixed(1)}s`, { duration: Date.now() - analyzeStart, passed: analysis?.passed });
    sendJson(res, 200, { ok: true, analysis });
    return true;
  }

  return false;
}
