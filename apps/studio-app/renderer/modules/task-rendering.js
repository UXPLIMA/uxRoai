import { state, el } from "./state.js";
import { t, displayStatus } from "./i18n.js";
import { toHumanTime, formatDuration, safeJson, copyToClipboard } from "./utils.js";
import { showToast } from "./toast.js";
import { showContextMenu } from "./context-menu.js";
import { renderChanges } from "./changes-ui.js";
import { renderPlaytest } from "./playtest-ui.js";
import { getActiveProject, showPromptModal, openModal, closeModal } from "./projects-ui.js";
import { refreshTasks, bootstrapConfig } from "./polling.js";
import { categorizeAction } from "./tool-hints.js";

// Rewind state
let _rewindResolve = null;

function showRewindModal(prompt) {
  return new Promise((resolve) => {
    _rewindResolve = resolve;
    el.rewindModalTitle.textContent = t("rewindTitle");
    el.rewindModalText.textContent = t("rewindConfirm");
    el.rewindConfirmBtn.textContent = t("rewindBtn");
    el.rewindCancelBtn.textContent = t("cancel");
    openModal(el.rewindModal);
  });
}

function closeRewindModal(accepted) {
  if (el.rewindModal.classList.contains("hidden")) return;
  closeModal(el.rewindModal);
  const resolve = _rewindResolve;
  _rewindResolve = null;
  if (resolve) resolve(accepted);
}

// Wire up rewind modal buttons (called once)
let _rewindWired = false;
function wireRewindModal() {
  if (_rewindWired) return;
  _rewindWired = true;
  el.rewindConfirmBtn.addEventListener("click", () => closeRewindModal(true));
  el.rewindCancelBtn.addEventListener("click", () => closeRewindModal(false));
  el.rewindModalCloseBtn.addEventListener("click", () => closeRewindModal(false));
  el.rewindModal.addEventListener("click", (e) => {
    if (e.target === el.rewindModal) closeRewindModal(false);
  });
}

function normalizeTaskStatus(task, result) {
  const explicit = String(task?.status || "").toLowerCase();
  if (explicit === "stopped") return "stopped";
  if (explicit) return explicit;
  if (result?.ok === false) return "failed";
  if (result?.ok === true) return "done";
  return "pending";
}

export function captureTaskUiSnapshot() {
  const taskStates = {};
  const conversations = el.timeline.querySelectorAll(".chat-conversation[data-task-id]");

  for (const conv of conversations) {
    const taskId = String(conv.dataset.taskId || "");
    if (!taskId) continue;

    const detailsOpen = {};
    const scrollTops = {};

    for (const detailsNode of conv.querySelectorAll("details[data-ui-key]")) {
      detailsOpen[detailsNode.dataset.uiKey] = Boolean(detailsNode.open);
    }

    for (const scrollNode of conv.querySelectorAll("[data-scroll-key]")) {
      scrollTops[scrollNode.dataset.scrollKey] = Number(scrollNode.scrollTop || 0);
    }

    taskStates[taskId] = { detailsOpen, scrollTops };
  }

  const maxScroll = Math.max(0, el.timeline.scrollHeight - el.timeline.clientHeight);
  const atBottom = maxScroll - el.timeline.scrollTop < 12;

  return {
    taskStates,
    timelineScrollTop: el.timeline.scrollTop,
    timelineAtBottom: atBottom,
  };
}

function restoreTaskUiSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return;

  const taskStates = snapshot.taskStates || {};
  const conversations = el.timeline.querySelectorAll(".chat-conversation[data-task-id]");

  for (const conv of conversations) {
    const taskId = String(conv.dataset.taskId || "");
    const saved = taskStates[taskId];
    if (!saved) continue;

    const detailsOpen = saved.detailsOpen || {};
    for (const detailsNode of conv.querySelectorAll("details[data-ui-key]")) {
      const key = detailsNode.dataset.uiKey;
      if (Object.prototype.hasOwnProperty.call(detailsOpen, key)) {
        detailsNode.open = Boolean(detailsOpen[key]);
      }
    }

    const scrollTops = saved.scrollTops || {};
    for (const scrollNode of conv.querySelectorAll("[data-scroll-key]")) {
      const key = scrollNode.dataset.scrollKey;
      if (Object.prototype.hasOwnProperty.call(scrollTops, key)) {
        scrollNode.scrollTop = Number(scrollTops[key] || 0);
      }
    }
  }

  if (snapshot.timelineAtBottom) {
    el.timeline.scrollTop = el.timeline.scrollHeight;
  } else {
    el.timeline.scrollTop = Number(snapshot.timelineScrollTop || 0);
  }
}

