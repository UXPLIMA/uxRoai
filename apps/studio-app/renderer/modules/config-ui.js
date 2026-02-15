import { state, el } from "./state.js";
import { DEFAULT_MODEL, DEFAULT_LANGUAGE, DEFAULT_PROVIDER, DEFAULT_CODE_COMMAND, DEFAULT_CODE_ARGS, DEFAULT_CUSTOM_INSTRUCTIONS } from "./constants.js";
import { t, normalizeLanguage, normalizeProvider, modelLabel } from "./i18n.js";

function setDropdownValue(selectEl, value, defaultVal) {
  const available = Array.from(selectEl?.options || []).map((o) => o.value);
  selectEl.value = available.includes(value) ? value : defaultVal;
}

export function setProviderValue(value) {
  setDropdownValue(el.claudeProviderInput, normalizeProvider(value), DEFAULT_PROVIDER);
}

export function setModelValue(value) {
  setDropdownValue(el.claudeModelInput, String(value || "").trim(), DEFAULT_MODEL);
}

export function setLanguageValue(value) {
  setDropdownValue(el.languageInput, normalizeLanguage(value), DEFAULT_LANGUAGE);
}

function syncDropdownOptions(selectEl, items, labelFn, value) {
  if (items.length === 0) return;
  const previous = selectEl.value;
  selectEl.innerHTML = "";
  for (const item of items) {
    const option = document.createElement("option");
    option.value = item;
    option.textContent = labelFn(item);
    selectEl.appendChild(option);
  }
  return previous;
}

export function getProviderFamily() {
  const provider = normalizeProvider(el.claudeProviderInput.value || state.config?.claudeProvider);
  if (provider === "codex" || provider === "openai-api") return "codex";
  if (provider === "gemini" || provider === "gemini-api") return "gemini";
  return "claude";
}

export function syncModelOptionsFromConfig(config, family) {
  const resolvedFamily = family || getProviderFamily();
  const familyConfig = {
    codex:  { key: "supportedCodexModels",  default: "gpt-5.3-codex",      saved: config?.codexModel },
    gemini: { key: "supportedGeminiModels", default: "gemini-3-pro-preview", saved: config?.geminiModel },
    claude: { key: "supportedClaudeModels", default: DEFAULT_MODEL,          saved: config?.claudeModel },
  };
  const fc = familyConfig[resolvedFamily] || familyConfig.claude;
  const items = Array.isArray(config?.[fc.key]) ? config[fc.key] : [];
  const previous = syncDropdownOptions(el.claudeModelInput, items, modelLabel);
  if (previous !== undefined) setModelValue(previous || fc.saved || fc.default);
}

export function syncLanguageOptionsFromConfig(config) {
  const items = Array.isArray(config?.supportedLanguages) ? config.supportedLanguages : [];
  const langLabel = (lang) => lang === "tr" ? t("lang_turkish") : t("lang_english");
  const previous = syncDropdownOptions(el.languageInput, items, langLabel);
  if (previous !== undefined) setLanguageValue(previous || config?.language || DEFAULT_LANGUAGE);
}

const PROVIDER_LABEL_MAP = {
  code: "provider_code", api: "provider_api", codex: "provider_codex",
  "openai-api": "provider_openai_api", gemini: "provider_gemini", "gemini-api": "provider_gemini_api",
};

export function syncProviderOptionsFromConfig(config) {
  const items = Array.isArray(config?.supportedClaudeProviders) ? config.supportedClaudeProviders : [];
  const providerLabel = (p) => t(PROVIDER_LABEL_MAP[p] || "provider_code");
  const previous = syncDropdownOptions(el.claudeProviderInput, items, providerLabel);
  if (previous !== undefined) setProviderValue(previous || config?.claudeProvider || DEFAULT_PROVIDER);
}

export function syncComposerModelSelect(config) {
  if (!el.composerModelSelect) return;
  const family = getProviderFamily();
  const familyConfig = {
    codex: { key: "supportedCodexModels", saved: config?.codexModel },
    gemini: { key: "supportedGeminiModels", saved: config?.geminiModel },
    claude: { key: "supportedClaudeModels", saved: config?.claudeModel },
  };
  const fc = familyConfig[family] || familyConfig.claude;
  const items = Array.isArray(config?.[fc.key]) ? config[fc.key] : [];
  el.composerModelSelect.innerHTML = "";
  for (const item of items) {
    const opt = document.createElement("option");
    opt.value = item;
    opt.textContent = modelLabel(item, true);
    el.composerModelSelect.appendChild(opt);
  }
  const current = fc.saved || el.claudeModelInput.value;
  const available = Array.from(el.composerModelSelect.options).map(o => o.value);
  el.composerModelSelect.value = available.includes(current) ? current : (available[0] || "");
}

