const MAX_TASKS = 500;
const MAX_HISTORY_ENTRIES = 10;
const MAX_ATTACHMENTS = 20;
const MAX_PROGRESS_ENTRIES = 200;

const tasks = [];
const eventListeners = new Set();
let taskVersion = 0;

// ── Multi-Studio Conflict Tracking ──
const activeStudios = new Map(); // studioId -> { lastSeen, workerId }
const STUDIO_TIMEOUT_MS = 60_000; // consider studio disconnected after 60s

function nowIso() {
  return new Date().toISOString();
}

function emitTaskEvent(eventType, task) {
  taskVersion++;
  const event = {
    type: eventType,
    taskId: task?.id,
    taskStatus: task?.status,
    version: taskVersion,
    timestamp: nowIso(),
  };
  for (const listener of eventListeners) {
    try {
      listener(event);
    } catch {
      // listener errors should not break the queue
    }
  }
}

export function subscribeToEvents(listener) {
  eventListeners.add(listener);
  return () => eventListeners.delete(listener);
}

export function getTaskVersion() {
  return taskVersion;
}

function generateTaskId() {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createStudioTask({ prompt, projectId = "default", chatId, source = "desktop", history, attachments, projectApiKey, projectCustomPrompt, maxRetries, minPlaytestSeconds, planTimeoutSec }) {
  const task = {
    id: generateTaskId(),
    prompt,
    projectId,
    chatId: chatId || null,
    source,
    history: Array.isArray(history) ? history.slice(0, MAX_HISTORY_ENTRIES) : [],
    attachments: Array.isArray(attachments) ? attachments.slice(0, MAX_ATTACHMENTS) : [],
    status: "pending",
    createdAt: nowIso(),
    claimedAt: null,
    finishedAt: null,
    workerId: null,
    result: null,
    progress: [],
    pendingPlan: null,
    planDecision: null,
    projectApiKey: projectApiKey || null,
    projectCustomPrompt: projectCustomPrompt || null,
    ...(maxRetries != null ? { maxRetries } : {}),
    ...(minPlaytestSeconds != null ? { minPlaytestSeconds } : {}),
    ...(planTimeoutSec != null ? { planTimeoutSec } : {}),
  };

  tasks.push(task);
  if (tasks.length > MAX_TASKS) {
    tasks.splice(0, tasks.length - MAX_TASKS);
  }

  emitTaskEvent("task_created", task);
  return task;
}

export function listStudioTasks(limit = 100) {
  const normalizedLimit = Math.max(1, Math.min(MAX_TASKS, Number(limit) || 100));
  const start = Math.max(0, tasks.length - normalizedLimit);
  const result = [];
  for (let i = tasks.length - 1; i >= start; i--) {
    result.push(tasks[i]);
  }
  return result;
}

export function getStudioTask(taskId) {
  return tasks.find((task) => task.id === String(taskId)) || null;
}

export function registerStudioHeartbeat(studioId, workerId) {
  if (!studioId) return { conflict: false };

  // Clean up stale studios
  const now = Date.now();
  for (const [id, info] of activeStudios) {
    if (now - info.lastSeen > STUDIO_TIMEOUT_MS) {
      activeStudios.delete(id);
    }
  }

  activeStudios.set(studioId, { lastSeen: now, workerId });

  // Detect conflict: another active studio exists with a different studioId
  const otherStudios = [];
  for (const [id, info] of activeStudios) {
    if (id !== studioId && now - info.lastSeen < STUDIO_TIMEOUT_MS) {
      otherStudios.push(id);
    }
  }

  return {
    conflict: otherStudios.length > 0,
    activeStudios: otherStudios.length > 0 ? [studioId, ...otherStudios] : undefined,
  };
}

export function getActiveStudioCount() {
  const now = Date.now();
  let count = 0;
  for (const [, info] of activeStudios) {
    if (now - info.lastSeen < STUDIO_TIMEOUT_MS) count++;
  }
  return count;
}

export function claimNextStudioTask(workerId = "studio-plugin") {
  for (const task of tasks) {
    if (task.status === "pending") {
      task.status = "running";
      task.claimedAt = nowIso();
      task.workerId = workerId;
      emitTaskEvent("task_claimed", task);
      return task;
    }
  }
  return null;
}

export function completeStudioTask(taskId, result) {
  const task = getStudioTask(taskId);
  if (!task) {
    return null;
  }

  const ok = Boolean(result?.ok);
  task.status = ok ? "done" : "failed";
  task.finishedAt = nowIso();
  task.result = result || {};
  emitTaskEvent("task_completed", task);
  return task;
}

export function appendStudioTaskProgress(taskId, entry) {
  const task = getStudioTask(taskId);
  if (!task || task.status !== "running") {
    return null;
  }
  if (!Array.isArray(task.progress)) {
    task.progress = [];
  }
  const progressEntry = {
    message: String(entry?.message || ""),
    type: String(entry?.type || "info"),
    timestamp: nowIso(),
    ...(entry?.index != null ? { index: entry.index } : {}),
    ...(entry?.total != null ? { total: entry.total } : {}),
    ...(entry?.actionType ? { actionType: String(entry.actionType) } : {}),
    ...(entry?.actionName ? { actionName: String(entry.actionName) } : {}),
    ...(entry?.actionPath ? { actionPath: String(entry.actionPath) } : {}),
  };
  // "thinking" and "streaming" entries replace the previous one to avoid flooding
  const replaceTypes = new Set(["thinking", "streaming"]);
  if (replaceTypes.has(progressEntry.type) && task.progress.length > 0 && replaceTypes.has(task.progress[task.progress.length - 1].type)) {
    task.progress[task.progress.length - 1] = progressEntry;
  } else {
    task.progress.push(progressEntry);
  }
  if (task.progress.length > MAX_PROGRESS_ENTRIES) {
    task.progress = task.progress.slice(-MAX_PROGRESS_ENTRIES);
  }
  emitTaskEvent("task_progress", task);
  return task;
}

export function stopStudioTask(taskId) {
  const task = getStudioTask(taskId);
  if (!task) {
    return null;
  }
  if (task.status === "done" || task.status === "failed" || task.status === "stopped") {
    return task;
  }
  task.status = "stopped";
  task.finishedAt = nowIso();
  if (!task.result) {
    task.result = {};
  }
  task.result.stoppedByUser = true;
  emitTaskEvent("task_stopped", task);
  return task;
}

export function submitPlanForApproval(taskId, plan) {
  const task = getStudioTask(taskId);
  if (!task || task.status !== "running") {
    return null;
  }
  task.pendingPlan = plan;
  task.planDecision = null;
  emitTaskEvent("plan_submitted", task);
  return task;
}

export function setPlanDecision(taskId, approved, editedPlan) {
  const task = getStudioTask(taskId);
  if (!task || !task.pendingPlan) {
    return null;
  }
  task.planDecision = {
    approved: Boolean(approved),
    plan: approved && editedPlan ? editedPlan : task.pendingPlan,
    decidedAt: nowIso(),
  };
  emitTaskEvent("plan_decision", task);
  return task;
}

export function setTaskUsage(taskId, usage) {
  const task = getStudioTask(taskId);
  if (!task) return null;
  task.usage = usage || null;
  return task;
}

export function awaitPlanDecision(taskId, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const task = getStudioTask(taskId);
    if (!task) return resolve(null);
    if (task.planDecision) return resolve(task.planDecision);
    if (task.status === "stopped") return resolve({ approved: false });

    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        unsubscribe();
        resolve(null);
      }
    }, timeoutMs);

    const unsubscribe = subscribeToEvents((event) => {
      if (settled) return;
      if (event.taskId === taskId && (event.type === "plan_decision" || event.type === "task_stopped")) {
        const t = getStudioTask(taskId);
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(t?.planDecision || { approved: false });
      }
    });
  });
}

