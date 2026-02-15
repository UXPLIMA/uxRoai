import { readJsonBody, sendJson } from "../utils.js";
import { abortJobForTask } from "./plan.js";
import {
  validateStudioTaskCreateRequest,
  validateStudioTaskResultRequest,
} from "../schemas/validators.js";
import {
  createStudioTask,
  listStudioTasks,
  getStudioTask,
  claimNextStudioTask,
  completeStudioTask,
  appendStudioTaskProgress,
  stopStudioTask,
  subscribeToEvents,
  getTaskVersion,
  registerStudioHeartbeat,
} from "../task-queue.js";

function matchTaskRoute(pathname, suffix) {
  const pattern = suffix
    ? new RegExp(`^/v1/studio/tasks/([^/]+)/${suffix}$`)
    : /^\/v1\/studio\/tasks\/([^/]+)$/;
  const match = pathname.match(pattern);
  return match ? decodeURIComponent(match[1]) : null;
}

function extractProgressEntry(entry) {
  return {
    message: entry?.message,
    type: entry?.type,
    index: entry?.index,
    total: entry?.total,
    actionType: entry?.actionType,
    actionName: entry?.actionName,
    actionPath: entry?.actionPath,
  };
}

export async function handle(req, res, pathname, requestUrl) {
  if (req.method === "POST" && pathname === "/v1/studio/tasks") {
    const body = await readJsonBody(req);
    const payload = validateStudioTaskCreateRequest(body);
    const task = createStudioTask(payload);
    sendJson(res, 201, { ok: true, task });
    return true;
  }

  if (req.method === "GET" && pathname === "/v1/studio/tasks") {
    const limit = requestUrl.searchParams.get("limit");
    const tasks = listStudioTasks(limit ? Number(limit) : 100);
    sendJson(res, 200, { ok: true, tasks });
    return true;
  }

  if (req.method === "POST" && pathname === "/v1/studio/tasks/claim") {
    const body = await readJsonBody(req);
    const workerId =
      typeof body?.workerId === "string" && body.workerId.trim()
        ? body.workerId.trim().slice(0, 120)
        : "studio-plugin";

    // Multi-studio conflict detection
    const studioId =
      typeof body?.studioId === "string" && body.studioId.trim()
        ? body.studioId.trim().slice(0, 200)
        : null;
    const conflictInfo = registerStudioHeartbeat(studioId, workerId);

    const longPoll = body?.longPoll === true;
    let task = claimNextStudioTask(workerId);

    if (!task && longPoll) {
      const maxWait = Math.min(Math.max(Number(body?.timeoutSeconds) || 25, 1), 30) * 1000;
      task = await new Promise((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            unsubscribe();
            resolve(null);
          }
        }, maxWait);

        const unsubscribe = subscribeToEvents((event) => {
          if (settled) return;
          if (event.type === "task_created") {
            const claimed = claimNextStudioTask(workerId);
            if (claimed) {
              settled = true;
              clearTimeout(timer);
              unsubscribe();
              resolve(claimed);
            }
          }
        });
      });
    }

    const response = { ok: true, task };
    if (conflictInfo.conflict) {
      response.conflict = true;
      response.activeStudios = conflictInfo.activeStudios;
    }
    sendJson(res, 200, response);
    return true;
  }

  if (req.method === "GET" && pathname === "/v1/studio/tasks/version") {
    sendJson(res, 200, { ok: true, version: getTaskVersion() });
    return true;
  }

  const getTaskId = matchTaskRoute(pathname, null);
  if (req.method === "GET" && getTaskId) {
    const task = getStudioTask(getTaskId);
    if (!task) {
      sendJson(res, 404, { ok: false, error: "Task not found" });
      return true;
    }
    sendJson(res, 200, { ok: true, task });
    return true;
  }

  const stopTaskId = matchTaskRoute(pathname, "stop");
  if (req.method === "POST" && stopTaskId) {
    const task = stopStudioTask(stopTaskId);
    if (!task) {
      sendJson(res, 404, { ok: false, error: "Task not found" });
      return true;
    }
    // Abort the running AI job for this task
    abortJobForTask(stopTaskId);
    sendJson(res, 200, { ok: true, task });
    return true;
  }

  const progressTaskId = matchTaskRoute(pathname, "progress");
  if (req.method === "POST" && progressTaskId) {
    const body = await readJsonBody(req);

    if (Array.isArray(body?.batch)) {
      let task = null;
      for (const entry of body.batch.slice(0, 50)) {
        task = appendStudioTaskProgress(progressTaskId, extractProgressEntry(entry));
      }
      if (!task) {
        sendJson(res, 404, { ok: false, error: "Task not found or not running" });
        return true;
      }
      sendJson(res, 200, { ok: true });
      return true;
    }

    const task = appendStudioTaskProgress(progressTaskId, extractProgressEntry(body));
    if (!task) {
      sendJson(res, 404, { ok: false, error: "Task not found or not running" });
      return true;
    }
    sendJson(res, 200, { ok: true });
    return true;
  }

  const completeTaskId = matchTaskRoute(pathname, "result");
  if (req.method === "POST" && completeTaskId) {
    const body = await readJsonBody(req);
    const result = validateStudioTaskResultRequest(body);
    const task = completeStudioTask(completeTaskId, result);
    if (!task) {
      sendJson(res, 404, { ok: false, error: "Task not found" });
      return true;
    }
    sendJson(res, 200, { ok: true, task });
    return true;
  }

  return false;
}
