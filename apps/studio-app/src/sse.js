const http = require("node:http");
const { BrowserWindow } = require("electron");
const { readConfig, normalizeAgentUrl } = require("./config.js");

let sseConnection = null;
let sseReconnectTimer = null;
let sseReconnectAttempts = 0;

function connectSSE() {
  disconnectSSE();

  const config = readConfig();
  const agentUrl = normalizeAgentUrl(config.agentUrl);
  const url = `${agentUrl}/v1/events`;
  const parsedUrl = new URL(url);

  const req = http.get({
    hostname: parsedUrl.hostname,
    port: parsedUrl.port,
    path: parsedUrl.pathname,
    headers: { Accept: "text/event-stream" },
  }, (res) => {
    if (res.statusCode !== 200) {
      res.resume();
      scheduleSSEReconnect();
      return;
    }

    sseConnection = res;
    sseReconnectAttempts = 0;
    let buffer = "";

    res.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const jsonStr = line.slice(6);
          try {
            const event = JSON.parse(jsonStr);
            for (const win of BrowserWindow.getAllWindows()) {
              try {
                win.webContents.send("sse:task-event", event);
              } catch {
                // window might be closing
              }
            }
          } catch {
            // ignore parse errors (ping comments etc.)
          }
        }
      }
    });

    res.on("end", () => {
      sseConnection = null;
      scheduleSSEReconnect();
    });

    res.on("error", () => {
      sseConnection = null;
      scheduleSSEReconnect();
    });
  });

  req.on("error", () => {
    scheduleSSEReconnect();
  });
}

function disconnectSSE() {
  if (sseReconnectTimer) {
    clearTimeout(sseReconnectTimer);
    sseReconnectTimer = null;
  }
  if (sseConnection) {
    try {
      sseConnection.destroy();
    } catch {
      // ignore
    }
    sseConnection = null;
  }
}

function scheduleSSEReconnect() {
  if (sseReconnectTimer) return;
  const baseDelay = Math.min(3000 * Math.pow(1.5, sseReconnectAttempts), 30000);
  const jitter = Math.random() * 1000;
  sseReconnectAttempts++;
  sseReconnectTimer = setTimeout(() => {
    sseReconnectTimer = null;
    connectSSE();
  }, baseDelay + jitter);
}

module.exports = { connectSSE, disconnectSSE };
