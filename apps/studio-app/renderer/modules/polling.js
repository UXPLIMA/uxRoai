import { state, el } from "./state.js";
import { DEFAULT_MODEL, DEFAULT_CODE_COMMAND, DEFAULT_CODE_ARGS, DEFAULT_CUSTOM_INSTRUCTIONS } from "./constants.js";
import { t, normalizeLanguage, normalizeProvider } from "./i18n.js";
import { showToast } from "./toast.js";
import { buildTasksFingerprint, copyToClipboard, updateLiveTimers } from "./utils.js";
import { renderAgentRuntime, refreshAgentRuntime, setupLogPanel } from "./agent-ui.js";
import { getActiveProject, getActiveChat, updateProjectTitle, renderProjects, renderChats, openProjectModal, closeProjectModal, openSettingsModal, closeSettingsModal, openFolderModal, closeFolderModal, submitCreateFolder, submitCreateProject, showPromptModal, closePromptModal } from "./projects-ui.js";
import { syncModelOptionsFromConfig, syncLanguageOptionsFromConfig, syncProviderOptionsFromConfig, setLanguageValue, setProviderValue, setModelValue, applyProviderUi, applyLanguageToStaticUi, getProviderFamily, syncComposerModelSelect } from "./config-ui.js";
import { renderAttachmentPreview, setupComposerEvents, autoSaveMemoryFromTask, processNextQueuedMessage } from "./composer.js";
import { captureTaskUiSnapshot, renderTasks as renderTasksDom } from "./task-rendering.js";

const CONN_FAIL_THRESHOLD = 3;
const CONN_RETRY_INTERVALS = [5, 10, 15, 30];

function showConnectionErrorModal() {
  if (state.connectionModalShown) return;
  state.connectionModalShown = true;
  if (el.connErrorTitle) el.connErrorTitle.textContent = t("connErrorTitle");
  if (el.connErrorDesc) el.connErrorDesc.textContent = t("connErrorDesc");
  if (el.connErrorRetryBtn) el.connErrorRetryBtn.textContent = t("connErrorRetry");
  if (el.connErrorDismissBtn) el.connErrorDismissBtn.textContent = t("connErrorDismiss");
  if (el.connectionErrorModal) el.connectionErrorModal.classList.remove("hidden");
  startConnectionRetryCountdown();
}

function hideConnectionErrorModal() {
  state.connectionModalShown = false;
  if (state.connectionRetryTimer) {
    clearInterval(state.connectionRetryTimer);
    state.connectionRetryTimer = null;
  }
  if (el.connectionErrorModal) el.connectionErrorModal.classList.add("hidden");
}

function startConnectionRetryCountdown() {
  if (state.connectionRetryTimer) clearInterval(state.connectionRetryTimer);
  const retryIdx = Math.min(state.connectionFailCount - CONN_FAIL_THRESHOLD, CONN_RETRY_INTERVALS.length - 1);
  let secondsLeft = CONN_RETRY_INTERVALS[Math.max(0, retryIdx)];
  if (el.connErrorCountdown) {
    el.connErrorCountdown.textContent = t("connErrorCountdown").replace("{s}", secondsLeft);
  }
  state.connectionRetryTimer = setInterval(async () => {
    secondsLeft--;
    if (secondsLeft <= 0) {
      clearInterval(state.connectionRetryTimer);
      state.connectionRetryTimer = null;
      await attemptReconnect();
    } else if (el.connErrorCountdown) {
      el.connErrorCountdown.textContent = t("connErrorCountdown").replace("{s}", secondsLeft);
    }
  }, 1000);
}

async function attemptReconnect() {
  if (el.connErrorCountdown) el.connErrorCountdown.textContent = "...";
  try {
    const data = await window.uxRoaiStudio.getHealth();
    if (data?.ok) {
      state.connectionFailCount = 0;
      hideConnectionErrorModal();
      el.agentHealth.textContent = t("online");
      el.agentHealth.className = "pill good";
      showToast(t("connErrorReconnected"), "success");
      return;
    }
  } catch { /* still offline */ }
  state.connectionFailCount++;
  startConnectionRetryCountdown();
}

