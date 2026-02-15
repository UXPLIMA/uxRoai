import { state } from "./state.js";
import { SCRIPT_SVG } from "./constants.js";
import { t } from "./i18n.js";
import { showToast } from "./toast.js";
import { buildSimpleDiffLines, countDiffStats, makeCopyBtn, copyToClipboard } from "./utils.js";

function createPropertyDiffRow(label, before, after) {
  const diffRow = document.createElement("div");
  diffRow.className = "prop-diff-row";
  if (label) {
    const labelEl = document.createElement("span");
    labelEl.className = "prop-diff-label";
    labelEl.textContent = String(label);
    diffRow.appendChild(labelEl);
  }
  if (before !== undefined && before !== "") {
    const beforeEl = document.createElement("span");
    beforeEl.className = "prop-diff-before";
    beforeEl.textContent = String(before);
    diffRow.appendChild(beforeEl);
  }
  if (before !== undefined && before !== "" || after !== undefined) {
    const arrow = document.createElement("span");
    arrow.className = "prop-diff-arrow";
    arrow.textContent = "\u2192";
    diffRow.appendChild(arrow);
  }
  if (after !== undefined) {
    const afterEl = document.createElement("span");
    afterEl.className = "prop-diff-after";
    afterEl.textContent = String(after);
    diffRow.appendChild(afterEl);
  }
  return diffRow;
}

export function renderChanges(container, changes) {
  container.innerHTML = "";

  if (!Array.isArray(changes) || changes.length === 0) {
    return;
  }

  changes.forEach((change, changeIndex) => {
    const hasScript = change.beforeSource !== undefined || change.afterSource !== undefined;

    if (hasScript) {
      const diffLines = buildSimpleDiffLines(change.beforeSource, change.afterSource);
      const stats = countDiffStats(diffLines);
      const changePath = String(change.path || change.scriptPath || change.name || "-");

      const card = document.createElement("details");
      card.className = "diff-card";
      card.dataset.uiKey = `change-open-${changeIndex}`;

      const header = document.createElement("summary");
      header.className = "diff-card-header";

      const icon = document.createElement("span");
      icon.className = "diff-card-icon";
      icon.innerHTML = SCRIPT_SVG;

      const pathEl = document.createElement("span");
      pathEl.className = "diff-card-path";
      pathEl.textContent = changePath;

      const statsEl = document.createElement("span");
      statsEl.className = "diff-card-stats";
      if (stats.added > 0) {
        const addSpan = document.createElement("span");
        addSpan.className = "diff-stat-add";
        addSpan.textContent = `+${stats.added}`;
        statsEl.appendChild(addSpan);
      }
      if (stats.removed > 0) {
        const removeSpan = document.createElement("span");
        removeSpan.className = "diff-stat-remove";
        removeSpan.textContent = `-${stats.removed}`;
        statsEl.appendChild(removeSpan);
      }

      const actionsEl = document.createElement("div");
      actionsEl.className = "diff-card-actions";

      const copyBtn = makeCopyBtn();
      const diffText = diffLines.map((l) => {
        if (l.kind === "add") return `+ ${l.text}`;
        if (l.kind === "remove") return `- ${l.text}`;
        return l.text;
      }).join("\n");
      copyBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        copyToClipboard(diffText, copyBtn);
      });

      // Revert button
      if (change.beforeSource !== undefined) {
        const revertBtn = document.createElement("button");
        revertBtn.className = "diff-revert-btn";
        revertBtn.textContent = t("revertChange");
        revertBtn.title = t("revertConfirm");
        revertBtn.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!confirm(t("revertConfirm"))) return;
          revertBtn.disabled = true;
          try {
            const revertPrompt = `__revert__ ${changePath}`;
            await window.uxRoaiStudio.createTask(revertPrompt, state.activeProjectId, [], []);
            showToast(t("revertSuccess"), "warning");
          } catch (err) {
            showToast(err.message || "Revert failed", "error");
          } finally {
            revertBtn.disabled = false;
          }
        });
        actionsEl.appendChild(revertBtn);
      }

      const chevron = document.createElement("span");
      chevron.className = "diff-card-chevron";
      chevron.textContent = "\u25BE";

      actionsEl.appendChild(copyBtn);
      actionsEl.appendChild(chevron);

      header.appendChild(icon);
      header.appendChild(pathEl);
      header.appendChild(statsEl);
      header.appendChild(actionsEl);
      card.appendChild(header);

      const body = document.createElement("div");
      body.className = "diff-card-body";
      body.dataset.scrollKey = `change-diff-scroll-${changeIndex}`;

      diffLines.forEach((line) => {
        const row = document.createElement("div");
        row.className = `diff-line ${line.kind || "meta"}`;
        if (line.kind === "add") {
          row.textContent = `+ ${line.text}`;
        } else if (line.kind === "remove") {
          row.textContent = `- ${line.text}`;
        } else {
          row.textContent = String(line.text || "");
        }
        body.appendChild(row);
      });

      const lintWarnings = change.details?.lintWarnings;
      if (Array.isArray(lintWarnings) && lintWarnings.length > 0) {
        const lintRow = document.createElement("div");
        lintRow.className = "lint-warnings";
        lintRow.textContent = "\u26a0 " + lintWarnings.join("; ");
        body.appendChild(lintRow);
      }

      card.appendChild(body);
      container.appendChild(card);
    } else {
      const card = document.createElement("div");
      card.className = "prop-change-card";

      const changeType = String(change.type || "change");
      const typeEl = document.createElement("span");
      typeEl.className = "prop-change-type";
      if (changeType === "delete_instance") typeEl.classList.add("delete");
      if (changeType === "set_property" || changeType === "set_attribute") typeEl.classList.add("property");
      typeEl.textContent = changeType;

      const pathEl = document.createElement("span");
      pathEl.className = "prop-change-path";
      pathEl.textContent = String(change.path || change.scriptPath || change.name || "-");

      card.appendChild(typeEl);
      card.appendChild(pathEl);

      const details = change.details && typeof change.details === "object" ? change.details : null;

      if (changeType === "set_property" && details && details.property) {
        card.appendChild(createPropertyDiffRow(details.property, details.before, details.after));
      } else if (changeType === "create_instance" && details) {
        const infoRow = document.createElement("div");
        infoRow.className = "prop-diff-row";
        if (details.className) {
          const clsEl = document.createElement("span");
          clsEl.className = "prop-diff-label";
          clsEl.textContent = String(details.className);
          infoRow.appendChild(clsEl);
        }
        if (details.propertySuccess > 0) {
          const propsEl = document.createElement("span");
          propsEl.className = "prop-diff-after";
          propsEl.textContent = `${details.propertySuccess} props`;
          infoRow.appendChild(propsEl);
        }
        if (details.failedCount > 0 || (details.failedProperties && details.failedProperties.length > 0)) {
          const failEl = document.createElement("span");
          failEl.className = "prop-diff-before";
          failEl.textContent = `${details.failedCount || details.failedProperties?.length || 0} failed`;
          infoRow.appendChild(failEl);
        }
        card.appendChild(infoRow);
      } else if (changeType === "set_attribute" && details) {
        card.appendChild(createPropertyDiffRow(details.attribute, details.before, details.after));
      } else {
        const summaryEl = document.createElement("span");
        summaryEl.className = "prop-change-summary";
        summaryEl.textContent = String(change.summary || t("applied"));
        card.appendChild(summaryEl);
      }

      container.appendChild(card);
    }
  });
}
