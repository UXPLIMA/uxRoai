import { safeString } from "./helpers.js";

function parseHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry) => entry && typeof entry === "object")
    .slice(0, 10)
    .map((entry) => ({
      prompt: safeString(entry.prompt).slice(0, 500),
      summary: safeString(entry.summary).slice(0, 300),
      status: safeString(entry.status).slice(0, 20),
    }));
}

export function validatePlanRequest(body) {
  const prompt = safeString(body?.prompt).trim();
  if (!prompt) {
    const error = new Error("Field `prompt` is required");
    error.statusCode = 400;
    throw error;
  }

  const studioContext =
    body?.studioContext && typeof body.studioContext === "object"
      ? body.studioContext
      : {};

  return {
    prompt: prompt.slice(0, 6000),
    studioContext,
    history: parseHistory(body?.history),
  };
}

export function validatePlaytestRequest(body) {
  const goal = safeString(body?.goal || body?.prompt).trim();
  if (!goal) {
    const error = new Error("Field `goal` is required");
    error.statusCode = 400;
    throw error;
  }

  const studioContext =
    body?.studioContext && typeof body.studioContext === "object"
      ? body.studioContext
      : {};

  return {
    goal: goal.slice(0, 6000),
    studioContext,
  };
}

export function validateStudioTaskCreateRequest(body) {
  const prompt = safeString(body?.prompt).trim();
  if (!prompt) {
    const error = new Error("Field `prompt` is required");
    error.statusCode = 400;
    throw error;
  }

  const projectId = safeString(body?.projectId, "default").slice(0, 120) || "default";
  const source = safeString(body?.source, "desktop").slice(0, 120) || "desktop";

  const maxRetries = Number.isFinite(Number(body?.maxRetries))
    ? Math.max(1, Math.min(20, Math.round(Number(body.maxRetries))))
    : undefined;
  const minPlaytestSeconds = Number.isFinite(Number(body?.minPlaytestSeconds))
    ? Math.max(0, Math.min(120, Math.round(Number(body.minPlaytestSeconds))))
    : undefined;
  const planTimeoutSec = Number.isFinite(Number(body?.planTimeoutSec))
    ? Math.max(30, Math.min(1200, Math.round(Number(body.planTimeoutSec))))
    : undefined;

  const attachments = Array.isArray(body?.attachments)
    ? body.attachments
        .filter((a) => a && typeof a === "object" && safeString(a.id) && safeString(a.path))
        .slice(0, 20)
        .map((a) => ({
          id: safeString(a.id),
          originalName: safeString(a.originalName),
          path: safeString(a.path),
          type: safeString(a.type, "image"),
          ext: safeString(a.ext),
        }))
    : [];

  const projectApiKey = safeString(body?.projectApiKey).slice(0, 256);
  const projectCustomPrompt = safeString(body?.projectCustomPrompt).slice(0, 4000);

  return {
    prompt: prompt.slice(0, 12000),
    projectId,
    source,
    history: parseHistory(body?.history),
    attachments,
    ...(maxRetries !== undefined && { maxRetries }),
    ...(minPlaytestSeconds !== undefined && { minPlaytestSeconds }),
    ...(planTimeoutSec !== undefined && { planTimeoutSec }),
    ...(projectApiKey && { projectApiKey }),
    ...(projectCustomPrompt && { projectCustomPrompt }),
  };
}

function normalizeTaskChange(change) {
  if (!change || typeof change !== "object") {
    return null;
  }

  const out = {
    type: safeString(change.type),
    path: safeString(change.path),
    scriptPath: safeString(change.scriptPath),
    name: safeString(change.name),
    summary: safeString(change.summary),
  };

  if (typeof change.count === "number") {
    out.count = Math.max(0, Math.min(1_000_000, Math.floor(change.count)));
  }

  if (typeof change.beforeSource === "string") {
    out.beforeSource = change.beforeSource.slice(0, 20_000);
  }

  if (typeof change.afterSource === "string") {
    out.afterSource = change.afterSource.slice(0, 20_000);
  }

  if (change.details && typeof change.details === "object") {
    out.details = change.details;
  }

  if (Array.isArray(change.paths)) {
    out.paths = change.paths
      .map((item) => safeString(item))
      .filter(Boolean)
      .slice(0, 500);
  }

  if (change.playtestResult && typeof change.playtestResult === "object") {
    out.playtestResult = change.playtestResult;
  }

  return out;
}

export function validateStudioTaskResultRequest(body) {
  const warnings = Array.isArray(body?.warnings)
    ? body.warnings.map((item) => safeString(item)).filter(Boolean).slice(0, 100)
    : [];

  const logs = Array.isArray(body?.logs)
    ? body.logs.map((item) => safeString(item)).filter(Boolean).slice(0, 200)
    : [];

  const changes = Array.isArray(body?.changes)
    ? body.changes.map((item) => normalizeTaskChange(item)).filter(Boolean).slice(0, 500)
    : [];

  const actions = Array.isArray(body?.actions)
    ? body.actions.map((item) => normalizeTaskChange(item)).filter(Boolean).slice(0, 500)
    : [];

  return {
    ok: Boolean(body?.ok),
    summary: safeString(body?.summary, ""),
    warnings,
    actionCount: Number.isFinite(Number(body?.actionCount))
      ? Math.max(0, Math.min(10000, Number(body.actionCount)))
      : 0,
    playtestResult:
      body?.playtestResult && typeof body.playtestResult === "object"
        ? body.playtestResult
        : null,
    changes,
    actions,
    logs,
    metadata:
      body?.metadata && typeof body.metadata === "object" ? body.metadata : {},
  };
}
