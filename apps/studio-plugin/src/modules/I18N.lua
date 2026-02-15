local M = {}

M.strings = {
	en = {
		toolbarTooltip = "Open/close the uxRoai panel",
		panelTitle = "uxRoai - Prompt -> Code -> Test",
		panelTitleSimple = "uxRoai - Studio Bridge",
		urlPlaceholder = "Agent URL (example: http://127.0.0.1:41117)",
		promptPlaceholder = "Describe the feature (EN/TR). Example: Add a Shop GUI with 3 items, then run click tests.",
		buttonPlanApply = "Plan + Apply",
		buttonTestOnly = "Test Only",
		buttonHarness = "Install Harness",
		statusLabel = "Agent: {status}",
		statusOnline = "online",
		statusOffline = "offline",
		languageButton = "Language: {lang}",
		langCode = "EN",
		logInit = "uxRoai ready.",
		logReadySimple = "App-first mode enabled. Manage tasks from desktop app; plugin auto-claims from queue.",
		logBusyWait = "Operation in progress, please wait...",
		logErrorPrefix = "Error: {error}",
		logAgentSaved = "Agent URL saved: {url}",
		logAgentUrl = "Agent URL: {url}",
		logReadyUsage = "Ready. Write a prompt, then use 'Plan + Apply' or auto queue mode.",
		logWarningPrefix = "Warning: {warning}",
		logUnknownAction = "Unknown action type: {actionType}",
		logSnapshot = "Capturing studio snapshot...",
		logPlanRequest = "Requesting plan: {url}/v1/plan",
		logPlanAttempt = "Planning attempt {attempt}/{max}...",
		logPlanRepairRetry = "Issues detected. Running auto-fix retry {nextAttempt}/{max}.",
		logPlanAutoPlaytest = "Running plan playtest automatically...",
		logPlaytestRequest = "Requesting playtest scenario: {url}/v1/playtests",
		logPlaytestStart = "Starting playtest...",
		logPlaytestResult = "Playtest result: {result}",
		logHarnessInstalled = "Playtest harness installed/updated.",
		logHarnessDeferred = "Harness install deferred. It will be injected only while playtesting.",
		logHarnessRemoved = "Playtest harness cleaned up after run.",
		logQueueClaim = "Trying to claim a desktop queue task...",
		logQueueEmpty = "Desktop queue is empty.",
		logTaskClaimed = "Task claimed: #{id}",
		logTaskReported = "Task reported: #{id}",
		logAutoInboxEnabled = "Auto inbox polling enabled ({seconds}s).",
		logLanguageSwitched = "Language switched: {lang}",
		logHealthOnline = "Agent health check: online",
		logHealthOffline = "Agent health check failed. Check app/agent state.",
	},
	tr = {
		toolbarTooltip = "uxRoai panelini ac/kapat",
		panelTitle = "uxRoai - Prompt -> Kod -> Test",
		panelTitleSimple = "uxRoai - Studio Koprusu",
		urlPlaceholder = "Agent URL (ornek: http://127.0.0.1:41117)",
		promptPlaceholder = "Ozelligi anlat (TR/EN). Ornek: Shop GUI ekle, 3 item, sonra click testini yap.",
		buttonPlanApply = "Plan + Uygula",
		buttonTestOnly = "Sadece Test",
		buttonHarness = "Harness Kur",
		statusLabel = "Agent: {status}",
		statusOnline = "online",
		statusOffline = "offline",
		languageButton = "Dil: {lang}",
		langCode = "TR",
		logInit = "uxRoai hazir.",
		logReadySimple = "App-oncelikli mod acik. Gorevleri masaustu uygulamadan yonet; plugin queue'dan otomatik alir.",
		logBusyWait = "Islem devam ediyor, bekleyin...",
		logErrorPrefix = "Hata: {error}",
		logAgentSaved = "Agent URL kaydedildi: {url}",
		logAgentUrl = "Agent URL: {url}",
		logReadyUsage = "Hazir. Prompt yazip 'Plan + Uygula' veya otomatik kuyruk modunu kullan.",
		logWarningPrefix = "Uyari: {warning}",
		logUnknownAction = "Bilinmeyen action tipi: {actionType}",
		logSnapshot = "Snapshot aliniyor...",
		logPlanRequest = "Plan isteniyor: {url}/v1/plan",
		logPlanAttempt = "Plan denemesi {attempt}/{max}...",
		logPlanRepairRetry = "Sorun algilandi. Otomatik duzeltme tekrar denemesi {nextAttempt}/{max}.",
		logPlanAutoPlaytest = "Plan playtest otomatik calistiriliyor...",
		logPlaytestRequest = "Playtest senaryosu isteniyor: {url}/v1/playtests",
		logPlaytestStart = "Playtest baslatiliyor...",
		logPlaytestResult = "Playtest sonucu: {result}",
		logHarnessInstalled = "Playtest harness kuruldu/guncellendi.",
		logHarnessDeferred = "Harness kurulumu ertelendi. Sadece playtest sirasinda inject edilecek.",
		logHarnessRemoved = "Playtest bitince harness temizlendi.",
		logQueueClaim = "Desktop queue task alinmaya calisiliyor...",
		logQueueEmpty = "Desktop queue bos.",
		logTaskClaimed = "Task alindi: #{id}",
		logTaskReported = "Task raporlandi: #{id}",
		logAutoInboxEnabled = "Auto inbox polling aktif ({seconds}s).",
		logLanguageSwitched = "Dil degisti: {lang}",
		logHealthOnline = "Agent saglik kontrolu: online",
		logHealthOffline = "Agent saglik kontrolu basarisiz. App/agent durumunu kontrol et.",
	},
}

-- Private mutable state
local language = Constants.DEFAULT_LANGUAGE

function M.normalizeLanguage(value)
	local text = string.lower(tostring(value or ""))
	if text == "tr" then
		return "tr"
	end
	return Constants.DEFAULT_LANGUAGE
end

function M.loadLanguage()
	local saved = plugin:GetSetting("Language")
	if type(saved) == "string" and saved ~= "" then
		return M.normalizeLanguage(saved)
	end
	return Constants.DEFAULT_LANGUAGE
end

function M.saveLanguage(languageCode)
	local normalized = M.normalizeLanguage(languageCode)
	plugin:SetSetting("Language", normalized)
	language = normalized
	return normalized
end

function M.getLanguage()
	return language
end

function M.setLanguage(lang)
	language = M.normalizeLanguage(lang)
end

function M.t(key, vars)
	local languagePack = M.strings[language] or M.strings.en
	local template = languagePack[key] or M.strings.en[key] or key
	if type(vars) ~= "table" then
		return template
	end
	return string.gsub(template, "{(%w+)}", function(token)
		local value = vars[token]
		if value == nil then
			return "{" .. token .. "}"
		end
		return tostring(value)
	end)
end

-- Initialize language from saved settings
language = M.loadLanguage()

return M