function renderTaskStatusLine(chatStatusLine, normalizedStatus, task, result) {
  if (normalizedStatus === "running" && task.pendingPlan && !task.planDecision) {
    chatStatusLine.innerHTML = '<span class="plan-waiting-icon"></span>' + t("planWaiting");
  } else if (normalizedStatus === "running") {
    // Show action-specific hint if available
    let hintText = t("processing");
    if (Array.isArray(task.progress) && task.progress.length > 0) {
      const lastAction = [...task.progress].reverse().find(e => e.type === "action");
      if (lastAction && lastAction.actionType) {
        hintText = categorizeAction(lastAction.actionType);
      }
    }
    chatStatusLine.innerHTML = '<span class="spinner"></span>' + hintText;
  } else if (normalizedStatus === "pending") {
    chatStatusLine.textContent = t("waitingStudio");
  } else if (normalizedStatus === "done") {
    chatStatusLine.innerHTML = `<span class="pill done status-pill">${displayStatus("done")}</span>`;
  } else if (normalizedStatus === "stopped") {
    chatStatusLine.innerHTML = `<span class="pill stopped status-pill">${displayStatus("stopped")}</span>`;
  } else if (normalizedStatus === "failed") {
    const issueCount = Array.isArray(result?.issues) ? result.issues.length : 0;
    const pillText = issueCount > 0 ? `${issueCount} ${t("statusIssue")}` : displayStatus("failed");
    chatStatusLine.innerHTML = `<span class="pill bad status-pill">${pillText}</span>`;
  }
}

function renderTaskTiming(chatStatusLine, normalizedStatus, task) {
  if (normalizedStatus === "running" && task.claimedAt) {
    const claimedMs = new Date(task.claimedAt).getTime();
    const elapsed = Date.now() - claimedMs;
    if (elapsed > 0) {
      const timingSpan = document.createElement("span");
      timingSpan.className = "chat-timing";
      timingSpan.dataset.claimedAt = String(claimedMs);
      timingSpan.textContent = `\u00b7 ${formatDuration(elapsed)}`;
      chatStatusLine.appendChild(timingSpan);
    }
  } else if ((normalizedStatus === "done" || normalizedStatus === "failed" || normalizedStatus === "stopped") && task.claimedAt && task.finishedAt) {
    const duration = new Date(task.finishedAt).getTime() - new Date(task.claimedAt).getTime();
    if (duration > 0) {
      const timingSpan = document.createElement("span");
      timingSpan.className = "chat-timing";
      timingSpan.textContent = `\u00b7 ${formatDuration(duration)}`;
      chatStatusLine.appendChild(timingSpan);
    }

    if (task.usage && task.usage.totalTokens > 0) {
      const usageSpan = document.createElement("span");
      usageSpan.className = "chat-usage";
      const total = task.usage.totalTokens;
      const display = total >= 1000 ? (total / 1000).toFixed(1) + "k" : String(total);
      usageSpan.textContent = `\u00b7 ${display} ${t("tokensUsed")}`;
      usageSpan.title = `In: ${task.usage.inputTokens || 0}  Out: ${task.usage.outputTokens || 0}`;
      chatStatusLine.appendChild(usageSpan);
    }
  }
}

function renderStopButton(chatStatusLine, task) {
  const stopBtn = document.createElement("button");
  stopBtn.className = "stop-task-btn";
  stopBtn.textContent = t("stopTask");
  stopBtn.addEventListener("click", async () => {
    stopBtn.disabled = true;
    try {
      await window.uxRoaiStudio.stopTask(task.id);
      await refreshTasks();
    } catch (err) {
      showToast(err.message || t("stopTaskFailed"), "error");
    } finally {
      stopBtn.disabled = false;
    }
  });
  chatStatusLine.appendChild(stopBtn);
}

