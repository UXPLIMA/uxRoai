local HarnessTemplates = {}

-- ═══ SHARED BLOCKS (used by ServerScript and ClientScript) ═══

local SHARED_SERVICES = [=[
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local StudioTestService = game:GetService("StudioTestService")

if not RunService:IsStudio() then
	return
end

]=]

local SHARED_PATH_HELPERS = [=[
local function splitPath(path)
	local segments = {}
	for segment in string.gmatch(path, "[^%.]+") do
		table.insert(segments, segment)
	end
	return segments
end

local function resolvePath(path)
	if type(path) ~= "string" or path == "" then
		return nil
	end

	if path == "game" then
		return game
	end

	local current = game
	for _, segment in ipairs(splitPath(path)) do
		if segment ~= "game" then
			current = current:FindFirstChild(segment)
			if not current then
				return nil
			end
		end
	end
	return current
end

-- Retry resolvePath multiple times with delays (objects may not exist yet)
local function resolvePathWithRetry(path, maxAttempts, delayPerAttempt)
	maxAttempts = maxAttempts or 6
	delayPerAttempt = delayPerAttempt or 0.5
	for attempt = 1, maxAttempts do
		local result = resolvePath(path)
		if result then
			return result
		end
		if attempt < maxAttempts then
			task.wait(delayPerAttempt)
		end
	end
	return nil
end

]=]

local SHARED_MOVEMENT_HELPERS = [=[
local function vectorFromTable(position)
	if type(position) ~= "table" then
		return nil
	end

	local x = tonumber(position.x)
	local y = tonumber(position.y)
	local z = tonumber(position.z)
	if not x or not y or not z then
		return nil
	end

	return Vector3.new(x, y, z)
end

local function getTargetPosition(target)
	if not target then
		return nil
	end

	if target:IsA("BasePart") then
		return target.Position
	end

	if target:IsA("Model") then
		if target.PrimaryPart then
			return target.PrimaryPart.Position
		end
		local pivot = target:GetPivot()
		return pivot.Position
	end

	return nil
end

local function waitForCharacter(player, timeout)
	timeout = timeout or 10
	local character = player.Character
	if not character then
		local startTime = os.clock()
		local conn
		conn = player.CharacterAdded:Connect(function(char)
			character = char
			if conn then conn:Disconnect() end
		end)
		-- Poll with short waits (avoids task.defer crash on suspended threads)
		while not character and (os.clock() - startTime) < timeout do
			task.wait(0.25)
		end
		if conn then conn:Disconnect() end
	end
	if not character then
		return nil, nil
	end
	local rootPart = character:FindFirstChild("HumanoidRootPart")
	if not rootPart then
		rootPart = character:WaitForChild("HumanoidRootPart", timeout)
	end
	return character, rootPart
end

local function teleportPlayer(player, destination, yOffset)
	local character, rootPart = waitForCharacter(player, 10)
	if not rootPart then
		return false, "HumanoidRootPart not found"
	end

	yOffset = yOffset or 3
	rootPart.CFrame = CFrame.new(destination + Vector3.new(0, yOffset, 0))
	task.wait(0.3)
	return true, "Teleport complete"
end

]=]

local SHARED_TOUCH_TARGET = [=[
-- Touch target: teleport player directly into the object to trigger Touched events
-- Repeats small movements to ensure physical contact is made
local function touchTarget(player, targetPath)
	local target = resolvePathWithRetry(targetPath, 6, 0.5)
	if not target then
		return { ok = false, message = "Touch target not found: " .. tostring(targetPath) }
	end

	local destination = getTargetPosition(target)
	if not destination then
		return { ok = false, message = "Touch target has no position: " .. tostring(targetPath) }
	end

	local character, rootPart = waitForCharacter(player, 10)
	if not rootPart then
		return { ok = false, message = "HumanoidRootPart not found" }
	end

	-- Teleport directly to the object position (no Y offset) to trigger Touched
	rootPart.CFrame = CFrame.new(destination)
	task.wait(0.15)

	-- Small nudges to ensure contact (physics may not register a stationary overlap)
	for nudge = 1, 3 do
		if not target.Parent then
			-- Object was destroyed by the touch — success
			return { ok = true, message = "Touched and destroyed: " .. tostring(targetPath) }
		end
		rootPart.CFrame = CFrame.new(destination + Vector3.new(0, -0.5 * nudge, 0))
		task.wait(0.15)
		rootPart.CFrame = CFrame.new(destination)
		task.wait(0.15)
	end

	-- Move slightly above and drop back to trigger falling contact
	rootPart.CFrame = CFrame.new(destination + Vector3.new(0, 4, 0))
	task.wait(0.3)
	rootPart.CFrame = CFrame.new(destination)
	task.wait(0.5)

	-- Check if the target was destroyed by the interaction
	if not target.Parent then
		return { ok = true, message = "Touched and destroyed: " .. tostring(targetPath) }
	end

	return { ok = true, message = "Touched: " .. tostring(targetPath) }
end

]=]

