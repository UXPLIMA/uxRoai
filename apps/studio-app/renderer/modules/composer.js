import { state, el } from "./state.js";
import { SCRIPT_SVG } from "./constants.js";
import { t } from "./i18n.js";
import { showToast } from "./toast.js";
import { getActiveProject, autoTitleChat } from "./projects-ui.js";
import { refreshTasks, renderTasks } from "./polling.js";

function updateQueueIndicator() {
  if (!el.queueIndicator) return;
  if (state.messageQueue.length > 0) {
    el.queueIndicator.style.display = "flex";
    el.queueIndicator.innerHTML = `<span class="spinner"></span>${state.messageQueue.length} ${t("queuedCount")}`;
  } else {
    el.queueIndicator.style.display = "none";
    el.queueIndicator.innerHTML = "";
  }
}

export async function processNextQueuedMessage() {
  if (state.messageQueue.length === 0) return;
  // Per-chat: find first queued message whose chat has no running tasks
  const idx = state.messageQueue.findIndex(msg => {
    const chatId = msg.chatId || null;
    return !state.tasks.some(tk =>
      (tk.status === "running" || tk.status === "pending") &&
      (chatId ? String(tk.chatId || "") === String(chatId) : true)
    );
  });
  if (idx === -1) return;
  const next = state.messageQueue.splice(idx, 1)[0];
  updateQueueIndicator();
  if (!next) return;
  try {
    const history = buildConversationHistory(8);
    const memory = await loadProjectMemory();
    const historyWithMemory = memory.length > 0
      ? [{ prompt: "[PROJECT MEMORY]", summary: memory.map(m => m.text).join(" | "), status: "memory" }, ...history]
      : history;
    await window.uxRoaiStudio.createTask(next.prompt, state.activeProjectId, historyWithMemory, next.attachments || []);
    await refreshTasks();
  } catch (err) {
    showToast(err.message || t("taskSendFailed"), "error");
  }
}

export function buildConversationHistory(maxMessages = 8) {
  const project = getActiveProject();
  const projectTasks = state.tasks.filter(
    (task) => String(task.projectId || "default") === String(project.id)
  );
  const finished = projectTasks.filter(
    (task) => task.status === "done" || task.status === "failed" || task.status === "stopped"
  );
  return finished.slice(-maxMessages).map((task) => {
    const entry = {
      prompt: String(task.prompt || "").slice(0, 500),
      summary: String(task.result?.summary || "").slice(0, 300),
      status: String(task.status || "unknown"),
    };
    // Include action count and change types for richer context
    if (task.result?.actionCount) entry.actionCount = task.result.actionCount;
    if (Array.isArray(task.result?.changes) && task.result.changes.length > 0) {
      entry.changeTypes = task.result.changes
        .map(c => c.type).filter(Boolean).slice(0, 10).join(", ");
      // Include script paths so AI knows exactly which scripts were created/modified
      const scriptChanges = task.result.changes
        .filter(c => c.type === "upsert_script" || c.type === "edit_script")
        .map(c => c.scriptPath || c.path || "")
        .filter(Boolean)
        .slice(0, 8);
      if (scriptChanges.length > 0) entry.scriptPaths = scriptChanges;
      // Include instance paths for create/delete actions
      const instanceChanges = task.result.changes
        .filter(c => c.type === "create_instance" || c.type === "delete_instance" || c.type === "mass_create")
        .map(c => c.path || c.name || "")
        .filter(Boolean)
        .slice(0, 8);
      if (instanceChanges.length > 0) entry.instancePaths = instanceChanges;
    }
    return entry;
  });
}

export async function loadProjectMemory() {
  try {
    const project = getActiveProject();
    if (project.id === "__none__") return [];
    return await window.uxRoaiStudio.loadMemory(project.id);
  } catch {
    return [];
  }
}

export async function autoSaveMemoryFromTask(task) {
  if (!task || task.status !== "done" || !task.result?.summary) return;
  const project = getActiveProject();
  if (project.id === "__none__") return;
  try {
    const text = `Task: "${String(task.prompt || "").slice(0, 200)}" -> ${String(task.result.summary).slice(0, 250)}`;
    await window.uxRoaiStudio.addMemory(project.id, { text, source: "auto" });
  } catch {
    // silent
  }
}

