import { readJsonBody, sendJson, createHttpError } from "../utils.js";
import { validatePlanRequest } from "../schemas/validators.js";
import { normalizePlan } from "../schemas/normalize-plan.js";
import {
  generatePlanWithClaude,
  hasClaudeConfig,
} from "../ai.js";
import { getLastCallUsage } from "../providers/usage.js";
import { createJob, finishJob, failJob, getJob, deleteJob, abortJob } from "../jobs.js";
import { appendStudioTaskProgress, setTaskUsage } from "../task-queue.js";
import { pushDiagLog, getProviderDiagnostics } from "../providers/dispatcher.js";

// Track which job belongs to which task so stop can abort it
const taskJobMap = new Map();

export function abortJobForTask(taskId) {
  const jobId = taskJobMap.get(taskId);
  if (jobId) {
    taskJobMap.delete(taskId);
    abortJob(jobId);
    pushDiagLog("info", "request", `Aborted job ${jobId} for stopped task ${taskId}`);
    return true;
  }
  return false;
}

async function resolvePlan(prompt, studioContext, history, attachments, onToken, overrides, signal) {
  if (!hasClaudeConfig()) {
    throw createHttpError("AI provider is not configured. Set CLAUDE_API_KEY (for API mode) or ensure 'claude' CLI is installed and in PATH (check ~/.local/bin).", 503);
  }

  const raw = await generatePlanWithClaude(prompt, studioContext, history, attachments, onToken, overrides, signal);
  const plan = normalizePlan(raw);

  return plan;
}

export async function handle(req, res, pathname) {
  if (req.method === "POST" && pathname === "/v1/plan") {
    const body = await readJsonBody(req);
    const { prompt, studioContext, history } = validatePlanRequest(body);
    const attachments = Array.isArray(body?.attachments) ? body.attachments : [];

    const taskId = typeof body?.taskId === "string" ? body.taskId.trim() : "";
    let onToken = undefined;
    if (taskId) {
      let lastPush = 0;
      onToken = (accumulated) => {
        const now = Date.now();
        if (now - lastPush < 300) return;
        lastPush = now;
        appendStudioTaskProgress(taskId, {
          message: accumulated.slice(-800),
          type: "streaming",
        });
      };
    }

    const overrides = {};
    if (body?.projectApiKey) overrides.apiKey = String(body.projectApiKey).slice(0, 256);
    if (body?.projectCustomPrompt) overrides.customPrompt = String(body.projectCustomPrompt).slice(0, 4000);

    const useAsync = body?.async === true;

    // Log task start with full diagnostics
    const diag = getProviderDiagnostics();
    if (taskId) {
      appendStudioTaskProgress(taskId, {
        message: `Provider: ${diag.provider} | Model: ${diag.model} | Timeout: ${(diag.timeoutMs / 1000).toFixed(0)}s | Configured: ${diag.configured}`,
        type: "config",
      });
    }
    pushDiagLog("info", "request", `Plan request started`, {
      taskId, async: useAsync, provider: diag.provider, model: diag.model,
      promptLen: prompt?.length || 0, historyLen: history?.length || 0,
      hasOverrides: Boolean(overrides?.apiKey || overrides?.customPrompt),
    });

    if (useAsync) {
      const { id: jobId, signal } = createJob();
      const jobStartTime = Date.now();

      // Track task→job mapping for stop/abort
      if (taskId) taskJobMap.set(taskId, jobId);

      (async () => {
        try {
          const plan = await resolvePlan(prompt, studioContext, history, attachments, onToken, overrides, signal);
          const usage = getLastCallUsage();
          if (taskId && usage) setTaskUsage(taskId, usage);
          const duration = Date.now() - jobStartTime;
          pushDiagLog("info", "request", `Plan job completed in ${(duration / 1000).toFixed(1)}s`, { jobId, taskId, duration });
          finishJob(jobId, { ok: true, plan, usage: usage || null });
        } catch (err) {
          if (err.name === "AbortError" || signal.aborted) {
            pushDiagLog("info", "request", `Plan job aborted (task stopped)`, { jobId, taskId });
            failJob(jobId, new Error("Task stopped by user"));
          } else {
            const duration = Date.now() - jobStartTime;
            pushDiagLog("error", "request", `Plan job FAILED after ${(duration / 1000).toFixed(1)}s: ${err.message}`, { jobId, taskId, duration, error: err.message });
            if (taskId) {
              appendStudioTaskProgress(taskId, {
                message: `ERROR: ${err.message}`,
                type: "error",
              });
            }
            failJob(jobId, err);
          }
        } finally {
          if (taskId) taskJobMap.delete(taskId);
        }
      })();
      return sendJson(res, 202, { ok: true, pending: true, jobId }), true;
    }

    const plan = await resolvePlan(prompt, studioContext, history, attachments, onToken, overrides);
    const usage = getLastCallUsage();
    if (taskId && usage) {
      setTaskUsage(taskId, usage);
    }
    sendJson(res, 200, { ok: true, plan, usage: usage || null });
    return true;
  }

  // Poll for async plan result
  if (req.method === "GET" && pathname.startsWith("/v1/plan/result/")) {
    const jobId = decodeURIComponent(pathname.slice("/v1/plan/result/".length));
    const job = getJob(jobId);
    if (!job) { sendJson(res, 404, { ok: false, error: "Job not found" }); return true; }
    if (job.status === "processing") { sendJson(res, 200, { ok: true, pending: true }); return true; }
    if (job.status === "aborted") { deleteJob(jobId); sendJson(res, 200, { ok: false, aborted: true }); return true; }
    deleteJob(jobId);
    if (job.status === "error") { sendJson(res, 500, { ok: false, error: job.error }); return true; }
    sendJson(res, 200, job.result);
    return true;
  }

  return false;
}