-- ═══ SERVER SCRIPT ═══

HarnessTemplates.ServerScript = SHARED_SERVICES .. SHARED_PATH_HELPERS .. SHARED_MOVEMENT_HELPERS .. SHARED_TOUCH_TARGET .. [=[
-- ═══ TEST FRAMEWORK ═══

local args = StudioTestService:GetTestArgs()
if type(args) ~= "table" or args.kind ~= "uxroai_playtest" or args.version ~= 2 then
	return
end

local _consoleOutput = {}
local _assertions = {}
local _allPassed = true
local _runtimeWarnings = {}

-- Capture Studio warnings/errors from ALL scripts (not just harness)
local LogService = game:GetService("LogService")
local _logConnection = LogService.MessageOut:Connect(function(message, messageType)
	if messageType == Enum.MessageType.MessageWarning or messageType == Enum.MessageType.MessageError then
		local msg = tostring(message)
		-- Skip harness's own output
		if not msg:match("^%[SERVER%]") and not msg:match("^%[CLIENT%]") then
			if #_runtimeWarnings < 20 then
				table.insert(_runtimeWarnings, msg)
			end
		end
	end
end)

local function log(message)
	local line = "[SERVER] " .. tostring(message)
	table.insert(_consoleOutput, line)
	print(line)
end

local function assert_true(condition, label)
	label = tostring(label or "assertion")
	local entry = { label = label, passed = condition and true or false }
	table.insert(_assertions, entry)
	if not entry.passed then
		_allPassed = false
		log("FAIL: " .. label)
	else
		log("PASS: " .. label)
	end
end

local function assert_exists(dotPath, label)
	label = label or ("exists: " .. tostring(dotPath))
	local obj = resolvePathWithRetry(dotPath, 8, 0.5)
	assert_true(obj ~= nil, label)
end

local function assert_not_exists(dotPath, label)
	label = label or ("not exists: " .. tostring(dotPath))
	task.wait(0.5)
	for _ = 1, 5 do
		local obj = resolvePath(dotPath)
		if not obj then
			assert_true(true, label)
			return
		end
		task.wait(0.5)
	end
	assert_true(false, label)
end

local function assert_property(dotPath, prop, expected, label)
	label = label or (tostring(dotPath) .. "." .. tostring(prop) .. " == " .. tostring(expected))
	local obj = resolvePathWithRetry(dotPath, 8, 0.5)
	if not obj then
		assert_true(false, label .. " (instance not found)")
		return
	end
	local readOk, actual = pcall(function() return obj[prop] end)
	if not readOk then
		assert_true(false, label .. " (cannot read property)")
		return
	end
	if type(actual) == "number" then expected = tonumber(expected) end
	if type(actual) == "boolean" then
		if type(expected) == "string" then expected = (expected == "true") end
	end
	assert_true(actual == expected, label)
end

local function assert_child_count(dotPath, minCount, label)
	label = label or (tostring(dotPath) .. " has >= " .. tostring(minCount) .. " children")
	local obj = resolvePathWithRetry(dotPath, 8, 0.5)
	if not obj then
		assert_true(false, label .. " (instance not found)")
		return
	end
	local count = #obj:GetChildren()
	assert_true(count >= minCount, label .. " (got " .. tostring(count) .. ")")
end

-- Create safe SpawnLocation BEFORE player joins so character spawns
-- far from game objects (prevents Touched events corrupting baseline values)
local _existingSpawns = {}
for _, desc in ipairs(workspace:GetDescendants()) do
	if desc:IsA("SpawnLocation") and desc.Enabled then
		desc.Enabled = false
		table.insert(_existingSpawns, desc)
	end
end

local _safeSpawn = Instance.new("SpawnLocation")
_safeSpawn.Name = "_UxRoaISafeSpawn"
_safeSpawn.Anchored = true
_safeSpawn.CanCollide = true
_safeSpawn.Size = Vector3.new(20, 1, 20)
_safeSpawn.Position = Vector3.new(0, 500, 0)
_safeSpawn.Transparency = 1
_safeSpawn.Neutral = true
_safeSpawn.Parent = workspace

log("Safe spawn created at (0, 500, 0), disabled " .. #_existingSpawns .. " existing spawn(s).")

-- Wait for player (with timeout)
local player = Players:GetPlayers()[1]
if not player then
	local waitStart = os.clock()
	local maxWait = 30
	while not player and (os.clock() - waitStart) < maxWait do
		local added = nil
		local conn
		conn = Players.PlayerAdded:Connect(function(p)
			added = p
			if conn then conn:Disconnect() end
		end)
		task.wait(1)
		if conn then conn:Disconnect() end
		if added then
			player = added
		else
			player = Players:GetPlayers()[1]
		end
	end
end

if not player then
	_safeSpawn:Destroy()
	for _, sp in ipairs(_existingSpawns) do
		if sp and sp.Parent then sp.Enabled = true end
	end
	StudioTestService:EndTest({
		ok = false,
		message = "Playtest player not found",
		version = 2,
	})
	return
end

local character, rootPart = waitForCharacter(player, 15)

-- Character has spawned at safe location — restore original spawns
_safeSpawn:Destroy()
for _, sp in ipairs(_existingSpawns) do
	if sp and sp.Parent then sp.Enabled = true end
end
log("Original spawn locations restored.")

if not character then
	StudioTestService:EndTest({
		ok = false,
		message = "Character did not load within timeout",
		version = 2,
	})
	return
end

task.wait(2)

-- Client result storage
local _clientResult = nil
local _clientResultReceived = false

local rootFolder = ReplicatedStorage:FindFirstChild("UxRoaI")
local remoteFunction = rootFolder and rootFolder:FindFirstChild("UxRoaIPlaytestStep")

if remoteFunction and remoteFunction:IsA("RemoteFunction") then
	remoteFunction.OnServerInvoke = function(invokerPlayer, action, data)
		if action == "test_result" and type(data) == "table" then
			_clientResult = data
			_clientResultReceived = true
			return true
		end
		return false
	end
end

-- Execute server test (code injected by installHarness, no loadstring needed)
local serverTestOk = true
local serverTestError = nil

log("Running server test...")
local _serverTestRunOk, _serverTestRunErr = xpcall(function()
--[[UXROAI_SERVER_TEST_CODE]]
end, debug.traceback)

if not _serverTestRunOk then
	serverTestOk = false
	serverTestError = "Server test runtime error: " .. tostring(_serverTestRunErr)
	log("ERROR: " .. serverTestError)
else
	log("Server test completed.")
end

-- Wait for client result if clientTest was provided
if type(args.clientTest) == "string" and args.clientTest ~= "" then
	log("Waiting for client test result...")
	local waitStart = os.clock()
	local clientTimeout = (args.timeoutSeconds or 120) * 0.5
	clientTimeout = math.max(clientTimeout, 15)
	clientTimeout = math.min(clientTimeout, 120)
	while not _clientResultReceived and (os.clock() - waitStart) < clientTimeout do
		task.wait(0.5)
	end
	if not _clientResultReceived then
		log("WARNING: Client test result not received within timeout.")
	else
		log("Client test result received.")
	end
end

-- Merge results
local failedAssertions = {}
for _, entry in ipairs(_assertions) do
	if not entry.passed then
		table.insert(failedAssertions, entry.label)
	end
end

-- Merge client assertions
if type(_clientResult) == "table" then
	if type(_clientResult.assertions) == "table" then
		for _, entry in ipairs(_clientResult.assertions) do
			if type(entry) == "table" then
				table.insert(_assertions, entry)
				if not entry.passed then
					_allPassed = false
					table.insert(failedAssertions, entry.label or "client assertion")
				end
			end
		end
	end
	if type(_clientResult.consoleOutput) == "table" then
		for _, line in ipairs(_clientResult.consoleOutput) do
			table.insert(_consoleOutput, tostring(line))
		end
	end
	if _clientResult.ok == false then
		_allPassed = false
	end
end

if not serverTestOk then
	_allPassed = false
end

-- Disconnect log listener
if _logConnection then
	_logConnection:Disconnect()
end

local finalResult = {
	ok = _allPassed,
	version = 2,
	goal = args.goal,
	assertions = _assertions,
	failedAssertions = failedAssertions,
	consoleOutput = _consoleOutput,
	runtimeWarnings = _runtimeWarnings,
	serverResult = {
		ok = serverTestOk,
		error = serverTestError,
	},
	clientResult = _clientResult,
	finishedAt = os.time(),
}

StudioTestService:EndTest(finalResult)
]=]

-- ═══ CLIENT SCRIPT ═══

HarnessTemplates.ClientScript = [=[
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local UserInputService = game:GetService("UserInputService")
local ProximityPromptService = game:GetService("ProximityPromptService")

local player = Players.LocalPlayer
local rootFolder = ReplicatedStorage:WaitForChild("UxRoaI", 10)
if not rootFolder then
	return
end

local remoteFunction = rootFolder:WaitForChild("UxRoaIPlaytestStep", 10)
if not remoteFunction then
	return
end

-- ── Path helpers ──
local function splitPath(path)
	local segments = {}
	for segment in string.gmatch(path, "[^%.]+") do
		table.insert(segments, segment)
	end
	return segments
end

local function resolveGuiPath(guiPath)
	if type(guiPath) ~= "string" or guiPath == "" then
		return nil
	end
	local current = player:WaitForChild("PlayerGui", 10)
	if not current then
		return nil
	end
	for _, segment in ipairs(splitPath(guiPath)) do
		if segment ~= "PlayerGui" then
			local child = current:FindFirstChild(segment)
			if not child then
				child = current:WaitForChild(segment, 3)
			end
			if not child then
				return nil
			end
			current = child
		end
	end
	return current
end

local function resolveGuiPathWithRetry(guiPath, maxAttempts, delayPerAttempt)
	maxAttempts = maxAttempts or 6
	delayPerAttempt = delayPerAttempt or 0.5
	for attempt = 1, maxAttempts do
		local result = resolveGuiPath(guiPath)
		if result then
			return result
		end
		if attempt < maxAttempts then
			task.wait(delayPerAttempt)
		end
	end
	return nil
end

-- ── Tool helpers ──
local function findTool(toolName)
	local character = player.Character
	if not character then
		character = player.CharacterAdded:Wait(10)
	end
	if not character then return nil end
	local backpack = player:FindFirstChild("Backpack")
	return character:FindFirstChild(toolName) or (backpack and backpack:FindFirstChild(toolName))
end

local function getEquippedTool()
	local character = player.Character
	if not character then
		character = player.CharacterAdded:Wait(10)
	end
	if not character then return nil end
	for _, child in ipairs(character:GetChildren()) do
		if child:IsA("Tool") then
			return child
		end
	end
	return nil
end

local function equipTool(toolName)
	local tool = findTool(toolName)
	if not tool then
		return false, "Tool not found: " .. tostring(toolName)
	end
	local humanoid = player.Character and player.Character:FindFirstChildOfClass("Humanoid")
	if not humanoid then
		return false, "Humanoid not found"
	end
	humanoid:EquipTool(tool)
	task.wait(0.2)
	return true, "Equipped: " .. toolName
end

local function activateTool()
	local tool = getEquippedTool()
	if not tool then
		return false, "No tool equipped"
	end
	tool:Activate()
	task.wait(0.1)
	return true, "Activated: " .. tool.Name
end

-- ── GUI interaction helpers ──
local function clickButton(guiPath)
	local btn = resolveGuiPathWithRetry(guiPath, 6, 0.5)
	if not btn then
		-- Try test hooks as fallback
		local testHooks = rootFolder:FindFirstChild("TestHooks")
		if testHooks then
			local hook = testHooks:FindFirstChild(guiPath)
			if hook and hook:IsA("BindableEvent") then
				hook:Fire()
				task.wait(0.1)
				return true, "Clicked via test hook: " .. guiPath
			end
		end
		return false, "Button not found: " .. tostring(guiPath)
	end
	-- Fire click for GuiButton types
	if btn:IsA("GuiButton") then
		-- Try test hook first (most reliable in Studio playtest)
		local testHooks = rootFolder:FindFirstChild("TestHooks")
		if testHooks then
			local hook = testHooks:FindFirstChild(guiPath)
			if hook and hook:IsA("BindableEvent") then
				hook:Fire()
				task.wait(0.1)
				return true, "Clicked via test hook: " .. guiPath
			end
		end
		-- Fallback: simulate mouse button interaction
		local ok, err = pcall(function()
			-- Use the internal fireClick method if available
			if typeof(btn.Activate) == "function" then
				btn:Activate()
			end
		end)
		if not ok then
			return false, "Could not activate button: " .. tostring(err)
		end
		task.wait(0.1)
		return true, "Clicked: " .. guiPath
	end
	return false, "Not a GuiButton: " .. btn.ClassName
end

local function fireTestHook(hookName)
	local testHooks = rootFolder:FindFirstChild("TestHooks")
	if not testHooks then
		return false, "TestHooks folder not found"
	end
	local hook = testHooks:FindFirstChild(hookName)
	if not hook or not hook:IsA("BindableEvent") then
		return false, "Test hook not found: " .. tostring(hookName)
	end
	hook:Fire()
	task.wait(0.1)
	return true, "Fired test hook: " .. hookName
end

local function readText(guiPath)
	local elem = resolveGuiPathWithRetry(guiPath, 6, 0.5)
	if not elem then
		return nil, "GUI element not found: " .. tostring(guiPath)
	end
	local ok, text = pcall(function() return elem.Text end)
	if ok then
		return text, nil
	end
	-- Try ContentText for RichText
	local ok2, contentText = pcall(function() return elem.ContentText end)
	if ok2 then
		return contentText, nil
	end
	return nil, "Element has no Text property: " .. guiPath
end

local function setInputText(guiPath, text)
	local elem = resolveGuiPathWithRetry(guiPath, 6, 0.5)
	if not elem then
		return false, "GUI element not found: " .. tostring(guiPath)
	end
	if not elem:IsA("TextBox") then
		return false, "Not a TextBox: " .. elem.ClassName
	end
	elem.Text = tostring(text)
	-- Fire FocusLost to trigger any connected handlers
	pcall(function()
		elem:CaptureFocus()
		task.wait(0.1)
		elem:ReleaseFocus(true)
	end)
	task.wait(0.1)
	return true, "Set text: " .. guiPath
end

local function isVisible(guiPath)
	local elem = resolveGuiPathWithRetry(guiPath, 4, 0.3)
	if not elem then
		return false
	end
	-- Walk up the tree checking Visible/Enabled
	local current = elem
	while current do
		if current:IsA("GuiObject") then
			local ok, vis = pcall(function() return current.Visible end)
			if ok and not vis then
				return false
			end
		end
		if current:IsA("LayerCollector") then
			local ok, enabled = pcall(function() return current.Enabled end)
			if ok and not enabled then
				return false
			end
		end
		if current:IsA("PlayerGui") or current:IsA("CoreGui") then
			break
		end
		current = current.Parent
	end
	return true
end

local function waitForGui(guiPath, timeout)
	timeout = timeout or 10
	local startTime = os.clock()
	while (os.clock() - startTime) < timeout do
		local elem = resolveGuiPath(guiPath)
		if elem then
			return elem
		end
		task.wait(0.3)
	end
	return nil
end

local function getGuiProperty(guiPath, property)
	local elem = resolveGuiPathWithRetry(guiPath, 6, 0.5)
	if not elem then
		return nil, "GUI element not found: " .. tostring(guiPath)
	end
	local ok, value = pcall(function() return elem[property] end)
	if not ok then
		return nil, "Cannot read property " .. tostring(property) .. " on " .. guiPath
	end
	return value, nil
end

local function getChildren(guiPath)
	local elem = resolveGuiPathWithRetry(guiPath, 4, 0.3)
	if not elem then
		return {}, "GUI element not found: " .. tostring(guiPath)
	end
	local names = {}
	for _, child in ipairs(elem:GetChildren()) do
		table.insert(names, { name = child.Name, class = child.ClassName })
	end
	return names, nil
end

local function simulateProximityPrompt(promptPath)
	-- Try game path first (ProximityPrompts are typically in Workspace, not PlayerGui)
	local prompt = nil
	local segments = splitPath(promptPath)
	local current = game
	for _, seg in ipairs(segments) do
		if seg ~= "game" then
			current = current:WaitForChild(seg, 3)
			if not current then break end
		end
	end
	prompt = current
	if not prompt then
		-- Fallback: try GUI path
		prompt = resolveGuiPathWithRetry(promptPath, 4, 0.3)
	end
	if not prompt or not prompt:IsA("ProximityPrompt") then
		return false, "ProximityPrompt not found: " .. tostring(promptPath)
	end
	-- Fire the triggered signal
	pcall(function()
		prompt:InputHoldBegin()
		task.wait(prompt.HoldDuration + 0.1)
		prompt:InputHoldEnd()
	end)
	task.wait(0.2)
	return true, "Triggered ProximityPrompt: " .. promptPath
end

-- ── Test framework ──
local _consoleOutput = {}
local _assertions = {}
local _allPassed = true

local function log(message)
	local line = "[CLIENT] " .. tostring(message)
	table.insert(_consoleOutput, line)
	print(line)
end

local function assert_true(condition, label)
	label = tostring(label or "assertion")
	local entry = { label = label, passed = condition and true or false }
	table.insert(_assertions, entry)
	if not entry.passed then
		_allPassed = false
		log("FAIL: " .. label)
	else
		log("PASS: " .. label)
	end
end

local function assert_gui_exists(guiPath, label)
	label = label or ("gui exists: " .. tostring(guiPath))
	local elem = resolveGuiPathWithRetry(guiPath, 8, 0.5)
	assert_true(elem ~= nil, label)
end

local function assert_gui_not_exists(guiPath, label)
	label = label or ("gui not exists: " .. tostring(guiPath))
	task.wait(0.5)
	local elem = resolveGuiPath(guiPath)
	assert_true(elem == nil, label)
end

local function assert_gui_visible(guiPath, label)
	label = label or ("gui visible: " .. tostring(guiPath))
	assert_true(isVisible(guiPath), label)
end

local function assert_gui_not_visible(guiPath, label)
	label = label or ("gui not visible: " .. tostring(guiPath))
	assert_true(not isVisible(guiPath), label)
end

local function assert_gui_text(guiPath, expected, label)
	label = label or (tostring(guiPath) .. ".Text == " .. tostring(expected))
	local text, err = readText(guiPath)
	if err then
		assert_true(false, label .. " (" .. err .. ")")
		return
	end
	assert_true(tostring(text) == tostring(expected), label .. " (got: " .. tostring(text) .. ")")
end

local function assert_gui_text_contains(guiPath, substring, label)
	label = label or (tostring(guiPath) .. ".Text contains " .. tostring(substring))
	local text, err = readText(guiPath)
	if err then
		assert_true(false, label .. " (" .. err .. ")")
		return
	end
	assert_true(string.find(tostring(text), tostring(substring), 1, true) ~= nil, label .. " (got: " .. tostring(text) .. ")")
end

local function assert_gui_property(guiPath, property, expected, label)
	label = label or (tostring(guiPath) .. "." .. tostring(property) .. " == " .. tostring(expected))
	local value, err = getGuiProperty(guiPath, property)
	if err then
		assert_true(false, label .. " (" .. err .. ")")
		return
	end
	if type(value) == "number" then expected = tonumber(expected) end
	if type(value) == "boolean" then
		if type(expected) == "string" then expected = (expected == "true") end
	end
	assert_true(value == expected, label)
end

-- Execute client test (code injected by installHarness, no loadstring needed)
log("Running client test...")

local testError = nil
local _clientTestRunOk, _clientTestRunErr = xpcall(function()
--[[UXROAI_CLIENT_TEST_CODE]]
end, debug.traceback)

if not _clientTestRunOk then
	_allPassed = false
	testError = "Client test runtime error: " .. tostring(_clientTestRunErr)
	log("ERROR: " .. testError)
else
	log("Client test completed.")
end

-- Send results to server via RemoteFunction
local resultData = {
	ok = _allPassed,
	assertions = _assertions,
	consoleOutput = _consoleOutput,
	error = testError,
}

pcall(function()
	remoteFunction:InvokeServer("test_result", resultData)
end)
]=]

return HarnessTemplates