export function applyProviderUi() {
  const provider = normalizeProvider(el.claudeProviderInput.value || state.config?.claudeProvider);
  const isClaude = provider === "code" || provider === "api";
  const isCodex = provider === "codex" || provider === "openai-api";
  const isGemini = provider === "gemini" || provider === "gemini-api";

  if (el.claudeFieldsGroup) el.claudeFieldsGroup.style.display = isClaude ? "" : "none";
  if (el.codexFieldsGroup) el.codexFieldsGroup.style.display = isCodex ? "" : "none";
  if (el.geminiFieldsGroup) el.geminiFieldsGroup.style.display = isGemini ? "" : "none";

  el.claudeCodeCommandInput.disabled = provider !== "code";
  el.claudeCodeArgsInput.disabled = provider !== "code";
  el.claudeApiKeyInput.disabled = provider !== "api";
  el.claudeApiKeyInput.placeholder = provider === "code" ? t("apiKeyOptional") : "sk-ant-...";
  el.claudeCodeCommandInput.placeholder = t("codeCommandPlaceholder");
  el.claudeCodeArgsInput.placeholder = t("codeArgsPlaceholder");

  if (el.codexCommandInput) el.codexCommandInput.disabled = provider !== "codex";
  if (el.openaiApiKeyInput) el.openaiApiKeyInput.disabled = provider !== "openai-api";

  if (el.geminiCommandInput) el.geminiCommandInput.disabled = provider !== "gemini";
  if (el.geminiApiKeyInput) el.geminiApiKeyInput.disabled = provider !== "gemini-api";

  const family = isGemini ? "gemini" : isCodex ? "codex" : "claude";
  syncModelOptionsFromConfig(state.config || {}, family);
}

const STATIC_LABELS = [
  ["logoSubText", "textContent", "logoSub"],
  ["projectsHeaderText", "textContent", "projectsHeader"],
  ["settingsBtn", "textContent", "settings"],
  ["agentLabelText", "textContent", "agentLabel"],
  ["startAgentBtn", "textContent", "startAgent"],
  ["stopAgentBtn", "textContent", "stopAgent"],
  ["agentUrlLabelText", "textContent", "agentUrlLabel"],
  ["claudeProviderLabelText", "textContent", "claudeProviderLabel"],
  ["claudeCodeCommandLabelText", "textContent", "claudeCodeCommandLabel"],
  ["claudeCodeArgsLabelText", "textContent", "claudeCodeArgsLabel"],
  ["claudeApiKeyLabelText", "textContent", "apiKeyLabel"],
  ["claudeModelLabelText", "textContent", "modelLabel"],
  ["codexCommandLabelText", "textContent", "codexCommandLabel"],
  ["openaiApiKeyLabelText", "textContent", "openaiApiKeyLabel"],
  ["geminiCommandLabelText", "textContent", "geminiCommandLabel"],
  ["geminiApiKeyLabelText", "textContent", "geminiApiKeyLabel"],
  ["languageLabelText", "textContent", "languageLabel"],
  ["maxRetriesLabelText", "textContent", "maxRetriesLabel"],
  ["minPlaytestSecondsLabelText", "textContent", "minPlaytestSecondsLabel"],
  ["planTimeoutLabelText", "textContent", "planTimeoutLabel"],
  ["claudeCodeTimeoutLabelText", "textContent", "claudeCodeTimeoutLabel"],
  ["codexTimeoutLabelText", "textContent", "codexTimeoutLabel"],
  ["geminiTimeoutLabelText", "textContent", "geminiTimeoutLabel"],
  ["customInstructionsLabelText", "textContent", "customInstructionsLabel"],
  ["resetCustomInstructionsBtn", "textContent", "resetToDefaults"],
  ["saveAgentBtn", "textContent", "saveSettings"],
  ["settingsTitleText", "textContent", "settings"],
  ["projectModalTitleText", "textContent", "projectModalTitle"],
  ["projectNameLabelText", "textContent", "projectNameLabel"],
  ["projectNameInput", "placeholder", "projectNamePlaceholder"],
  ["projectCancelBtn", "textContent", "cancel"],
  ["projectCreateConfirmBtn", "textContent", "create"],
  ["taskFlowText", "textContent", "taskFlow"],
  ["promptInput", "placeholder", "promptPlaceholder"],
  ["attachImageBtn", "title", "attachFile"],
  ["sendPromptBtn", "title", "sendQueue"],
  ["folderModalTitleText", "textContent", "createFolder"],
  ["folderNameLabelText", "textContent", "folderName"],
  ["folderNameInput", "placeholder", "folderNamePlaceholder"],
  ["folderCancelBtn", "textContent", "cancel"],
  ["folderCreateConfirmBtn", "textContent", "create"],
  ["transparencyLabelText", "textContent", "transparencyLabel"],
  ["chatsHeaderText", "textContent", "chatsHeader"],
];

export function applyLanguageToStaticUi() {
  for (const [elName, prop, key] of STATIC_LABELS) {
    if (el[elName]) el[elName][prop] = t(key);
  }
  const logSpan = el.agentLogsSummaryText.querySelector("span");
  if (logSpan) logSpan.textContent = t("agentLogs");
  applyProviderUi();
}
