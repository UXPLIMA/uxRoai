local ChangeHistoryService = game:GetService("ChangeHistoryService")

local M = {}

-- Create toolbar and widget
local toolbar = plugin:CreateToolbar("uxRoai")
local toggleButton = toolbar:CreateButton(
	"uxRoai",
	I18N.t("toolbarTooltip"),
	"rbxassetid://119458223581073"
)
toggleButton.ClickableWhenViewportHidden = true

local widgetInfo = DockWidgetPluginGuiInfo.new(
	Enum.InitialDockState.Right,
	true,
	false,
	460,
	560,
	360,
	360
)

local widget = plugin:CreateDockWidgetPluginGui(Constants.WIDGET_ID, widgetInfo)
widget.Title = "uxRoai"

local C = Constants.UI_COLORS

local root = Instance.new("Frame")
root.Name = "Root"
root.BackgroundColor3 = C.rootBg
root.BorderSizePixel = 0
root.Size = UDim2.fromScale(1, 1)
root.Parent = widget

local title = Instance.new("TextLabel")
title.BackgroundTransparency = 1
title.Position = UDim2.new(0, 8, 0, 8)
title.Size = UDim2.new(1, -98, 0, 22)
title.Font = Enum.Font.GothamBold
title.TextSize = 18
title.TextColor3 = C.titleText
title.TextXAlignment = Enum.TextXAlignment.Left
title.Text = I18N.t("panelTitle")
title.Parent = root

local languageButton = Instance.new("TextButton")
languageButton.BackgroundColor3 = C.langBtnBg
languageButton.BorderSizePixel = 0
languageButton.Position = UDim2.new(1, -82, 0, 8)
languageButton.Size = UDim2.new(0, 74, 0, 22)
languageButton.Font = Enum.Font.GothamSemibold
languageButton.TextSize = 11
languageButton.TextColor3 = C.langBtnText
languageButton.Text = I18N.t("languageButton", { lang = I18N.t("langCode") })
languageButton.Parent = root

local statusLabel = Instance.new("TextLabel")
statusLabel.BackgroundTransparency = 1
statusLabel.Position = UDim2.new(0, 8, 0, 32)
statusLabel.Size = UDim2.new(0, 240, 0, 16)
statusLabel.Font = Enum.Font.GothamSemibold
statusLabel.TextSize = 11
statusLabel.TextColor3 = C.statusOffline
statusLabel.TextXAlignment = Enum.TextXAlignment.Left
statusLabel.Text = I18N.t("statusLabel", { status = I18N.t("statusOffline") })
statusLabel.Parent = root

local urlBox = Instance.new("TextBox")
urlBox.ClearTextOnFocus = false
urlBox.BackgroundColor3 = C.inputBg
urlBox.BorderSizePixel = 0
urlBox.Position = UDim2.new(0, 8, 0, 36)
urlBox.Size = UDim2.new(1, -16, 0, 28)
urlBox.Font = Enum.Font.Code
urlBox.TextSize = 14
urlBox.TextXAlignment = Enum.TextXAlignment.Left
urlBox.TextColor3 = C.inputText
urlBox.PlaceholderColor3 = C.placeholder
urlBox.PlaceholderText = I18N.t("urlPlaceholder")
urlBox.Parent = root

local promptBox = Instance.new("TextBox")
promptBox.ClearTextOnFocus = false
promptBox.MultiLine = true
promptBox.TextWrapped = true
promptBox.TextYAlignment = Enum.TextYAlignment.Top
promptBox.TextXAlignment = Enum.TextXAlignment.Left
promptBox.BackgroundColor3 = C.inputBg
promptBox.BorderSizePixel = 0
promptBox.Position = UDim2.new(0, 8, 0, 72)
promptBox.Size = UDim2.new(1, -16, 0, 132)
promptBox.Font = Enum.Font.Code
promptBox.TextSize = 14
promptBox.TextColor3 = C.inputText
promptBox.PlaceholderColor3 = C.placeholder
promptBox.PlaceholderText = I18N.t("promptPlaceholder")
promptBox.Parent = root

local buttonRow = Instance.new("Frame")
buttonRow.BackgroundTransparency = 1
buttonRow.Position = UDim2.new(0, 8, 0, 212)
buttonRow.Size = UDim2.new(1, -16, 0, 34)
buttonRow.Parent = root

local buttonLayout = Instance.new("UIListLayout")
buttonLayout.FillDirection = Enum.FillDirection.Horizontal
buttonLayout.HorizontalAlignment = Enum.HorizontalAlignment.Left
buttonLayout.VerticalAlignment = Enum.VerticalAlignment.Center
buttonLayout.Padding = UDim.new(0, 8)
buttonLayout.Parent = buttonRow

local function createButton(text, width)
	local button = Instance.new("TextButton")
	button.BackgroundColor3 = C.buttonBg
	button.BorderSizePixel = 0
	button.Size = UDim2.new(0, width or 104, 0, 34)
	button.Font = Enum.Font.GothamSemibold
	button.TextSize = 13
	button.TextColor3 = C.buttonText
	button.Text = text
	button.Parent = buttonRow
	return button
