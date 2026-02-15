import { state, el } from "./state.js";
import { t } from "./i18n.js";
import { toHumanTime } from "./utils.js";

export function renderAgentRuntime() {
  const runtime = state.agentRuntime;
  if (!runtime) {
    el.agentRuntimeText.textContent = t("managedUnknown");
    el.startAgentBtn.disabled = false;
    el.stopAgentBtn.disabled = true;
    el.agentLogBox.textContent = "";
    return;
  }

  const running = Boolean(runtime.running);
  const pidText = running && runtime.pid ? ` (pid ${runtime.pid})` : "";
  const startedText = runtime.startedAt ? ` | ${t("startedAt")} ${toHumanTime(runtime.startedAt)}` : "";
  const errorText = runtime.lastError ? ` | ${t("runtimeError")}: ${runtime.lastError}` : "";
  el.agentRuntimeText.textContent = `${t("managedPrefix")}: ${running ? t("managedRunning") : t("managedStopped")}${pidText}${startedText}${errorText}`;
  el.startAgentBtn.disabled = running;
  el.stopAgentBtn.disabled = !running;

  // Merge agent process logs + diagnostic logs
  renderLogPanel();
}

export async function refreshAgentRuntime() {
  try {
    state.agentRuntime = await window.uxRoaiStudio.getAgentStatus();
  } catch {
    state.agentRuntime = null;
  }
  renderAgentRuntime();
}

export async function fetchDiagnosticLogs() {
  try {
    const data = await window.uxRoaiStudio.fetchDiagLogs(null, 500);
    if (data?.ok) {
      state.diagLogs = data.logs || [];
      state.lastDiagnostics = data.diagnostics || null;
    }
  } catch {
    // agent might be offline
  }
  renderLogPanel();
}

function formatDiagBar() {
  const diag = state.lastDiagnostics;
  if (!diag) return "<span class=\"diag-warn\">No diagnostics — agent offline?</span>";
  const configured = diag.configured
    ? "<span class=\"diag-ok\">YES</span>"
    : "<span class=\"diag-warn\">NO</span>";
  const apiKey = diag.apiKeySet === null ? "N/A"
    : diag.apiKeySet ? "<span class=\"diag-ok\">SET</span>"
    : "<span class=\"diag-warn\">MISSING</span>";
  return [
    `<span class="diag-label">Provider:</span> ${diag.provider}`,
    `<span class="diag-label">Model:</span> ${diag.model}`,
    `<span class="diag-label">Timeout:</span> ${(diag.timeoutMs / 1000).toFixed(0)}s`,
    `<span class="diag-label">Configured:</span> ${configured}`,
    `<span class="diag-label">API Key:</span> ${apiKey}`,
  ].join("  |  ");
}

function renderLogPanel() {
  // Diagnostics bar
  if (el.logDiagBar) {
    el.logDiagBar.innerHTML = formatDiagBar();
  }

  // Merge agent process logs and diagnostic logs
  const filter = state.diagLogFilter || "all";
  const lines = [];

  // Add diagnostic logs (structured)
  for (const entry of state.diagLogs) {
    if (filter !== "all" && entry.cat !== filter) continue;
    const ts = entry.ts ? entry.ts.slice(11, 19) : "??:??:??";
    const level = (entry.level || "info").toUpperCase().padEnd(5);
    const cat = (entry.cat || "?").toUpperCase().padEnd(8);
    const meta = entry.meta ? "  " + JSON.stringify(entry.meta) : "";
    const levelClass = entry.level === "error" ? "log-line-error"
      : entry.level === "warn" ? "log-line-warn"
      : entry.level === "debug" ? "log-line-debug"
      : "log-line-info";
    lines.push(`<span class="log-line-ts">[${ts}]</span> <span class="${levelClass}">${level}</span> <span class="log-line-cat">[${cat}]</span> ${escapeHtml(entry.msg)}${meta ? `<span class="log-line-debug">${escapeHtml(meta)}</span>` : ""}`);
  }

  // Add agent process logs (unstructured) if "all" or "agent" filter
  if (filter === "all" || filter === "agent") {
    const agentLogs = state.agentRuntime?.logs || [];
    for (const line of agentLogs) {
      const isError = /\[stderr\]|error/i.test(line);
      const cls = isError ? "log-line-error" : "log-line-info";
      lines.push(`<span class="${cls}">${escapeHtml(line)}</span>`);
    }
  }

  if (lines.length === 0) {
    el.agentLogBox.innerHTML = "<span class=\"log-line-debug\">No logs yet. Submit a task to generate diagnostic logs.</span>";
  } else {
    el.agentLogBox.innerHTML = lines.join("\n");
  }

  // Auto-scroll to bottom
  el.agentLogBox.scrollTop = el.agentLogBox.scrollHeight;
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function setupLogPanel() {
  // Tab clicks
  const tabs = document.querySelectorAll(".log-tab[data-log-tab]");
  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      state.diagLogFilter = tab.dataset.logTab || "all";
      for (const t of tabs) t.classList.toggle("active", t === tab);
      renderLogPanel();
    });
  }

  // Refresh button
  if (el.refreshDiagLogsBtn) {
    el.refreshDiagLogsBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      fetchDiagnosticLogs();
    });
  }

  // Auto-fetch when panel opens
  if (el.logPanelDetails) {
    el.logPanelDetails.addEventListener("toggle", () => {
      if (el.logPanelDetails.open) {
        fetchDiagnosticLogs();
      }
    });
  }
}
