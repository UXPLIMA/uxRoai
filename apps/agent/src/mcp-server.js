/**
 * MCP (Model Context Protocol) Server for uxRoai
 *
 * Runs as a stdio-based JSON-RPC 2.0 server.
 * Connects to the running uxRoai HTTP agent to perform operations.
 *
 * Usage: node src/mcp-server.js
 * Or configure in your MCP client (Cursor, Claude Code, etc.):
 *   { "command": "node", "args": ["src/mcp-server.js"], "cwd": "<agent-dir>" }
 */

import { createInterface } from "node:readline";

const AGENT_URL = process.env.UXROAI_AGENT_URL || "http://127.0.0.1:41117";
const SERVER_NAME = "uxroai-mcp";
const SERVER_VERSION = "0.2.0";
const PROTOCOL_VERSION = "2024-11-05";

// ── Tools Definition ──────────────────────────────────────────────

const TOOLS = [
  {
    name: "uxroai_plan",
    description:
      "Generate a Roblox Studio action plan from a natural language prompt. Returns a JSON plan with actions (create_instance, upsert_script, set_property, etc.) and optional playtest scenario. Requires the uxRoai agent HTTP server to be running.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Natural language description of what to build or change in Roblox Studio",
        },
        studioContext: {
          type: "object",
          description: "Optional Studio context (explorer snapshot). If omitted, the plan is generated without context.",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "uxroai_create_task",
    description:
      "Create a task in the uxRoai queue. The Roblox Studio plugin will automatically pick it up and execute it. Returns the created task object.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Natural language task description for the Studio plugin to execute",
        },
        projectId: {
          type: "string",
          description: "Optional project ID (default: 'default')",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "uxroai_list_tasks",
    description:
      "List recent tasks from the uxRoai queue with their status and results.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of tasks to return (default: 20)",
        },
      },
    },
  },
  {
    name: "uxroai_get_task",
    description:
      "Get details of a specific task by ID, including its result, progress, and execution status.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "The task ID to retrieve",
        },
      },
      required: ["taskId"],
    },
  },
  {
    name: "uxroai_health",
    description:
      "Check if the uxRoai agent is running and which AI provider is configured.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

// ── Agent HTTP Client ─────────────────────────────────────────────

async function agentRequest(route, method = "GET", payload = null) {
  const url = `${AGENT_URL}${route}`;
  const options = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (payload) {
    options.body = JSON.stringify(payload);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 900_000);
  options.signal = controller.signal;

  try {
    const response = await fetch(url, options);
    const text = await response.text();
    let body = {};
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text };
      }
    }
    if (!response.ok) {
      throw new Error(body?.error || `HTTP ${response.status}`);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Tool Handlers ─────────────────────────────────────────────────

async function handleToolCall(name, args) {
  switch (name) {
    case "uxroai_plan": {
      const result = await agentRequest("/v1/plan", "POST", {
        prompt: String(args?.prompt || ""),
        studioContext: args?.studioContext || {},
      });
      return JSON.stringify(result.plan || result, null, 2);
    }

    case "uxroai_create_task": {
      const result = await agentRequest("/v1/studio/tasks", "POST", {
        prompt: String(args?.prompt || ""),
        projectId: String(args?.projectId || "default"),
        source: "mcp",
      });
      return JSON.stringify(result.task || result, null, 2);
    }

    case "uxroai_list_tasks": {
      const limit = Number(args?.limit) || 20;
      const result = await agentRequest(`/v1/studio/tasks?limit=${limit}`);
      const tasks = (result.tasks || []).map((t) => ({
        id: t.id,
        prompt: (t.prompt || "").slice(0, 120),
        status: t.status,
        createdAt: t.createdAt,
        summary: t.result?.summary || null,
      }));
      return JSON.stringify(tasks, null, 2);
    }

    case "uxroai_get_task": {
      const taskId = String(args?.taskId || "");
      if (!taskId) throw new Error("taskId is required");
      const result = await agentRequest(`/v1/studio/tasks/${encodeURIComponent(taskId)}`);
      return JSON.stringify(result.task || result, null, 2);
    }

    case "uxroai_health": {
      const result = await agentRequest("/health");
      return JSON.stringify(result, null, 2);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── JSON-RPC Message Handling ─────────────────────────────────────

function sendMessage(msg) {
  const json = JSON.stringify(msg);
  process.stdout.write(json + "\n");
}

function makeResponse(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function makeError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function handleMessage(msg) {
  const { id, method, params } = msg;

  if (method === "initialize") {
    return sendMessage(
      makeResponse(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION,
        },
      })
    );
  }

  if (method === "notifications/initialized" || method === "initialized") {
    // Client acknowledged initialization — no response needed
    return;
  }

  if (method === "tools/list") {
    return sendMessage(makeResponse(id, { tools: TOOLS }));
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    const toolArgs = params?.arguments || {};

    try {
      const text = await handleToolCall(toolName, toolArgs);
      return sendMessage(
        makeResponse(id, {
          content: [{ type: "text", text }],
        })
      );
    } catch (err) {
      return sendMessage(
        makeResponse(id, {
          content: [{ type: "text", text: `Error: ${err.message}` }],
          isError: true,
        })
      );
    }
  }

  if (method === "ping") {
    return sendMessage(makeResponse(id, {}));
  }

  // Unknown method
  if (id !== undefined) {
    return sendMessage(makeError(id, -32601, `Method not found: ${method}`));
  }
}

// ── Stdio Transport ───────────────────────────────────────────────

const rl = createInterface({ input: process.stdin });

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const msg = JSON.parse(trimmed);
    await handleMessage(msg);
  } catch (err) {
    // Parse error
    sendMessage(makeError(null, -32700, `Parse error: ${err.message}`));
  }
});

rl.on("close", () => {
  process.exit(0);
});

// Prevent unhandled rejection crashes
process.on("unhandledRejection", (err) => {
  process.stderr.write(`[uxroai-mcp] unhandled rejection: ${err?.message || err}\n`);
});
