import { state, el } from "./state.js";
import { t } from "./i18n.js";
import { showToast } from "./toast.js";
import { showContextMenu } from "./context-menu.js";
import { refreshTasks, renderTasks, saveCurrentProjectHistory } from "./polling.js";

// ── Chat Management ─────────────────────────────────────────

export function getActiveChat() {
  const project = getActiveProject();
  const chats = project.chats || [];
  if (chats.length === 0) return null;
  return chats.find(c => c.id === (project.activeChatId || state.activeChatId)) || chats[0] || null;
}

export function renderChats() {
  const project = getActiveProject();
  const chats = project.chats || [];

  if (chats.length === 0) {
    el.chatSection.style.display = "none";
    state.activeChatId = null;
    return;
  }

  el.chatSection.style.display = "";
  el.chatList.innerHTML = "";

  const activeChat = getActiveChat();
  state.activeChatId = activeChat ? activeChat.id : null;

  for (const chat of chats) {
    const btn = document.createElement("button");
    btn.className = `chat-item${chat.id === state.activeChatId ? " active" : ""}`;

    // Top row: icon + title + optional spinner
    const row = document.createElement("div");
    row.className = "chat-item-row";

    const icon = document.createElement("span");
    icon.className = "chat-item-icon";
    icon.textContent = "#";

    const title = document.createElement("span");
    title.className = "chat-item-title";
    title.textContent = chat.title || "Chat";

    row.appendChild(icon);
    row.appendChild(title);

    // Per-chat spinner: show if this chat has running/pending tasks
    const chatHasRunning = state.tasks.some(tk =>
      (tk.status === "running" || tk.status === "pending") &&
      String(tk.projectId || "default") === String(project.id) &&
      String(tk.chatId || "") === String(chat.id)
    );
    if (chatHasRunning) {
      const spinner = document.createElement("span");
      spinner.className = "chat-item-spinner";
      row.appendChild(spinner);
    }

    btn.appendChild(row);

    // Chat preview: last message from this chat
    const lastTask = [...state.tasks]
      .filter(tk =>
        String(tk.projectId || "default") === String(project.id) &&
        String(tk.chatId || "") === String(chat.id) &&
        tk.prompt
      )
      .pop();
    if (lastTask) {
      const preview = document.createElement("div");
      preview.className = "chat-item-preview";
      preview.textContent = String(lastTask.prompt || "").slice(0, 60);
      btn.appendChild(preview);
    }

    btn.addEventListener("click", async () => {
      if (chat.id === state.activeChatId) return;
      await saveCurrentProjectHistory();
      // Prompt stashing
      const currentPrompt = String(el.promptInput.value || "");
      const stashKey = `${state.activeProjectId}_${state.activeChatId}`;
      if (currentPrompt) state.promptStash.set(stashKey, currentPrompt);
      state.activeChatId = chat.id;
      state.config = await window.uxRoaiStudio.setActiveChat(project.id, chat.id);
      const restoreKey = `${state.activeProjectId}_${chat.id}`;
      el.promptInput.value = state.promptStash.get(restoreKey) || "";
      el.promptInput.style.height = "auto";
      renderChats();
      await refreshTasks();
    });

    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e.clientX, e.clientY, [
        {
          label: t("renameChat"),
          action: async () => {
            const newTitle = await showPromptModal(t("renameChat"), chat.title);
            if (newTitle) {
              state.config = await window.uxRoaiStudio.renameChat(project.id, chat.id, newTitle);
              renderChats();
            }
          },
        },
        {
          label: t("deleteChat"),
          danger: true,
          action: async () => {
            state.config = await window.uxRoaiStudio.deleteChat(project.id, chat.id);
            const updatedProject = (state.config?.projects || []).find(p => p.id === project.id);
            state.activeChatId = updatedProject?.activeChatId || null;
            renderChats();
            await refreshTasks();
          },
        },
      ]);
    });

    el.chatList.appendChild(btn);
  }
}

