--[[UXROAI_MODULES]]

-- Initialize UI
UI.urlBox.Text = Utils.loadAgentUrl()
UI.applyLanguageToUi()
UI.appendLog(I18N.t("logInit"))
UI.appendLog(I18N.t("logAgentUrl", { url = UI.urlBox.Text }))
if Constants.APP_FIRST_PLUGIN_MODE then
	UI.appendLog(I18N.t("logReadySimple"))
else
	UI.appendLog(I18N.t("logReadyUsage"))
end

-- Button event handlers
UI.generateButton.MouseButton1Click:Connect(function()
	Orchestration.runWithGuard(Orchestration.runPlanFlow)
end)

UI.playtestButton.MouseButton1Click:Connect(function()
	Orchestration.runWithGuard(Orchestration.runPlaytestOnlyFlow)
end)

UI.harnessButton.MouseButton1Click:Connect(function()
	Orchestration.runWithGuard(function()
		Orchestration.installHarnessManual()
	end)
end)

UI.languageButton.MouseButton1Click:Connect(function()
	local lang = I18N.getLanguage()
	I18N.saveLanguage(lang == "en" and "tr" or "en")
	UI.applyLanguageToUi()
	UI.appendLog(I18N.t("logLanguageSwitched", { lang = string.upper(I18N.getLanguage()) }))
end)

UI.urlBox.FocusLost:Connect(function()
	local normalized = Utils.saveAgentUrl(UI.urlBox.Text)
	UI.urlBox.Text = normalized
	UI.appendLog(I18N.t("logAgentSaved", { url = normalized }))
	Orchestration.refreshAgentHealth(false)
end)

UI.toggleButton.Click:Connect(function()
	UI.widget.Enabled = not UI.widget.Enabled
end)

UI.widget:GetPropertyChangedSignal("Enabled"):Connect(function()
	UI.toggleButton:SetActive(UI.widget.Enabled)
end)

-- Deferred initialization
task.defer(function()
	Orchestration.refreshAgentHealth(true)
end)
task.defer(function()
	Orchestration.startAutoInboxPolling()
end)
