import { COPY_SVG } from "./constants.js";
import { t } from "./i18n.js";

export function toHumanTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  if (totalSeconds < 3600) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s`;
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

export function safeJson(value, fallback = "") {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return fallback;
  }
}

export function copyToClipboard(text, btnEl) {
  navigator.clipboard.writeText(text).then(() => {
    if (btnEl) {
      btnEl.classList.add("copied");
      const originalTitle = btnEl.title;
      btnEl.title = t("copied");
      setTimeout(() => {
        btnEl.classList.remove("copied");
        btnEl.title = originalTitle;
      }, 1500);
    }
  }).catch(() => {});
}

export function makeCopyBtn() {
  const btn = document.createElement("button");
  btn.className = "copy-btn";
  btn.title = "Copy";
  btn.innerHTML = COPY_SVG;
  return btn;
}

export function buildSimpleDiffLines(beforeSource, afterSource) {
  const before = String(beforeSource || "").split("\n");
  const after = String(afterSource || "").split("\n");

  if (before.length === 1 && before[0] === "" && after.length === 1 && after[0] === "") {
    return [];
  }

  const lines = [];
  const max = Math.max(before.length, after.length);
  const maxOutputLines = 120;

  for (let index = 0; index < max && lines.length < maxOutputLines; index += 1) {
    const left = before[index];
    const right = after[index];
    if (left === right) continue;
    if (left !== undefined) lines.push({ kind: "remove", text: left });
    if (right !== undefined) lines.push({ kind: "add", text: right });
  }

  if (lines.length === 0) return [{ kind: "meta", text: t("diffNoText") }];
  if (max > maxOutputLines) lines.push({ kind: "meta", text: t("diffTruncated") });
  return lines;
}

export function countDiffStats(diffLines) {
  let added = 0;
  let removed = 0;
  for (const line of diffLines) {
    if (line.kind === "add") added += 1;
    if (line.kind === "remove") removed += 1;
  }
  return { added, removed };
}

export function buildTasksFingerprint(tasks) {
  let fp = "";
  for (const tk of tasks) {
    fp += tk.id + "|" + tk.status + "|" + (tk.prompt || "").length + "|";
    fp += (tk.result ? "R" : "") + "|";
    const pLen = Array.isArray(tk.progress) ? tk.progress.length : 0;
    fp += pLen + "|";
    // Only include last message for non-volatile types (skip streaming/thinking
    // which change rapidly and would cause unnecessary full DOM rebuilds)
    if (pLen > 0) {
      const lastType = tk.progress[pLen - 1].type || "info";
      if (lastType !== "streaming" && lastType !== "thinking") {
        fp += (tk.progress[pLen - 1].message || "") + "|";
      }
    }
    fp += (tk.finishedAt || "") + "|";
    fp += (tk.pendingPlan ? "PP" : "") + "|";
    fp += (tk.planDecision ? (tk.planDecision.approved ? "PA" : "PR") : "") + ";";
  }
  return fp;
}

export function updateLiveTimers() {
  const spans = document.querySelectorAll(".chat-timing[data-claimed-at]");
  const now = Date.now();
  for (const span of spans) {
    const claimedAt = Number(span.dataset.claimedAt);
    if (!claimedAt) continue;
    const elapsed = now - claimedAt;
    if (elapsed > 0) {
      span.textContent = `\u00b7 ${formatDuration(elapsed)}`;
    }
  }
}