// Auto-title: set chat title from first message if still default "Chat N"
export async function autoTitleChat(prompt) {
  const project = getActiveProject();
  if (!state.activeChatId || project.id === "__none__") return;
  const chat = (project.chats || []).find(c => c.id === state.activeChatId);
  if (!chat) return;
  // Only auto-title if the current title looks like a default "Chat N"
  if (!/^Chat \d+$/i.test(chat.title || "")) return;
  const title = String(prompt || "").slice(0, 40).replace(/\n/g, " ").trim();
  if (!title) return;
  try {
    state.config = await window.uxRoaiStudio.renameChat(project.id, chat.id, title);
    renderChats();
  } catch { /* silent */ }
}

export function getActiveProject() {
  const projects = state.config?.projects || [];
  return projects.find((item) => item.id === state.activeProjectId) || projects[0] || { id: "__none__", name: "uxRoai" };
}

export function updateProjectTitle() {
  const project = getActiveProject();
  el.projectTitle.textContent = project.name;
}

export function openModal(modalEl) {
  if (!modalEl) return;
  modalEl.classList.remove("hidden");
}

export function closeModal(modalEl) {
  if (!modalEl) return;
  modalEl.classList.add("hidden");
}

export function openProjectModal() {
  el.projectNameInput.value = "";
  openModal(el.projectModal);
  setTimeout(() => el.projectNameInput.focus(), 0);
}

export function closeProjectModal() {
  closeModal(el.projectModal);
}

export function openSettingsModal() {
  // Load per-project settings into fields
  const project = getActiveProject();
  if (el.projectApiKeyInput) el.projectApiKeyInput.value = project.apiKey || "";
  if (el.projectCustomPromptInput) el.projectCustomPromptInput.value = project.customPrompt || "";
  openModal(el.settingsModal);
}

export function closeSettingsModal() {
  closeModal(el.settingsModal);
}

export function openFolderModal() {
  el.folderNameInput.value = "";
  openModal(el.folderModal);
  setTimeout(() => el.folderNameInput.focus(), 0);
}

export function closeFolderModal() {
  closeModal(el.folderModal);
}

let _promptResolve = null;

export function showPromptModal(title, defaultValue) {
  return new Promise((resolve) => {
    _promptResolve = resolve;
    el.promptModalTitleText.textContent = title;
    el.promptModalInput.value = defaultValue || "";
    openModal(el.promptModal);
    setTimeout(() => el.promptModalInput.focus(), 0);
  });
}

export function closePromptModal(value) {
  if (el.promptModal.classList.contains("hidden")) return;
  closeModal(el.promptModal);
  const resolve = _promptResolve;
  _promptResolve = null;
  if (resolve) resolve(value);
}

export async function submitCreateFolder() {
  const name = String(el.folderNameInput.value || "").trim();
  if (!name) return;
  try {
    state.config = await window.uxRoaiStudio.createFolder(name);
    renderProjects();
    closeFolderModal();
  } catch (error) {
    showToast(error.message || t("folderCreateFailed"), "error");
  }
}

export async function submitCreateProject() {
  const name = String(el.projectNameInput.value || "").trim();
  if (!name) return;
  try {
    state.config = await window.uxRoaiStudio.createProject(name);
    state.activeProjectId = state.config.activeProjectId;
    updateProjectTitle();
    renderProjects();
    renderTasks();
    closeProjectModal();
  } catch (error) {
    showToast(error.message || t("projectCreateFailed"), "error");
  }
}

