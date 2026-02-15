import { state, el } from "./state.js";
import { t } from "./i18n.js";

const TOTAL_STEPS = 4;
let currentStep = 0;

function showStep(step) {
  currentStep = step;
  for (let i = 0; i < TOTAL_STEPS; i++) {
    const screen = document.getElementById(`setupScreen${i}`);
    const dot = document.querySelector(`.setup-step[data-step="${i}"]`);
    if (screen) screen.classList.toggle("hidden", i !== step);
    if (dot) {
      dot.classList.toggle("active", i === step);
      dot.classList.toggle("done", i < step);
    }
  }
  const backBtn = document.getElementById("setupBackBtn");
  const nextBtn = document.getElementById("setupNextBtn");
  if (backBtn) backBtn.style.display = step > 0 ? "" : "none";
  if (nextBtn) {
    nextBtn.textContent = step >= TOTAL_STEPS - 1 ? t("setupFinish") : t("setupNext");
  }
  // Auto-install plugin when reaching the plugin step
  if (step === 2) {
    tryAutoInstallPlugin();
  }
}

async function tryAutoInstallPlugin() {
  const checklist = document.querySelector(".setup-checklist");
  if (!checklist || !window.uxRoaiStudio.installPlugin) return;
  try {
    const result = await window.uxRoaiStudio.installPlugin();
    if (result.installed) {
      checklist.innerHTML = '<div class="setup-check-item setup-check-done">Plugin installed automatically! Restart Roblox Studio to activate.</div>';
    } else if (result.message?.includes("up to date")) {
      checklist.innerHTML = '<div class="setup-check-item setup-check-done">Plugin is already installed and up to date.</div>';
    }
  } catch { /* silent - fall back to manual instructions */ }
}

function applyI18n() {
  const map = {
    setupWelcomeTitleText: "setupWelcomeTitle",
    setupWelcomeDescText: "setupWelcomeDesc",
    setupCliTitleText: "setupCliTitle",
    setupCliDescText: "setupCliDesc",
    setupPluginTitleText: "setupPluginTitle",
    setupPluginDescText: "setupPluginDesc",
    setupReadyTitleText: "setupReadyTitle",
    setupReadyDescText: "setupReadyDesc",
  };
  for (const [id, key] of Object.entries(map)) {
    const elem = document.getElementById(id);
    if (elem) elem.textContent = t(key);
  }
  const skipBtn = document.getElementById("setupSkipBtn");
  if (skipBtn) skipBtn.textContent = t("setupSkip");
  const backBtn = document.getElementById("setupBackBtn");
  if (backBtn) backBtn.textContent = t("setupBack");
}

async function completeSetup() {
  const wizard = document.getElementById("setupWizard");
  if (wizard) wizard.classList.add("hidden");

  // Save provider selection from setup
  const setupProvider = document.getElementById("setupProviderSelect");
  if (setupProvider && setupProvider.value) {
    try {
      await window.uxRoaiStudio.setAgentSettings({
        claudeProvider: setupProvider.value,
        setupCompleted: true,
      });
    } catch { /* silent */ }
  } else {
    try {
      await window.uxRoaiStudio.setAgentSettings({ setupCompleted: true });
    } catch { /* silent */ }
  }
}

export function initSetupFlow() {
  if (!state.config || state.config.setupCompleted) return;

  const wizard = document.getElementById("setupWizard");
  if (!wizard) return;

  wizard.classList.remove("hidden");
  applyI18n();
  showStep(0);

  const nextBtn = document.getElementById("setupNextBtn");
  const backBtn = document.getElementById("setupBackBtn");
  const skipBtn = document.getElementById("setupSkipBtn");

  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      if (currentStep >= TOTAL_STEPS - 1) {
        completeSetup();
      } else {
        showStep(currentStep + 1);
      }
    });
  }

  if (backBtn) {
    backBtn.addEventListener("click", () => {
      if (currentStep > 0) showStep(currentStep - 1);
    });
  }

  if (skipBtn) {
    skipBtn.addEventListener("click", () => {
      completeSetup();
    });
  }
}
