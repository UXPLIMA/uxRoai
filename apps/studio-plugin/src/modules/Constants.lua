local M = {}

M.DEFAULT_AGENT_URL = "http://127.0.0.1:41117"
M.DEFAULT_LANGUAGE = "en"
M.APP_FIRST_PLUGIN_MODE = true
M.AUTO_INBOX_POLL_SECONDS = 1
M.WIDGET_ID = "uxRoaiWidgetV1"
M.ROOT_FOLDER_NAME = "UxRoaI"
M.REMOTE_NAME = "UxRoaIPlaytestStep"
M.PLAYTEST_SERVER_SCRIPT_NAME = "UxRoaIPlaytestServer"
M.PLAYTEST_CLIENT_SCRIPT_NAME = "UxRoaIPlaytestClient"
M.CONTEXT_SERVICE_NAMES = {
	"Workspace",
	"ReplicatedStorage",
	"ServerScriptService",
	"StarterGui",
	"StarterPlayer",
	"Lighting",
	"Teams",
	"SoundService",
	"CollectionService",
}
M.CONTEXT_MAX_NODES = 4500
M.CONTEXT_DEPTH = 6
M.CONTEXT_MAX_CHILDREN = 80
M.AUTO_REPAIR_MAX_ATTEMPTS = 10
M.AUTO_REPAIR_ISSUE_LIMIT = 16
M.GENERATED_GUI_ROOT_NAME = "UxRoaIGeneratedUI"
M.SMART_DUPLICATE_MAX = 50
M.ERROR_BATCH_LIMIT = 10
M.PROGRESS_BUFFER_MAX = 100
M.PROGRESS_BUFFER_TRIM = 50
M.SCRIPT_SOURCE_PREVIEW_MAX = 16000

M.UI_COLORS = {
	rootBg = Color3.fromRGB(20, 22, 26),
	titleText = Color3.fromRGB(245, 245, 245),
	langBtnBg = Color3.fromRGB(45, 53, 72),
	langBtnText = Color3.fromRGB(232, 236, 245),
	statusOffline = Color3.fromRGB(236, 116, 116),
	statusOnline = Color3.fromRGB(108, 232, 161),
	inputBg = Color3.fromRGB(34, 37, 43),
	inputText = Color3.fromRGB(225, 230, 235),
	placeholder = Color3.fromRGB(136, 145, 158),
	buttonBg = Color3.fromRGB(78, 116, 240),
	buttonText = Color3.fromRGB(250, 250, 250),
	logBg = Color3.fromRGB(15, 17, 21),
	logText = Color3.fromRGB(210, 215, 225),
}

return M