export function renderAttachmentPreview() {
  el.imagePreviewBar.innerHTML = "";
  if (state.pendingAttachments.length === 0) {
    el.imagePreviewBar.style.display = "none";
    return;
  }
  el.imagePreviewBar.style.display = "flex";
  for (const att of state.pendingAttachments) {
    const wrapper = document.createElement("div");
    wrapper.className = "image-preview-item" + (att.type === "text" ? " text-file" : "");

    if (att.type === "text") {
      const icon = document.createElement("span");
      icon.className = "file-icon";
      icon.innerHTML = SCRIPT_SVG;
      const nameEl = document.createElement("span");
      nameEl.className = "file-name";
      nameEl.textContent = att.originalName;
      wrapper.appendChild(icon);
      wrapper.appendChild(nameEl);
    } else {
      const imgEl = document.createElement("img");
      imgEl.src = `file://${att.path}`;
      imgEl.alt = att.originalName;
      wrapper.appendChild(imgEl);
    }

    const removeBtn = document.createElement("button");
    removeBtn.className = "image-preview-remove";
    removeBtn.textContent = "x";
    removeBtn.title = t("removeImage");
    removeBtn.addEventListener("click", () => {
      state.pendingAttachments = state.pendingAttachments.filter((a) => a.id !== att.id);
      renderAttachmentPreview();
    });

    wrapper.appendChild(removeBtn);
    el.imagePreviewBar.appendChild(wrapper);
  }
}

const ALLOWED_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "txt", "md", "js", "lua", "json", "csv", "log"]);