export async function refreshHealth() {
  // Don't show connection error modal if managed agent hasn't been started yet
  const agentRunning = state.agentRuntime && state.agentRuntime.running;

  try {
    const data = await window.uxRoaiStudio.getHealth();
    const ok = Boolean(data?.ok);
    el.agentHealth.textContent = ok ? t("online") : t("offline");
    el.agentHealth.className = `pill ${ok ? "good" : "bad"}`;
    if (ok) {
      if (state.connectionFailCount > 0) {
        state.connectionFailCount = 0;
        hideConnectionErrorModal();
      }
    } else {
      state.connectionFailCount++;
      if (state.connectionFailCount >= CONN_FAIL_THRESHOLD && agentRunning) {
        showConnectionErrorModal();
      }
    }
  } catch {
    el.agentHealth.textContent = t("offline");
    el.agentHealth.className = "pill bad";
    state.connectionFailCount++;
    if (state.connectionFailCount >= CONN_FAIL_THRESHOLD && agentRunning) {
      showConnectionErrorModal();
    }
  }
}

export function mergeTasks(liveTasks, savedTasks) {
  const merged = new Map();
  for (const task of savedTasks) {
    if (task && task.id && task.prompt) {
      merged.set(String(task.id), task);
    }
  }
  for (const task of liveTasks) {
    if (task && task.id && task.prompt) {
      merged.set(String(task.id), task);
    }
  }
  const result = Array.from(merged.values());
  result.sort((a, b) => {
    const timeA = new Date(a.createdAt || 0).getTime();
    const timeB = new Date(b.createdAt || 0).getTime();
    return timeA - timeB;
  });
  return result;
}

export async function saveCurrentProjectHistory() {
  try {
    const project = getActiveProject();
    if (project.id === "__none__") return;
    const projectTasks = state.tasks.filter(
      (task) => String(task.projectId || "default") === String(project.id)
    );
    const finishedTasks = projectTasks.filter(
      (task) => task.status === "done" || task.status === "failed" || task.status === "stopped"
    );
    if (finishedTasks.length > 0) {
      if (state.activeChatId) {
        await window.uxRoaiStudio.saveChatHistory(project.id, state.activeChatId, finishedTasks);
      } else {
        await window.uxRoaiStudio.saveTaskHistory(project.id, finishedTasks);
      }
      for (const task of finishedTasks) {
        if (task.status === "done" && task.result?.summary && !task._memorySaved) {
          task._memorySaved = true;
          await autoSaveMemoryFromTask(task);
        }
      }
    }
  } catch {
    // silent
  }
}