function buildProjectButton(project) {
  const button = document.createElement("button");
  button.className = `project-item ${project.id === state.activeProjectId ? "active" : ""}`;
  button.draggable = true;
  button.dataset.projectId = project.id;

  const nameSpan = document.createElement("span");
  nameSpan.className = "project-item-name";
  nameSpan.textContent = project.name;
  button.appendChild(nameSpan);

  // Inline rename on double-click
  nameSpan.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    const input = document.createElement("input");
    input.className = "project-item-rename";
    input.value = project.name;
    nameSpan.replaceWith(input);
    input.focus();
    input.select();
    const finishRename = async () => {
      const newName = String(input.value || "").trim();
      if (newName && newName !== project.name) {
        state.config = await window.uxRoaiStudio.renameProject(project.id, newName);
      }
      renderProjects();
    };
    input.addEventListener("blur", finishRename, { once: true });
    input.addEventListener("keydown", (ke) => {
      if (ke.key === "Enter") { ke.preventDefault(); input.blur(); }
      if (ke.key === "Escape") { input.value = project.name; input.blur(); }
    });
  });
  button.addEventListener("click", async () => {
    await saveCurrentProjectHistory();
    // Prompt stashing: save current text, restore target's
    const currentPrompt = String(el.promptInput.value || "");
    if (currentPrompt) state.promptStash.set(state.activeProjectId, currentPrompt);
    state.activeProjectId = project.id;
    state.config = await window.uxRoaiStudio.setActiveProject(project.id);
    const stashed = state.promptStash.get(project.id) || "";
    el.promptInput.value = stashed;
    el.promptInput.style.height = "auto";
    if (stashed) {
      el.promptInput.style.height = Math.min(el.promptInput.scrollHeight, 200) + "px";
    }
    updateProjectTitle();
    renderProjects();
    await refreshTasks();
  });
  button.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", project.id);
    e.dataTransfer.effectAllowed = "move";
  });
  button.addEventListener("mousedown", (e) => {
    if (e.button === 2) {
      button.draggable = false;
      setTimeout(() => { button.draggable = true; }, 100);
    }
  });
  button.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, [
      {
        label: t("renameChat"),
        action: async () => {
          const newText = await showPromptModal(t("renameChat"), project.name);
          if (newText) {
            state.config = await window.uxRoaiStudio.renameProject(project.id, newText);
            renderProjects();
          }
        },
      },
      {
        label: t("duplicateProject"),
        action: async () => {
          try {
            state.config = await window.uxRoaiStudio.createProject(project.name + " (copy)");
            const newProj = state.config.projects[0];
            if (newProj) {
              const history = await window.uxRoaiStudio.loadTaskHistory(project.id);
              if (Array.isArray(history) && history.length > 0) {
                await window.uxRoaiStudio.saveTaskHistory(newProj.id, history);
              }
              if (project.folderId) {
                state.config = await window.uxRoaiStudio.setProjectFolder(newProj.id, project.folderId);
              }
            }
            renderProjects();
          } catch (err) {
            showToast(err.message || "Duplicate failed", "error");
          }
        },
      },
      {
        label: t("clearHistory"),
        danger: true,
        action: async () => {
          try {
            await window.uxRoaiStudio.saveTaskHistory(project.id, []);
            state.tasks = state.tasks.filter(
              (tk) => String(tk.projectId || "default") !== String(project.id)
            );
            renderTasks();
          } catch (err) {
            showToast(err.message || "Clear failed", "error");
          }
        },
      },
      {
        label: t("deleteChat"),
        danger: true,
        action: async () => {
          state.config = await window.uxRoaiStudio.deleteProject(project.id);
          state.tasks = state.tasks.filter(
            (tk) => String(tk.projectId || "default") !== String(project.id)
          );
          const remaining = state.config?.projects || [];
          state.activeProjectId = remaining.length > 0 ? remaining[0].id : "default";
          state.config = await window.uxRoaiStudio.setActiveProject(state.activeProjectId);
          updateProjectTitle();
          renderProjects();
          renderTasks();
        },
      },
    ]);
  });
  return button;
}