export function setupComposerEvents() {
  // Attach button
  el.attachImageBtn.addEventListener("click", async () => {
    try {
      const attachments = await window.uxRoaiStudio.pickImages();
      if (attachments.length > 0) {
        state.pendingAttachments = [...state.pendingAttachments, ...attachments];
        renderAttachmentPreview();
      }
    } catch (err) {
      console.error("Attachment pick error:", err);
    }
  });

  // Auto-resize textarea
  function autoResizeTextarea() {
    el.promptInput.style.height = "auto";
    el.promptInput.style.height = Math.min(el.promptInput.scrollHeight, 200) + "px";
  }
  el.promptInput.addEventListener("input", autoResizeTextarea);

  // Enter to send
  el.promptInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      el.sendPromptBtn.click();
    }
  });

  // Clipboard paste
  el.promptInput.addEventListener("paste", async (event) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        event.preventDefault();
        const blob = item.getAsFile();
        if (!blob) continue;
        const buffer = await blob.arrayBuffer();
        const ext = blob.type.split("/")[1] || "png";
        const name = `paste_${Date.now()}.${ext}`;
        try {
          const attachment = await window.uxRoaiStudio.saveAttachmentFromBuffer(new Uint8Array(buffer), name);
          state.pendingAttachments.push(attachment);
          renderAttachmentPreview();
        } catch (err) {
          console.error("Paste save error:", err);
        }
        return;
      }
    }
  });

  // Drag-and-drop on composer
  el.composerSection.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    el.composerSection.classList.add("drop-active");
  });
  el.composerSection.addEventListener("dragenter", (e) => {
    e.preventDefault();
    el.composerSection.classList.add("drop-active");
  });
  el.composerSection.addEventListener("dragleave", (e) => {
    if (!el.composerSection.contains(e.relatedTarget)) {
      el.composerSection.classList.remove("drop-active");
    }
  });
  el.composerSection.addEventListener("drop", async (e) => {
    e.preventDefault();
    el.composerSection.classList.remove("drop-active");
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    for (const file of files) {
      const dot = file.name.lastIndexOf(".");
      const ext = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : "";
      if (!ALLOWED_EXTS.has(ext)) continue;
      if (file.path) {
        try {
          const attachment = await window.uxRoaiStudio.saveAttachmentFromPath(file.path);
          state.pendingAttachments.push(attachment);
        } catch (err) {
          console.error("Drop save error:", err);
        }
      }
    }
    renderAttachmentPreview();
  });

  async function handleAskMode(question) {
    const projectId = state.activeProjectId || "default";
    const askId = "ask_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
    const placeholderTask = {
      id: askId,
      prompt: question,
      projectId,
      status: "running",
      createdAt: new Date().toISOString(),
      progress: [{ type: "thinking", message: t("processing") }],
      result: null,
    };
    state.inflightAskTasks.set(askId, placeholderTask);
    state.tasks.push(placeholderTask);
    state.lastTasksFingerprint = "";
    renderTasks();

    const askHistory = buildConversationHistory(10);
    let fakeTask;
    try {
      const result = await window.uxRoaiStudio.askQuestion(question, askHistory);
      fakeTask = {
        id: askId, prompt: question, projectId, status: "done",
        createdAt: placeholderTask.createdAt, finishedAt: new Date().toISOString(),
        result: { ok: true, summary: result?.answer || "No response", changes: [], warnings: [], actionCount: 0 },
      };
    } catch (askErr) {
      fakeTask = {
        id: askId, prompt: question, projectId, status: "failed",
        createdAt: placeholderTask.createdAt, finishedAt: new Date().toISOString(),
        result: { ok: false, summary: askErr.message || "Ask failed", changes: [], warnings: [], actionCount: 0 },
      };
    }
    state.inflightAskTasks.delete(askId);
    const idx = state.tasks.findIndex((t2) => t2.id === askId);
    if (idx >= 0) state.tasks[idx] = fakeTask;
    else state.tasks.push(fakeTask);
    // Save to the correct history (chat-aware)
    if (state.activeChatId) {
      const existingHistory = await window.uxRoaiStudio.loadChatHistory(projectId, state.activeChatId);
      const tasks = Array.isArray(existingHistory) ? existingHistory : [];
      tasks.push(fakeTask);
      await window.uxRoaiStudio.saveChatHistory(projectId, state.activeChatId, tasks);
    } else {
      const existingHistory = await window.uxRoaiStudio.loadTaskHistory(projectId);
      const tasks = Array.isArray(existingHistory) ? existingHistory : [];
      tasks.push(fakeTask);
      await window.uxRoaiStudio.saveTaskHistory(projectId, tasks);
    }
    state.lastTasksFingerprint = "";
    renderTasks();
  }

  async function handleTaskMode(prompt) {
    // Per-chat processing: only check for running tasks in the current chat
    const currentChatId = state.activeChatId || null;
    const hasRunning = state.tasks.some(tk =>
      (tk.status === "running" || tk.status === "pending") &&
      String(tk.projectId || "default") === String(state.activeProjectId) &&
      (currentChatId ? String(tk.chatId || "") === String(currentChatId) : true)
    );
    if (hasRunning) {
      // Queue the message
      const attachmentData = state.pendingAttachments.map(a => ({
        id: a.id, originalName: a.originalName, path: a.path, type: a.type, ext: a.ext,
      }));
      state.messageQueue.push({ prompt, attachments: attachmentData, chatId: currentChatId, queuedAt: new Date().toISOString() });
      updateQueueIndicator();
      return;
    }
    const history = buildConversationHistory(8);
    const memory = await loadProjectMemory();
    const attachmentData = state.pendingAttachments.map(a => ({
      id: a.id, originalName: a.originalName, path: a.path, type: a.type, ext: a.ext,
    }));
    const historyWithMemory = memory.length > 0
      ? [{ prompt: "[PROJECT MEMORY]", summary: memory.map(m => m.text).join(" | "), status: "memory" }, ...history]
      : history;
    await window.uxRoaiStudio.createTask(prompt, state.activeProjectId, historyWithMemory, attachmentData);
    autoTitleChat(prompt);
    await refreshTasks();
  }

  // Send button
  el.sendPromptBtn.addEventListener("click", async () => {
    const prompt = String(el.promptInput.value || "").trim();
    if (!prompt) return;

    el.sendPromptBtn.disabled = true;
    try {
      const isAskMode = prompt.startsWith("/ask ");
      if (isAskMode) {
        const question = prompt.slice(5).trim();
        if (!question) {
          showToast("Question cannot be empty", "warning");
          return;
        }
        el.promptInput.value = "";
        el.promptInput.style.height = "auto";
        state.pendingAttachments = [];
        renderAttachmentPreview();
        await handleAskMode(question);
        return;
      }

      await handleTaskMode(prompt);
      el.promptInput.value = "";
      el.promptInput.style.height = "auto";
      state.pendingAttachments = [];
      renderAttachmentPreview();
    } catch (error) {
      const msg = error.message || "";
      if (msg.includes("offline") || msg.includes("unreachable") || msg.includes("ECONNREFUSED") || msg.includes("not found") || msg.includes("timeout")) {
        showToast(t("agentOfflineError"), "error");
      } else {
        showToast(msg || t("taskSendFailed"), "error");
      }
    } finally {
      el.sendPromptBtn.disabled = false;
    }
  });
}