function renderProgressTree(chatChanges, chatSummary, task) {
  const summaryEntry = [...task.progress].reverse().find(e => e.type === "summary");
  if (summaryEntry) {
    chatSummary.textContent = summaryEntry.message;
  }

  const lastThinking = [...task.progress].reverse().find(e => e.type === "thinking" || e.type === "streaming");

  const treeContainer = document.createElement("div");
  treeContainer.className = "progress-tree";

  const treeNodes = task.progress.filter(e => {
    const tp = String(e.type || "info");
    return tp !== "summary" && tp !== "plan_waiting";
  });

  const lastActionIndex = treeNodes.length - 1;

  for (let ni = 0; ni < treeNodes.length; ni++) {
    const entry = treeNodes[ni];
    const entryType = String(entry.type || "info");

    if (entryType === "streaming") {
      if (entry !== lastThinking) continue;
      const streamEl = document.createElement("pre");
      streamEl.className = "streaming-output";
      streamEl.textContent = String(entry.message || "");
      treeContainer.appendChild(streamEl);
      continue;
    }

    if (entryType === "thinking") {
      if (entry !== lastThinking) continue;
      const thinkEl = document.createElement("div");
      thinkEl.className = "chat-summary thinking-pulse";
      thinkEl.textContent = String(entry.message || "");
      treeContainer.appendChild(thinkEl);
      continue;
    }

    const node = document.createElement("div");
    const isLast = ni === lastActionIndex;
    node.className = `progress-tree-node${isLast ? " last" : ""}`;

    const iconEl = document.createElement("span");
    iconEl.className = "tree-node-icon";
    if (entryType === "action") {
      iconEl.textContent = isLast ? "\u25b6" : "\u2713";
      iconEl.classList.add(isLast ? "running" : "done");
    } else if (entryType === "playtest") {
      iconEl.textContent = "\u25b6";
      iconEl.classList.add("playtest");
    } else if (entryType === "retry") {
      iconEl.textContent = "\u21bb";
      iconEl.classList.add("retry");
    } else {
      iconEl.textContent = "\u25C6";
      iconEl.classList.add("info");
    }

    const contentEl = document.createElement("div");
    contentEl.className = "tree-node-content";

    if (entryType === "action") {
      const typeTag = document.createElement("span");
      typeTag.className = "prop-change-type";
      typeTag.textContent = String(entry.actionType || "ACTION").toUpperCase();
      const nameEl = document.createElement("span");
      nameEl.className = "tree-node-name";
      nameEl.textContent = entry.actionName || "Running...";
      const pathEl = document.createElement("span");
      pathEl.className = "tree-node-path";
      pathEl.textContent = String(entry.actionPath || "");
      contentEl.appendChild(typeTag);
      contentEl.appendChild(nameEl);
      if (entry.actionPath) contentEl.appendChild(pathEl);
    } else if (entryType === "playtest") {
      const typeTag = document.createElement("span");
      typeTag.className = "prop-change-type playtest-type";
      typeTag.textContent = "PLAYTEST";
      const nameEl = document.createElement("span");
      nameEl.className = "tree-node-name";
      nameEl.textContent = String(entry.message || "Running playtest...");
      contentEl.appendChild(typeTag);
      contentEl.appendChild(nameEl);
    } else if (entryType === "retry") {
      const typeTag = document.createElement("span");
      typeTag.className = "prop-change-type retry-type";
      typeTag.textContent = "RETRY";
      const nameEl = document.createElement("span");
      nameEl.className = "tree-node-name";
      nameEl.textContent = String(entry.message || "Retrying...");
      contentEl.appendChild(typeTag);
      contentEl.appendChild(nameEl);
    } else {
      const nameEl = document.createElement("span");
      nameEl.className = "tree-node-name muted";
      nameEl.textContent = String(entry.message || "");
      contentEl.appendChild(nameEl);
    }

    node.appendChild(iconEl);
    node.appendChild(contentEl);
    treeContainer.appendChild(node);
  }

  chatChanges.appendChild(treeContainer);
}