export function renderProjects() {
  const projects = state.config?.projects || [];
  const folders = state.config?.folders || [];
  el.projectList.innerHTML = "";

  const folderMap = new Map();
  const ungrouped = [];
  for (const project of projects) {
    const fid = project.folderId || null;
    if (fid && folders.some((f) => f.id === fid)) {
      if (!folderMap.has(fid)) folderMap.set(fid, []);
      folderMap.get(fid).push(project);
    } else {
      ungrouped.push(project);
    }
  }

  for (const folder of folders) {
    const folderEl = document.createElement("details");
    folderEl.className = "folder-group";
    folderEl.open = true;

    const summary = document.createElement("summary");
    summary.className = "folder-header";
    summary.draggable = true;
    summary.dataset.folderId = folder.id;

    summary.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("application/x-folder-id", folder.id);
      e.dataTransfer.effectAllowed = "move";
    });
    summary.addEventListener("mousedown", (e) => {
      if (e.button === 2) {
        summary.draggable = false;
        setTimeout(() => { summary.draggable = true; }, 100);
      }
    });
    summary.addEventListener("dragover", (e) => {
      if (e.dataTransfer.types.includes("application/x-folder-id")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        summary.classList.add("drag-over");
      }
    });
    summary.addEventListener("dragleave", () => {
      summary.classList.remove("drag-over");
    });
    summary.addEventListener("drop", async (e) => {
      e.preventDefault();
      summary.classList.remove("drag-over");
      const draggedFolderId = e.dataTransfer.getData("application/x-folder-id");
      if (draggedFolderId && draggedFolderId !== folder.id) {
        const targetIndex = folders.findIndex((f) => f.id === folder.id);
        state.config = await window.uxRoaiStudio.reorderFolder(draggedFolderId, targetIndex);
        renderProjects();
      }
    });

    const nameSpan = document.createElement("span");
    nameSpan.className = "folder-name";
    nameSpan.textContent = folder.name;
    summary.appendChild(nameSpan);
    folderEl.appendChild(summary);

    summary.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e.clientX, e.clientY, [
        {
          label: t("renameChat"),
          action: async () => {
            const newName = await showPromptModal(t("renameChat"), folder.name);
            if (newName) {
              state.config = await window.uxRoaiStudio.renameFolder(folder.id, newName);
              renderProjects();
            }
          },
        },
        {
          label: t("deleteFolder"),
          danger: true,
          action: async () => {
            state.config = await window.uxRoaiStudio.deleteFolder(folder.id);
            renderProjects();
          },
        },
      ]);
    });

    const folderBody = document.createElement("div");
    folderBody.className = "folder-body";
    folderBody.dataset.folderId = folder.id;

    folderBody.addEventListener("dragover", (e) => {
      if (e.dataTransfer.types.includes("application/x-folder-id")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      folderBody.classList.add("drag-over");
    });
    folderBody.addEventListener("dragleave", () => {
      folderBody.classList.remove("drag-over");
    });
    folderBody.addEventListener("drop", async (e) => {
      if (e.dataTransfer.types.includes("application/x-folder-id")) return;
      e.preventDefault();
      folderBody.classList.remove("drag-over");
      const projectId = e.dataTransfer.getData("text/plain");
      if (projectId) {
        state.config = await window.uxRoaiStudio.setProjectFolder(projectId, folder.id);
        renderProjects();
      }
    });

    const folderProjects = folderMap.get(folder.id) || [];
    for (const project of folderProjects) {
      folderBody.appendChild(buildProjectButton(project));
    }
    folderEl.appendChild(folderBody);
    el.projectList.appendChild(folderEl);
  }

  const ungroupedZone = document.createElement("div");
  ungroupedZone.className = "ungrouped-zone";
  ungroupedZone.dataset.folderId = "";
  ungroupedZone.addEventListener("dragover", (e) => {
    if (e.dataTransfer.types.includes("application/x-folder-id")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    ungroupedZone.classList.add("drag-over");
  });
  ungroupedZone.addEventListener("dragleave", () => {
    ungroupedZone.classList.remove("drag-over");
  });
  ungroupedZone.addEventListener("drop", async (e) => {
    if (e.dataTransfer.types.includes("application/x-folder-id")) return;
    e.preventDefault();
    ungroupedZone.classList.remove("drag-over");
    const projectId = e.dataTransfer.getData("text/plain");
    if (projectId) {
      state.config = await window.uxRoaiStudio.setProjectFolder(projectId, null);
      renderProjects();
    }
  });

  for (const project of ungrouped) {
    ungroupedZone.appendChild(buildProjectButton(project));
  }
  el.projectList.appendChild(ungroupedZone);
  renderChats();
}
