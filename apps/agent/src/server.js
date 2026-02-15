import { createServer } from "node:http";
import { sendJson, parseError } from "./utils.js";
import { getClaudeProvider, hasClaudeConfig, pushDiagLog, getProviderDiagnostics } from "./providers/dispatcher.js";
import { handle as handleHealth } from "./routes/health.js";
import { handle as handlePlan } from "./routes/plan.js";
import { handle as handleAsk } from "./routes/ask.js";
import { handle as handlePlaytest } from "./routes/playtest.js";
import { handle as handleTasks } from "./routes/tasks.js";
import { handle as handleApproval } from "./routes/approval.js";
import { handle as handleEvents } from "./routes/events.js";

const PORT = Number(process.env.PORT || 41117);
const IGNORABLE_SOCKET_CODES = new Set(["EOF", "EPIPE", "ECONNRESET", "ERR_STREAM_WRITE_AFTER_END", "ECONNABORTED"]);

const handlers = [
  handleHealth,
  handlePlan,
  handleAsk,
  handlePlaytest,
  handleTasks,
  handleApproval,
  handleEvents,
];

const server = createServer(async (req, res) => {
  res.on("error", (err) => {
    if (IGNORABLE_SOCKET_CODES.has(err.code)) return;
    console.error(`[uxRoai-agent] Response error: ${err.code || err.message}`);
  });

  if (!req.url || !req.method) {
    return sendJson(res, 400, { ok: false, error: "Invalid request" });
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  const pathname = requestUrl.pathname;

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    for (const handler of handlers) {
      const handled = await handler(req, res, pathname, requestUrl);
      if (handled) return;
    }
    return sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    const { message, statusCode } = parseError(error);
    if (statusCode >= 500) {
      console.error(`[uxRoai-agent] ${req.method} ${pathname} → ${statusCode}: ${message}`);
    }
    return sendJson(res, statusCode, { ok: false, error: message });
  }
});

server.on("clientError", (err, socket) => {
  if (socket.writable) {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  } else {
    socket.destroy();
  }
});

process.on("unhandledRejection", (reason) => {
  const code = reason?.code || "";
  if (IGNORABLE_SOCKET_CODES.has(code)) {
    console.error(`[uxRoai-agent] Ignored unhandled rejection: ${code}`);
    return;
  }
  console.error(`[uxRoai-agent] Unhandled rejection:`, reason);
});

process.on("uncaughtException", (err) => {
  if (IGNORABLE_SOCKET_CODES.has(err.code)) {
    console.error(`[uxRoai-agent] Ignored socket error: ${err.code}`);
    return;
  }
  console.error(`[uxRoai-agent] Uncaught exception (kept alive):`, err);
});

server.listen(PORT, "127.0.0.1", () => {
  const diag = getProviderDiagnostics();
  console.log(
    `[uxRoai-agent] listening on http://127.0.0.1:${PORT} (provider=${diag.provider}, model=${diag.model}, timeout=${(diag.timeoutMs / 1000).toFixed(0)}s, configured=${diag.configured})`
  );
  pushDiagLog("info", "config", "Agent started", {
    port: PORT, ...diag, nodeVersion: process.version, platform: process.platform,
  });
});