function renderPlanPreview(chatChanges, task) {
  const planPanel = document.createElement("div");
  planPanel.className = "plan-preview-panel";

  const planHeader = document.createElement("div");
  planHeader.className = "plan-preview-header";
  const planTitle = document.createElement("span");
  planTitle.className = "plan-preview-title";
  planTitle.textContent = t("planPreviewTitle");
  const planCount = document.createElement("span");
  planCount.className = "plan-preview-count";
  const actions = Array.isArray(task.pendingPlan.actions) ? task.pendingPlan.actions : [];
  planCount.textContent = `${actions.length} ${t("planActions")}`;
  planHeader.appendChild(planTitle);
  planHeader.appendChild(planCount);
  planPanel.appendChild(planHeader);

  if (task.pendingPlan.summary) {
    const summaryEl = document.createElement("div");
    summaryEl.className = "plan-preview-summary";
    summaryEl.textContent = task.pendingPlan.summary;
    planPanel.appendChild(summaryEl);
  }

  const actionList = document.createElement("div");
  actionList.className = "plan-preview-actions";
  const removedIndices = new Set();

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const actionCard = document.createElement("div");
    actionCard.className = "plan-action-card";
    actionCard.dataset.actionIndex = String(i);

    const typeTag = document.createElement("span");
    typeTag.className = "plan-action-type";
    typeTag.textContent = String(action.type || action.actionType || "ACTION").toUpperCase();

    const nameEl = document.createElement("span");
    nameEl.className = "plan-action-name";
    nameEl.textContent = String(action.name || action.actionName || action.instanceName || "");

    const pathEl = document.createElement("span");
    pathEl.className = "plan-action-path";
    pathEl.textContent = String(action.parentPath || action.targetPath || action.path || "");

    const removeBtn = document.createElement("button");
    removeBtn.className = "plan-action-remove";
    removeBtn.textContent = "\u00d7";
    removeBtn.title = t("planRemoveAction");
    const idx = i;
    removeBtn.addEventListener("click", () => {
      removedIndices.add(idx);
      actionCard.classList.add("plan-action-removed");
      removeBtn.disabled = true;
    });

    actionCard.appendChild(typeTag);
    actionCard.appendChild(nameEl);
    actionCard.appendChild(pathEl);
    actionCard.appendChild(removeBtn);
    if (action.description) {
      const descEl = document.createElement("div");
      descEl.className = "plan-action-desc";
      descEl.textContent = String(action.description);
      actionCard.appendChild(descEl);
    }
    actionList.appendChild(actionCard);
  }
  planPanel.appendChild(actionList);

  const btnRow = document.createElement("div");
  btnRow.className = "plan-preview-buttons";

  const approveBtn = document.createElement("button");
  approveBtn.className = "primary-btn plan-approve-btn";
  approveBtn.textContent = t("planApprove");
  const rejectBtn = document.createElement("button");
  rejectBtn.className = "secondary-btn plan-reject-btn";
  rejectBtn.textContent = t("planReject");

  approveBtn.addEventListener("click", async () => {
    approveBtn.disabled = true;
    rejectBtn.disabled = true;
    try {
      let editedPlan = null;
      if (removedIndices.size > 0) {
        editedPlan = { ...task.pendingPlan };
        editedPlan.actions = actions.filter((_, idx) => !removedIndices.has(idx));
      }
      await window.uxRoaiStudio.approvePlan(task.id, true, editedPlan);
      await refreshTasks();
    } catch (err) {
      showToast(err.message || "Approval failed", "error");
      approveBtn.disabled = false;
      rejectBtn.disabled = false;
    }
  });

  rejectBtn.addEventListener("click", async () => {
    approveBtn.disabled = true;
    rejectBtn.disabled = true;
    try {
      await window.uxRoaiStudio.approvePlan(task.id, false);
      await refreshTasks();
    } catch (err) {
      showToast(err.message || "Rejection failed", "error");
      approveBtn.disabled = false;
      rejectBtn.disabled = false;
    }
  });

  btnRow.appendChild(approveBtn);
  btnRow.appendChild(rejectBtn);
  planPanel.appendChild(btnRow);

  chatChanges.appendChild(planPanel);
}

