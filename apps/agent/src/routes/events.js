import { subscribeToEvents, getTaskVersion } from "../task-queue.js";

export async function handle(req, res, pathname) {
  if (req.method === "GET" && pathname === "/v1/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    res.write(`data: ${JSON.stringify({ type: "connected", version: getTaskVersion() })}\n\n`);

    let cleaned = false;
    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      clearInterval(pingTimer);
      unsubscribe();
    }

    const pingTimer = setInterval(() => {
      try {
        res.write(`: ping\n\n`);
      } catch {
        cleanup();
      }
    }, 15000);

    const unsubscribe = subscribeToEvents((event) => {
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        cleanup();
      }
    });

    req.on("close", cleanup);

    return true;
  }

  return false;
}
