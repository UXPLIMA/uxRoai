import { t } from "./i18n.js";
import { safeJson, makeCopyBtn, copyToClipboard } from "./utils.js";

export function summarizePlaytest(playtestResult) {
  if (!playtestResult || typeof playtestResult !== "object") {
    return t("playtestUnavailable");
  }
  if (playtestResult.ok === false) {
    return t("playtestSummaryFailed");
  }
  if (playtestResult.ok === true) {
    return t("playtestSummaryOk");
  }
  return t("playtestUnavailable");
}

export function renderPlaytest(container, playtestResult, taskStatus) {
  container.innerHTML = "";

  if (!playtestResult) {
    return;
  }

  const card = document.createElement("details");
  card.className = "playtest-card";
  card.dataset.uiKey = "playtest-open";
  card.open = true;

  const header = document.createElement("summary");
  header.className = "playtest-card-header";

  const badge = document.createElement("span");
  badge.className = "playtest-badge";
  badge.textContent = t("playtest");

  if (playtestResult?.ok === true) {
    badge.classList.add("pass");
  } else if (playtestResult?.ok === false) {
    badge.classList.add("fail");
  } else {
    badge.classList.add("pending");
  }

  const statusText = document.createElement("span");
  statusText.className = "playtest-status-text";
  statusText.textContent = summarizePlaytest(playtestResult);

  const actions = document.createElement("div");
  actions.className = "playtest-card-actions";

  const copyBtn = makeCopyBtn();
  const playtestText = playtestResult ? safeJson(playtestResult, "") : "";
  copyBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    copyToClipboard(playtestText, copyBtn);
  });

  const chevron = document.createElement("span");
  chevron.className = "playtest-chevron";
  chevron.textContent = "\u25BE";

  actions.appendChild(copyBtn);
  actions.appendChild(chevron);

  header.appendChild(badge);
  header.appendChild(statusText);
  header.appendChild(actions);
  card.appendChild(header);

  if (playtestResult) {
    const body = document.createElement("div");
    body.className = "playtest-card-body";
    body.textContent = safeJson(playtestResult, t("playtestUnavailable"));
    card.appendChild(body);
  }

  container.appendChild(card);
}