function renderQuickActions(chatChanges, task, normalizedStatus, result) {
  const quickRow = document.createElement("div");
  quickRow.className = "quick-actions";

  if (normalizedStatus === "failed") {
    const retryBtn = document.createElement("button");
    retryBtn.className = "quick-action-btn retry";
    retryBtn.textContent = t("retryWithFix");
    retryBtn.addEventListener("click", () => {
      const issues = Array.isArray(result?.issues) ? result.issues.map(i => typeof i === "string" ? i : (i.message || JSON.stringify(i))).join("; ") : "";
      const errorCtx = issues || result?.summary || "Previous attempt failed";
      el.promptInput.value = `Fix the previous error and try again.\nOriginal prompt: ${task.prompt || ""}\nError: ${errorCtx}`;
      el.promptInput.focus();
      el.promptInput.dispatchEvent(new Event("input"));
    });
    quickRow.appendChild(retryBtn);
  }

  const undoBtn = document.createElement("button");
  undoBtn.className = "quick-action-btn undo";
  undoBtn.textContent = t("undoLastPlan");
  undoBtn.addEventListener("click", async () => {
    undoBtn.disabled = true;
    try {
      await window.uxRoaiStudio.createTask("__undo__", state.activeProjectId, [], []);
      showToast("Undo command sent", "warning");
      await refreshTasks();
    } catch (err) {
      showToast(err.message || "Undo failed", "error");
    } finally {
      undoBtn.disabled = false;
    }
  });
  quickRow.appendChild(undoBtn);

  const branchBtn = document.createElement("button");
  branchBtn.className = "quick-action-btn branch";
  branchBtn.textContent = t("branchFromHere");
  branchBtn.addEventListener("click", async () => {
    branchBtn.disabled = true;
    try {
      const currentProject = (state.config?.projects || []).find(p => p.id === state.activeProjectId);
      const baseName = currentProject?.name || "Project";
      const branchName = baseName + " (branch)";
      const newConfig = await window.uxRoaiStudio.createProject(branchName);
      const newProject = newConfig?.projects?.[0];
      if (newProject?.id) {
        const allTasks = state.tasks || [];
        const taskIdx = allTasks.findIndex(t2 => t2.id === task.id);
        const branchHistory = taskIdx >= 0 ? allTasks.slice(0, taskIdx + 1) : allTasks;
        const historyToSave = branchHistory.filter(t2 => t2.status === "done" || t2.status === "failed").map(t2 => ({
          id: t2.id, prompt: t2.prompt, status: t2.status,
          createdAt: t2.createdAt, finishedAt: t2.finishedAt,
          result: t2.result,
        }));
        await window.uxRoaiStudio.saveTaskHistory(newProject.id, historyToSave);
        if (currentProject?.folderId) {
          await window.uxRoaiStudio.setProjectFolder(newProject.id, currentProject.folderId);
        }
        state.config = newConfig;
        showToast(t("branchCreated"), "warning");
        await bootstrapConfig();
      }
    } catch (err) {
      showToast(err.message || "Branch failed", "error");
    } finally {
      branchBtn.disabled = false;
    }
  });
  quickRow.appendChild(branchBtn);

  chatChanges.appendChild(quickRow);
}

function formatTaskLogs(task, hasProgress, result) {
  const sections = [];

  // Header: task info
  sections.push(`── Task: ${task.id} ──`);
  sections.push(`Status: ${task.status} | Created: ${task.createdAt || "?"}`);
  if (task.finishedAt) sections.push(`Finished: ${task.finishedAt}`);
  if (task.workerId) sections.push(`Worker: ${task.workerId}`);

  // Usage/token info
  if (task.usage) {
    const u = task.usage;
    sections.push(`\n── Token Usage ──`);
    sections.push(`Input: ${u.inputTokens || 0} | Output: ${u.outputTokens || 0} | Total: ${u.totalTokens || 0}`);
  }

  // Progress timeline
  if (hasProgress && Array.isArray(task.progress) && task.progress.length > 0) {
    sections.push(`\n── Progress (${task.progress.length} entries) ──`);
    for (const p of task.progress) {
      const ts = p.timestamp ? p.timestamp.slice(11, 19) : "";
      const type = (p.type || "info").toUpperCase().padEnd(10);
      let line = `[${ts}] ${type} ${p.message || ""}`;
      if (p.actionType) line += ` [${p.actionType}]`;
      if (p.actionPath) line += ` ${p.actionPath}`;
      sections.push(line);
    }
  }

  // Result
  if (result) {
    sections.push(`\n── Result ──`);
    sections.push(`OK: ${result.ok !== false ? "YES" : "NO"}`);
    if (result.summary) sections.push(`Summary: ${result.summary}`);
    if (result.actionCount) sections.push(`Actions: ${result.actionCount}`);

    // Warnings
    if (Array.isArray(result.warnings) && result.warnings.length > 0) {
      sections.push(`\nWarnings:`);
      for (const w of result.warnings) sections.push(`  - ${w}`);
    }

    // Changes
    if (Array.isArray(result.changes) && result.changes.length > 0) {
      sections.push(`\nChanges (${result.changes.length}):`);
      for (const c of result.changes) {
        sections.push(`  ${c.type || "?"}: ${c.path || c.name || "?"} — ${c.description || ""}`);
      }
    }

    // Plugin logs
    if (Array.isArray(result.logs) && result.logs.length > 0) {
      sections.push(`\n── Plugin Logs (${result.logs.length}) ──`);
      for (const l of result.logs) sections.push(l);
    }

    // Playtest
    if (result.playtestResult) {
      sections.push(`\n── Playtest ──`);
      sections.push(safeJson(result.playtestResult, "parse error"));
    }
  }

  // Raw JSON at the bottom
  sections.push(`\n── Raw JSON ──`);
  sections.push(result ? safeJson(result, "result parse error") : t("waitingStudio"));

  return sections.join("\n");
}