async function loadProjectHistory() {
  try {
    const project = getActiveProject();
    if (project.id === "__none__") return [];
    let saved;
    if (state.activeChatId) {
      saved = await window.uxRoaiStudio.loadChatHistory(project.id, state.activeChatId);
    } else {
      saved = await window.uxRoaiStudio.loadTaskHistory(project.id);
    }
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

// Re-export renderTasks from task-rendering so other modules can import from polling
export function renderTasks() {
  renderTasksDom();
}

// Lightweight update for volatile content (streaming/thinking text)
// Avoids full DOM rebuild — prevents flickering and broken copy operations
function updateVolatileContent(tasks) {
  for (const task of tasks) {
    if (task.status !== "running" || !Array.isArray(task.progress) || task.progress.length === 0) continue;
    const conv = el.timeline.querySelector(`.chat-conversation[data-task-id="${CSS.escape(task.id)}"]`);
    if (!conv) continue;
    const last = [...task.progress].reverse().find(e => e.type === "thinking" || e.type === "streaming");
    if (!last) continue;
    if (last.type === "streaming") {
      const node = conv.querySelector(".streaming-output");
      if (node) node.textContent = String(last.message || "");
    } else {
      const node = conv.querySelector(".thinking-pulse");
      if (node) node.textContent = String(last.message || "");
    }
  }
}

let pollTimer = null;
let sseConnected = false;

export function startPolling(intervalMs) {
  if (pollTimer) clearInterval(pollTimer);
  const effectiveInterval = sseConnected ? Math.max(intervalMs, 8000) : intervalMs;
  state.currentPollInterval = effectiveInterval;
  pollTimer = setInterval(() => {
    refreshAgentRuntime();
    refreshHealth();
    refreshTasks();
  }, effectiveInterval);
}

let sessionReconstructed = false;

export async function refreshTasks() {
  try {
    const data = await window.uxRoaiStudio.listTasks(120);
    const liveTasks = Array.isArray(data?.tasks) ? data.tasks : [];
    const savedTasks = await loadProjectHistory();

    // Session reconstruction: if agent has no tasks but we have saved history,
    // it means the agent was restarted. Saved tasks become the sole source.
    if (liveTasks.length === 0 && savedTasks.length > 0 && !sessionReconstructed) {
      sessionReconstructed = true;
      console.log("[uxRoai] Session reconstructed from saved history (" + savedTasks.length + " tasks)");
    }
    // Reset flag when agent has tasks again
    if (liveTasks.length > 0) {
      sessionReconstructed = false;
    }

    const merged = mergeTasks(liveTasks, savedTasks);

    // Recover orphaned running/pending tasks that disappeared from agent
    // (e.g. agent crashed and restarted, losing in-memory tasks)
    const mergedIds = new Set(merged.map(t2 => t2.id));
    for (const prev of (state.tasks || [])) {
      if ((prev.status === "running" || prev.status === "pending") && !mergedIds.has(prev.id)) {
        // Task was running locally but agent no longer has it — mark as failed
        merged.push({
          ...prev,
          status: "failed",
          finishedAt: new Date().toISOString(),
          result: { ok: false, summary: "Connection to agent lost during task execution.", changes: [], warnings: [] },
        });
      }
    }

    for (const [id, askTask] of state.inflightAskTasks) {
      if (!merged.some((t2) => t2.id === id)) {
        merged.push(askTask);
      }
    }
    merged.sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());

    const fp = buildTasksFingerprint(merged);
    if (fp !== state.lastTasksFingerprint) {
      state.lastTasksFingerprint = fp;
      state.taskUiSnapshot = captureTaskUiSnapshot();
      state.tasks = merged;
      renderTasks();
      renderChats();
      await saveCurrentProjectHistory();
    } else {
      state.tasks = merged;
      // Lightweight update: refresh only volatile content (streaming text, timers)
      // without full DOM rebuild — avoids flickering and broken copy operations
      updateVolatileContent(merged);
    }
    updateLiveTimers();

    const hasRunning = state.tasks.some((t2) => t2.status === "running" || t2.status === "pending");
    const desiredInterval = hasRunning ? 1500 : 3500;
    if (state.currentPollInterval !== desiredInterval) {
      startPolling(desiredInterval);
    }
  } catch (error) {
    console.error(error);
  }
}

export async function bootstrapConfig() {
  state.config = await window.uxRoaiStudio.getConfig();
  state.activeProjectId = state.config.activeProjectId || "default";
  // Restore active chat
  const activeProject = (state.config.projects || []).find(p => p.id === state.activeProjectId);
  state.activeChatId = activeProject?.activeChatId || null;
  state.language = normalizeLanguage(state.config.language);
  syncLanguageOptionsFromConfig(state.config);
  syncProviderOptionsFromConfig(state.config);
  setLanguageValue(state.language);
  setProviderValue(state.config.claudeProvider);
  applyLanguageToStaticUi();
  syncModelOptionsFromConfig(state.config);
  el.agentUrlInput.value = state.config.agentUrl || "";
  el.claudeCodeCommandInput.value = state.config.claudeCodeCommand || DEFAULT_CODE_COMMAND;
  el.claudeCodeArgsInput.value = state.config.claudeCodeArgs || DEFAULT_CODE_ARGS;
  el.claudeApiKeyInput.value = state.config.claudeApiKey || "";
  if (el.codexCommandInput) el.codexCommandInput.value = state.config.codexCommand || "codex";
  if (el.openaiApiKeyInput) el.openaiApiKeyInput.value = state.config.openaiApiKey || "";
  if (el.geminiCommandInput) el.geminiCommandInput.value = state.config.geminiCommand || "gemini";
  if (el.geminiApiKeyInput) el.geminiApiKeyInput.value = state.config.geminiApiKey || "";
  setModelValue(state.config.claudeModel);
  el.maxRetriesInput.value = state.config.maxRetries ?? 10;
  el.minPlaytestSecondsInput.value = state.config.minPlaytestSeconds ?? 10;
  if (el.planTimeoutInput) el.planTimeoutInput.value = state.config.planTimeoutSec ?? 600;
  if (el.claudeCodeTimeoutInput) el.claudeCodeTimeoutInput.value = state.config.claudeCodeTimeoutSec || 90;
  if (el.codexTimeoutInput) el.codexTimeoutInput.value = state.config.codexTimeoutSec || 180;
  if (el.geminiTimeoutInput) el.geminiTimeoutInput.value = state.config.geminiTimeoutSec || 300;
  if (el.customInstructionsInput) {
    el.customInstructionsInput.value = state.config.customInstructions ?? DEFAULT_CUSTOM_INSTRUCTIONS;
  }
  if (el.transparencyToggle) {
    el.transparencyToggle.checked = Boolean(state.config.transparencyEnabled);
  }
  applyProviderUi();
  syncComposerModelSelect(state.config);

  // Restore sidebar collapsed state
  if (state.config.sidebarCollapsed) {
    el.appShell.classList.add("sidebar-collapsed");
  }

  updateProjectTitle();
  renderProjects();
  await refreshAgentRuntime();
  await refreshHealth();
  await refreshTasks();

  // Auto-install/update plugin on startup
  if (window.uxRoaiStudio.installPlugin) {
    window.uxRoaiStudio.installPlugin().catch(() => { /* silent */ });
  }

  // Welcome overlay on first launch
  if (!state.config.welcomeDismissed && el.welcomeOverlay) {
    el.welcomeOverlayTitle.textContent = t("welcomeOverlayTitle");
    el.welcomeOverlayDesc.textContent = t("welcomeOverlayDesc");
    el.welcomeDismissBtn.textContent = t("welcomeOverlayDismiss");
    el.welcomeOverlay.classList.remove("hidden");
    el.welcomeDismissBtn.addEventListener("click", async () => {
      el.welcomeOverlay.classList.add("dismissing");
      setTimeout(() => el.welcomeOverlay.classList.add("hidden"), 400);
      try {
        await window.uxRoaiStudio.setAgentSettings({ welcomeDismissed: true });
      } catch { /* silent */ }
    }, { once: true });
  }
}

async function triggerAutoPlaytest(taskId) {
  if (!state.autoPlaytest) return;
  // Find the completed task
  const completedTask = state.tasks.find(t => t.id === taskId);
  if (!completedTask) return;
  // Only auto-playtest for successful tasks that aren't themselves playtest-only tasks
  if (completedTask.status !== "done") return;
  if (completedTask.prompt && completedTask.prompt.startsWith("/ask ")) return;
  if (completedTask.prompt === "__undo__") return;
  // Check if the task already had a playtest in its result
  const hadPlaytest = completedTask.result?.changes?.some(c => c.type === "run_playtest") ||
    completedTask.result?.actions?.some(c => c.type === "run_playtest");
  if (hadPlaytest) return; // Already had a playtest, no need to auto-run

  // Don't stack auto-playtests
  const hasRunning = state.tasks.some(tk => tk.status === "running" || tk.status === "pending");
  if (hasRunning) return;

  try {
    const prompt = `Run a playtest to verify the changes from the previous task: "${String(completedTask.prompt || "").slice(0, 200)}"`;
    const { buildConversationHistory } = await import("./composer.js");
    const history = buildConversationHistory(4);
    await window.uxRoaiStudio.createTask(prompt, state.activeProjectId, history, []);
    await refreshTasks();
  } catch {
    // silent - don't interrupt user flow
  }
}

export function setupGlobalEvents() {
  // Titlebar window controls
  el.titlebarMinBtn.addEventListener("click", () => window.uxRoaiStudio.minimizeWindow());
  el.titlebarMaxBtn.addEventListener("click", () => window.uxRoaiStudio.maximizeWindow());
  el.titlebarCloseBtn.addEventListener("click", () => window.uxRoaiStudio.closeWindow());

  // Platform detection for macOS titlebar
  window.uxRoaiStudio.getPlatform().then((platform) => {
    document.body.classList.add(`platform-${platform}`);
  });

  // Native blur status for transparency effects
  if (window.uxRoaiStudio.onNativeBlurStatus) {
    window.uxRoaiStudio.onNativeBlurStatus((success) => {
      if (success) document.body.classList.add("native-blur-success");
      else document.body.classList.add("native-blur-fallback");
    });
  }

  // Send button ripple effect
  el.sendPromptBtn.addEventListener("click", (e) => {
    const ripple = document.createElement("span");
    ripple.className = "send-ripple";
    const rect = el.sendPromptBtn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    ripple.style.width = ripple.style.height = size + "px";
    ripple.style.left = (e.clientX - rect.left - size / 2) + "px";
    ripple.style.top = (e.clientY - rect.top - size / 2) + "px";
    el.sendPromptBtn.appendChild(ripple);
    ripple.addEventListener("animationend", () => ripple.remove());
  });

  // Sidebar toggle
  el.sidebarToggleBtn.addEventListener("click", async () => {
    el.appShell.classList.toggle("sidebar-collapsed");
    const collapsed = el.appShell.classList.contains("sidebar-collapsed");
    try {
      await window.uxRoaiStudio.setAgentSettings({ sidebarCollapsed: collapsed });
    } catch { /* silent */ }
  });

  // Auto-playtest toggle
  if (el.autoPlaytestToggle) {
    el.autoPlaytestToggle.checked = state.autoPlaytest;
    el.autoPlaytestToggle.addEventListener("change", () => {
      state.autoPlaytest = el.autoPlaytestToggle.checked;
    });
  }

  // Copy agent logs
  el.copyAgentLogsBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const text = el.agentLogBox.textContent || "";
    copyToClipboard(text, el.copyAgentLogsBtn);
  });

  // Setup diagnostic log panel (tabs, refresh, auto-fetch)
  setupLogPanel();

  // Save settings
  el.saveAgentBtn.addEventListener("click", async () => {
    const agentUrl = String(el.agentUrlInput.value || "").trim();
    const claudeProvider = normalizeProvider(el.claudeProviderInput.value || state.config?.claudeProvider);
    const claudeCodeCommand = String(el.claudeCodeCommandInput.value || "").trim();
    const claudeCodeArgs = String(el.claudeCodeArgsInput.value || "").trim();
    const claudeApiKey = String(el.claudeApiKeyInput.value || "").trim();
    const codexCommand = String(el.codexCommandInput?.value || "").trim();
    const openaiApiKey = String(el.openaiApiKeyInput?.value || "").trim();
    const geminiCommand = String(el.geminiCommandInput?.value || "").trim();
    const geminiApiKey = String(el.geminiApiKeyInput?.value || "").trim();
    const family = getProviderFamily();
    const selectedModel = String(el.claudeModelInput.value || "");
    const claudeModel = family === "claude" ? selectedModel : (state.config?.claudeModel || "claude-sonnet-4-5");
    const codexModel = family === "codex" ? selectedModel : (state.config?.codexModel || "gpt-5.3-codex");
    const geminiModel = family === "gemini" ? selectedModel : (state.config?.geminiModel || "gemini-3-pro-preview");
    const language = normalizeLanguage(el.languageInput.value || state.language);
    const maxRetries = parseInt(el.maxRetriesInput.value, 10) || 10;
    const minPlaytestSeconds = parseInt(el.minPlaytestSecondsInput.value, 10) || 10;
    const planTimeoutSec = parseInt(el.planTimeoutInput?.value, 10) || 600;
    const claudeCodeTimeoutSec = parseInt(el.claudeCodeTimeoutInput?.value, 10) || 90;
    const codexTimeoutSec = parseInt(el.codexTimeoutInput?.value, 10) || 180;
    const geminiTimeoutSec = parseInt(el.geminiTimeoutInput?.value, 10) || 300;
    const customInstructions = el.customInstructionsInput ? el.customInstructionsInput.value : undefined;
    const transparencyEnabled = el.transparencyToggle ? el.transparencyToggle.checked : undefined;
    try {
      state.config = await window.uxRoaiStudio.setAgentSettings({
        agentUrl, claudeProvider, claudeCodeCommand, claudeCodeArgs, claudeApiKey,
        claudeModel, codexCommand, codexModel, openaiApiKey,
        geminiCommand, geminiModel, geminiApiKey,
        language, customInstructions, maxRetries, minPlaytestSeconds, planTimeoutSec,
        claudeCodeTimeoutSec, codexTimeoutSec, geminiTimeoutSec,
        transparencyEnabled,
      });
      state.language = normalizeLanguage(state.config.language);
      syncLanguageOptionsFromConfig(state.config);
      syncProviderOptionsFromConfig(state.config);
      setLanguageValue(state.language);
      setProviderValue(state.config.claudeProvider);
      applyLanguageToStaticUi();
      syncModelOptionsFromConfig(state.config);
      el.agentUrlInput.value = state.config.agentUrl;
      el.claudeCodeCommandInput.value = state.config.claudeCodeCommand || DEFAULT_CODE_COMMAND;
      el.claudeCodeArgsInput.value = state.config.claudeCodeArgs || DEFAULT_CODE_ARGS;
      el.claudeApiKeyInput.value = state.config.claudeApiKey || "";
      if (el.codexCommandInput) el.codexCommandInput.value = state.config.codexCommand || "codex";
      if (el.openaiApiKeyInput) el.openaiApiKeyInput.value = state.config.openaiApiKey || "";
      if (el.geminiCommandInput) el.geminiCommandInput.value = state.config.geminiCommand || "gemini";
      if (el.geminiApiKeyInput) el.geminiApiKeyInput.value = state.config.geminiApiKey || "";
      if (el.claudeCodeTimeoutInput) el.claudeCodeTimeoutInput.value = state.config.claudeCodeTimeoutSec || 90;
      if (el.codexTimeoutInput) el.codexTimeoutInput.value = state.config.codexTimeoutSec || 180;
      if (el.geminiTimeoutInput) el.geminiTimeoutInput.value = state.config.geminiTimeoutSec || 300;
      if (el.customInstructionsInput) el.customInstructionsInput.value = state.config.customInstructions ?? DEFAULT_CUSTOM_INSTRUCTIONS;
      if (el.transparencyToggle) el.transparencyToggle.checked = Boolean(state.config.transparencyEnabled);
      setModelValue(state.config.claudeModel);
      setLanguageValue(state.language);
      setProviderValue(state.config.claudeProvider);
      applyProviderUi();
      syncComposerModelSelect(state.config);
      await refreshAgentRuntime();
      await refreshHealth();
      renderTasks();
    } catch (error) {
      showToast(error.message || t("settingsSaveFailed"), "error");
    }
  });

  // Start/Stop agent
  el.startAgentBtn.addEventListener("click", async () => {
    el.startAgentBtn.disabled = true;
    try {
      state.agentRuntime = await window.uxRoaiStudio.startAgent();
      renderAgentRuntime();
      await refreshHealth();
    } catch (error) {
      showToast(error.message || t("agentStartFailed"), "error");
    } finally {
      await refreshAgentRuntime();
    }
  });

  el.stopAgentBtn.addEventListener("click", async () => {
    el.stopAgentBtn.disabled = true;
    try {
      state.agentRuntime = await window.uxRoaiStudio.stopAgent();
      renderAgentRuntime();
      await refreshHealth();
    } catch (error) {
      showToast(error.message || t("agentStopFailed"), "error");
    } finally {
      await refreshAgentRuntime();
    }
  });

  // Project modal
  el.createProjectBtn.addEventListener("click", () => openProjectModal());
  el.projectCreateConfirmBtn.addEventListener("click", async () => await submitCreateProject());
  el.projectCancelBtn.addEventListener("click", () => closeProjectModal());
  el.projectModalCloseBtn.addEventListener("click", () => closeProjectModal());

  // Settings modal
  el.settingsBtn.addEventListener("click", () => openSettingsModal());
  el.settingsCloseBtn.addEventListener("click", () => closeSettingsModal());

  // Per-project settings
  if (el.saveProjectSettingsBtn) {
    el.saveProjectSettingsBtn.addEventListener("click", async () => {
      const project = getActiveProject();
      if (project.id === "__none__") return;
      try {
        state.config = await window.uxRoaiStudio.setProjectSettings(project.id, {
          apiKey: el.projectApiKeyInput?.value || "",
          customPrompt: el.projectCustomPromptInput?.value || "",
        });
        showToast(t("projectSettingsSaved"), "success");
      } catch (err) {
        showToast(err.message || "Failed", "error");
      }
    });
  }

  // Reset custom instructions
  if (el.resetCustomInstructionsBtn) {
    el.resetCustomInstructionsBtn.addEventListener("click", () => {
      if (el.customInstructionsInput) {
        el.customInstructionsInput.value = DEFAULT_CUSTOM_INSTRUCTIONS;
      }
    });
  }

  // Project name enter
  el.projectNameInput.addEventListener("keydown", async (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      await submitCreateProject();
    }
  });

  // Composer model selector change
  if (el.composerModelSelect) {
    el.composerModelSelect.addEventListener("change", async () => {
      const selectedModel = el.composerModelSelect.value;
      if (!selectedModel) return;
      const family = getProviderFamily();
      const payload = {};
      if (family === "codex") payload.codexModel = selectedModel;
      else if (family === "gemini") payload.geminiModel = selectedModel;
      else payload.claudeModel = selectedModel;
      try {
        state.config = await window.uxRoaiStudio.setAgentSettings(payload);
        setModelValue(state.config.claudeModel);
      } catch { /* silent */ }
    });
  }

  // Provider change
  el.claudeProviderInput.addEventListener("change", () => {
    setProviderValue(el.claudeProviderInput.value || state.config?.claudeProvider);
    applyProviderUi();
  });

  // Language change
  el.languageInput.addEventListener("change", () => {
    state.language = normalizeLanguage(el.languageInput.value || state.language);
    setLanguageValue(state.language);
    applyLanguageToStaticUi();
    syncLanguageOptionsFromConfig(state.config || {});
    syncProviderOptionsFromConfig(state.config || {});
    syncModelOptionsFromConfig(state.config || {});
    setProviderValue(state.config?.claudeProvider || el.claudeProviderInput.value);
    applyProviderUi();
    renderAgentRuntime();
    refreshHealth();
    renderTasks();
  });

  // Modal backdrop clicks
  function attachBackdropClose(modal, closeFn) {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeFn();
    });
  }
  attachBackdropClose(el.projectModal, closeProjectModal);
  attachBackdropClose(el.settingsModal, closeSettingsModal);

  // Create chat
  el.createChatBtn.addEventListener("click", async () => {
    const project = getActiveProject();
    if (project.id === "__none__") return;
    try {
      const chatNum = (project.chats || []).length + 1;
      state.config = await window.uxRoaiStudio.createChat(project.id, `Chat ${chatNum}`);
      const updatedProject = (state.config.projects || []).find(p => p.id === project.id);
      state.activeChatId = updatedProject?.activeChatId || null;
      renderChats();
      await refreshTasks();
    } catch (err) {
      showToast(err.message || "Failed to create chat", "error");
    }
  });

  // Folder modal
  el.createFolderBtn.addEventListener("click", () => openFolderModal());
  el.folderCreateConfirmBtn.addEventListener("click", async () => await submitCreateFolder());
  el.folderCancelBtn.addEventListener("click", () => closeFolderModal());
  el.folderModalCloseBtn.addEventListener("click", () => closeFolderModal());
  el.folderNameInput.addEventListener("keydown", async (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      await submitCreateFolder();
    }
  });
  attachBackdropClose(el.folderModal, closeFolderModal);

  // Prompt modal
  el.promptModalConfirmBtn.addEventListener("click", () => {
    const val = String(el.promptModalInput.value || "").trim();
    closePromptModal(val || null);
  });
  el.promptModalCancelBtn.addEventListener("click", () => closePromptModal(null));
  el.promptModalCloseBtn.addEventListener("click", () => closePromptModal(null));
  el.promptModalInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const val = String(el.promptModalInput.value || "").trim();
      closePromptModal(val || null);
    }
  });
  attachBackdropClose(el.promptModal, () => closePromptModal(null));

  // Connection error modal
  if (el.connErrorRetryBtn) {
    el.connErrorRetryBtn.addEventListener("click", () => attemptReconnect());
  }
  if (el.connErrorDismissBtn) {
    el.connErrorDismissBtn.addEventListener("click", () => hideConnectionErrorModal());
  }
  if (el.connectionErrorModal) {
    el.connectionErrorModal.addEventListener("click", (e) => {
      if (e.target === el.connectionErrorModal) hideConnectionErrorModal();
    });
  }

  // Global keyboard shortcuts
  document.addEventListener("keydown", (event) => {
    const ctrl = event.ctrlKey || event.metaKey;

    if (event.key === "Escape") {
      closeProjectModal();
      closeSettingsModal();
      closeFolderModal();
      closePromptModal(null);
      return;
    }

    if (ctrl && event.key === "Enter") {
      event.preventDefault();
      el.sendPromptBtn.click();
      return;
    }

    if (ctrl && event.key === "n") {
      event.preventDefault();
      openProjectModal();
      return;
    }

    if (ctrl && event.key === ".") {
      event.preventDefault();
      const runningTask = (state.tasks || []).find(
        (tk) => tk.status === "running" || tk.status === "pending"
      );
      if (runningTask) {
        window.uxRoaiStudio.stopTask(runningTask.id).then(() => refreshTasks()).catch(() => {});
      }
      return;
    }

    // Ctrl+T — new project/chat
    if (ctrl && event.key === "t") {
      event.preventDefault();
      openProjectModal();
      return;
    }

    // Ctrl+Shift+S — open settings
    if (ctrl && event.shiftKey && event.key === "S") {
      event.preventDefault();
      openSettingsModal();
      return;
    }

    // Alt+Up / Alt+Down — switch project
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      const projects = state.config?.projects || [];
      if (projects.length <= 1) return;
      const curIdx = projects.findIndex(p => p.id === state.activeProjectId);
      let nextIdx;
      if (event.key === "ArrowUp") {
        nextIdx = curIdx <= 0 ? projects.length - 1 : curIdx - 1;
      } else {
        nextIdx = curIdx >= projects.length - 1 ? 0 : curIdx + 1;
      }
      const next = projects[nextIdx];
      if (next) {
        saveCurrentProjectHistory();
        // Prompt stashing
        const currentPrompt = String(el.promptInput.value || "");
        if (currentPrompt) state.promptStash.set(state.activeProjectId, currentPrompt);
        state.activeProjectId = next.id;
        window.uxRoaiStudio.setActiveProject(next.id).then(cfg => {
          state.config = cfg;
          // Restore activeChatId from the new project
          const activeProject = (cfg.projects || []).find(p => p.id === next.id);
          state.activeChatId = activeProject?.activeChatId || null;
          const stashed = state.promptStash.get(next.id) || "";
          el.promptInput.value = stashed;
          el.promptInput.style.height = "auto";
          updateProjectTitle();
          renderProjects();
          refreshTasks();
        });
      }
      return;
    }
  });

  // SSE event-driven updates
  let sseRefreshTimer = null;
  function scheduleSSERefresh(delayMs) {
    if (sseRefreshTimer) return;
    sseRefreshTimer = setTimeout(() => {
      sseRefreshTimer = null;
      refreshTasks();
    }, delayMs);
  }

  if (window.uxRoaiStudio.onTaskEvent) {
    window.uxRoaiStudio.onTaskEvent((event) => {
      if (!event || !event.type) return;
      sseConnected = true;

      if (event.type === "task_created" || event.type === "task_claimed" ||
          event.type === "task_completed" || event.type === "task_stopped") {
        scheduleSSERefresh(100);
        if (event.type === "task_completed" || event.type === "task_stopped") {
          setTimeout(() => processNextQueuedMessage(), 500);
          // Auto-playtest: if enabled and task was a regular (non-playtest) task
          if (event.type === "task_completed" && state.autoPlaytest) {
            setTimeout(() => triggerAutoPlaytest(event.taskId), 1000);
          }
        }
      } else if (event.type === "task_progress") {
        scheduleSSERefresh(500);
      }

      if (state.currentPollInterval < 8000) {
        startPolling(8000);
      }
    });
  }
}