end

local generateButton = createButton(I18N.t("buttonPlanApply"), 104)
local playtestButton = createButton(I18N.t("buttonTestOnly"), 104)
local harnessButton = createButton(I18N.t("buttonHarness"), 104)

local logBox = Instance.new("TextBox")
logBox.ClearTextOnFocus = false
logBox.MultiLine = true
logBox.TextWrapped = false
logBox.TextXAlignment = Enum.TextXAlignment.Left
logBox.TextYAlignment = Enum.TextYAlignment.Top
logBox.BackgroundColor3 = C.logBg
logBox.BorderSizePixel = 0
logBox.Position = UDim2.new(0, 8, 0, 254)
logBox.Size = UDim2.new(1, -16, 1, -262)
logBox.Font = Enum.Font.Code
logBox.TextSize = 13
logBox.TextColor3 = C.logText
logBox.Text = ""
pcall(function()
	logBox.TextEditable = false
end)
logBox.Parent = root

-- State
local logLines = {}
local isBusy = false
local agentOnline = false

M.planWaypointCount = 0

-- Expose references needed by other modules
M.widget = widget
M.toggleButton = toggleButton
M.urlBox = urlBox
M.promptBox = promptBox
M.generateButton = generateButton
M.playtestButton = playtestButton
M.harnessButton = harnessButton
M.languageButton = languageButton

function M.updateAgentStatusLabel(isOnline)
	agentOnline = isOnline and true or false
	local statusKey = agentOnline and "statusOnline" or "statusOffline"
	statusLabel.Text = I18N.t("statusLabel", { status = I18N.t(statusKey) })
	if agentOnline then
		statusLabel.TextColor3 = C.statusOnline
	else
		statusLabel.TextColor3 = C.statusOffline
	end
end

function M.applyModeLayout()
	if Constants.APP_FIRST_PLUGIN_MODE then
		promptBox.Visible = false
		generateButton.Visible = false
		playtestButton.Visible = false
		harnessButton.Visible = false
		statusLabel.Visible = true

		urlBox.Position = UDim2.new(0, 8, 0, 52)
		urlBox.Size = UDim2.new(1, -16, 0, 28)
		buttonRow.Visible = false
		logBox.Position = UDim2.new(0, 8, 0, 88)
		logBox.Size = UDim2.new(1, -16, 1, -96)
		return
	end

	buttonRow.Visible = true
	promptBox.Visible = true
	generateButton.Visible = true
	playtestButton.Visible = true
	harnessButton.Visible = true
	statusLabel.Visible = false

	urlBox.Position = UDim2.new(0, 8, 0, 36)
	urlBox.Size = UDim2.new(1, -16, 0, 28)
	buttonRow.Position = UDim2.new(0, 8, 0, 212)
	buttonRow.Size = UDim2.new(1, -16, 0, 34)
	logBox.Position = UDim2.new(0, 8, 0, 254)
	logBox.Size = UDim2.new(1, -16, 1, -262)
end

function M.appendLog(message)
	local line = string.format("[%s] %s", os.date("%H:%M:%S"), tostring(message))
	logLines[#logLines + 1] = line
	if #logLines > 120 then
		local trimmed = {}
		for i = #logLines - 119, #logLines do
			trimmed[#trimmed + 1] = logLines[i]
		end
		logLines = trimmed
	end
	logBox.Text = table.concat(logLines, "\n")
	logBox.CursorPosition = -1
end

function M.recordWaypoint(description)
	pcall(function()
		ChangeHistoryService:SetWaypoint(description)
	end)
	M.planWaypointCount = M.planWaypointCount + 1
end

function M.applyLanguageToUi()
	title.Text = Constants.APP_FIRST_PLUGIN_MODE and I18N.t("panelTitleSimple") or I18N.t("panelTitle")
	urlBox.PlaceholderText = I18N.t("urlPlaceholder")
	promptBox.PlaceholderText = I18N.t("promptPlaceholder")
	generateButton.Text = I18N.t("buttonPlanApply")
	playtestButton.Text = I18N.t("buttonTestOnly")
	harnessButton.Text = I18N.t("buttonHarness")
	languageButton.Text = I18N.t("languageButton", { lang = I18N.t("langCode") })
	M.updateAgentStatusLabel(agentOnline)
	M.applyModeLayout()
end

function M.copyRecentLogLines(maxCount)
	local count = math.max(1, math.floor(tonumber(maxCount) or 40))
	local startIndex = math.max(1, #logLines - count + 1)
	local lines = {}
	for index = startIndex, #logLines do
		table.insert(lines, logLines[index])
	end
	return lines
end

function M.setBusy(value)
	isBusy = value
	generateButton.AutoButtonColor = not value
	playtestButton.AutoButtonColor = not value
	harnessButton.AutoButtonColor = not value
	languageButton.AutoButtonColor = not value
	generateButton.Active = not value
	playtestButton.Active = not value
	harnessButton.Active = not value
	languageButton.Active = not value
end

function M.getIsBusy()
	return isBusy
end

return M
