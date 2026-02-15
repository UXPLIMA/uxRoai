import { sendJson } from "../utils.js";
import { getClaudeProvider, hasClaudeConfig, getProviderDiagnostics, getDiagLogs } from "../providers/dispatcher.js";

export async function handle(req, res, pathname) {
  if (req.method === "GET" && pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      service: "uxroai-agent",
      timestamp: new Date().toISOString(),
      claudeProvider: getClaudeProvider(),
      claudeConfigured: hasClaudeConfig(),
      diagnostics: getProviderDiagnostics(),
    });
    return true;
  }

  // Full diagnostic logs endpoint
  if (req.method === "GET" && pathname === "/v1/logs") {
    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    const category = url.searchParams.get("category") || undefined;
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 200));
    sendJson(res, 200, {
      ok: true,
      diagnostics: getProviderDiagnostics(),
      logs: getDiagLogs(limit, category),
      uptime: Math.floor(process.uptime()),
      memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    });
    return true;
  }

  return false;
}