export function renderTasks() {
  const snapshot = state.taskUiSnapshot || captureTaskUiSnapshot();
  state.taskUiSnapshot = null;

  const project = getActiveProject();
  let filteredTasks = state.tasks.filter((task) => String(task.projectId || "default") === String(project.id));
  // Filter by chat if multi-chat is active
  if (state.activeChatId && (project.chats || []).length > 0) {
    filteredTasks = filteredTasks.filter((task) =>
      !task.chatId || task.chatId === state.activeChatId
    );
  }

  el.timeline.innerHTML = "";
  const spacer = document.createElement("div");
  spacer.className = "timeline-spacer";
  el.timeline.appendChild(spacer);

  if (filteredTasks.length === 0) {
    const emptyMsg = document.createElement("div");
    emptyMsg.className = "empty-state";
    emptyMsg.textContent = project.id === "__none__" ? t("emptyState") : t("emptyStateChat");
    el.timeline.appendChild(emptyMsg);
    el.taskFlowText.style.display = "none";
  } else {
    el.taskFlowText.style.display = "";
  }

  for (const task of filteredTasks) {
    if (!task || !task.id) continue;

    const fragment = el.taskCardTemplate.content.cloneNode(true);
    const conversation = fragment.querySelector(".chat-conversation");
    const chatPrompt = fragment.querySelector(".chat-prompt");
    const chatTime = fragment.querySelector(".chat-time");
    const chatStatusLine = fragment.querySelector(".chat-status-line");
    const chatSummary = fragment.querySelector(".chat-summary");
    const chatChanges = fragment.querySelector(".chat-changes");
    const chatPlaytestPanel = fragment.querySelector(".chat-playtest-panel");
    const chatRawLabel = fragment.querySelector(".chat-raw-label");
    const chatRawContent = fragment.querySelector(".chat-raw-content");
    const rawCopyBtn = fragment.querySelector('.copy-btn[data-copy-target="raw"]');

    const result = task.result && typeof task.result === "object" ? task.result : null;
    const normalizedStatus = normalizeTaskStatus(task, result);

    conversation.dataset.taskId = String(task.id);
    chatPrompt.textContent = task.prompt || "";
    chatTime.textContent = toHumanTime(task.createdAt);

    // Edit/Rewind button on user bubble
    wireRewindModal();
    const userBubble = fragment.querySelector(".chat-bubble-user");
    if (userBubble && (normalizedStatus === "done" || normalizedStatus === "failed" || normalizedStatus === "stopped")) {
      const editBtn = document.createElement("button");
      editBtn.className = "chat-edit-btn";
      editBtn.textContent = "\u270E";
      editBtn.title = t("editMessage");
      editBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const accepted = await showRewindModal(task.prompt);
        if (!accepted) return;
        // Truncate timeline: remove all tasks after this one
        const projectId = getActiveProject().id;
        const allProjectTasks = state.tasks.filter(
          (tk) => String(tk.projectId || "default") === String(projectId)
        );
        const taskIdx = allProjectTasks.findIndex(tk => String(tk.id) === String(task.id));
        if (taskIdx >= 0) {
          const toRemove = allProjectTasks.slice(taskIdx);
          for (const tk of toRemove) {
            await window.uxRoaiStudio.deleteTaskHistory(projectId, String(tk.id));
          }
          state.tasks = state.tasks.filter(tk => {
            if (String(tk.projectId || "default") !== String(projectId)) return true;
            return !toRemove.some(r => String(r.id) === String(tk.id));
          });
        }
        // Put the prompt back in composer
        el.promptInput.value = task.prompt || "";
        el.promptInput.style.height = "auto";
        el.promptInput.style.height = Math.min(el.promptInput.scrollHeight, 200) + "px";
        el.promptInput.focus();
        state.lastTasksFingerprint = "";
        renderTasks();
      });
      userBubble.appendChild(editBtn);
    }

    conversation.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const tid = String(task.id);
      const projectId = getActiveProject().id;
      const foundTask = state.tasks.find((tk) => String(tk.id) === tid);
      showContextMenu(e.clientX, e.clientY, [
        {
          label: t("copyPrompt"),
          action: () => {
            const text = foundTask?.prompt || task.prompt || "";
            navigator.clipboard.writeText(text).catch(() => {});
          },
        },
        {
          label: t("copyResponse"),
          action: () => {
            const text = foundTask?.result?.summary || result?.summary || "";
            navigator.clipboard.writeText(text).catch(() => {});
          },
        },
        {
          label: t("rerunTask"),
          action: async () => {
            const prompt = foundTask?.prompt || task.prompt || "";
            if (prompt) {
              try {
                await window.uxRoaiStudio.createTask(prompt, projectId, [], []);
                await refreshTasks();
              } catch (err) {
                showToast(err.message || "Re-run failed", "error");
              }
            }
          },
        },
        {
          label: t("renameChat"),
          action: async () => {
            const oldPrompt = foundTask ? (foundTask.prompt || "") : "";
            const newText = await showPromptModal(t("renameChat"), oldPrompt);
            if (newText) {
              await window.uxRoaiStudio.renameTaskHistory(projectId, tid, newText);
              await refreshTasks();
            }
          },
        },
        {
          label: t("deleteChat"),
          danger: true,
          action: async () => {
            await window.uxRoaiStudio.deleteTaskHistory(projectId, tid);
            state.tasks = state.tasks.filter((tk) => String(tk.id) !== tid);
            renderTasks();
          },
        },
      ]);
    });

    renderTaskStatusLine(chatStatusLine, normalizedStatus, task, result);
    renderTaskTiming(chatStatusLine, normalizedStatus, task);

    if (normalizedStatus === "pending" || normalizedStatus === "running") {
      renderStopButton(chatStatusLine, task);
    }

    const hasProgress = normalizedStatus === "running" && Array.isArray(task.progress) && task.progress.length > 0;
    const hasPendingPlan = task.pendingPlan && !task.planDecision && normalizedStatus === "running";

    if (hasProgress) {
      renderProgressTree(chatChanges, chatSummary, task);
    }

    if (hasPendingPlan) {
      renderPlanPreview(chatChanges, task);
    }

    if (!hasProgress && !hasPendingPlan) {
      chatSummary.textContent = result?.summary || (normalizedStatus === "pending" || normalizedStatus === "running" ? "" : t("noSummary"));
      renderChanges(chatChanges, result?.changes || result?.actions || []);
    }

    renderPlaytest(chatPlaytestPanel, result?.playtestResult || null, normalizedStatus);

    if (normalizedStatus === "done" || normalizedStatus === "failed") {
      renderQuickActions(chatChanges, task, normalizedStatus, result);
    }

    chatRawLabel.textContent = t("rawLogs");
    chatRawContent.textContent = formatTaskLogs(task, hasProgress, result);

    if (rawCopyBtn) {
      rawCopyBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const text = result ? safeJson(result, "") : "";
        copyToClipboard(text, rawCopyBtn);
      });
    }

    el.timeline.appendChild(fragment);
  }

  restoreTaskUiSnapshot(snapshot);

  if (snapshot && snapshot.timelineAtBottom) {
    requestAnimationFrame(() => {
      el.timeline.scrollTop = el.timeline.scrollHeight;
    });
  }
}
