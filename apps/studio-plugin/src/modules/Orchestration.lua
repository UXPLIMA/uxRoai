local HttpService = game:GetService("HttpService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")

local M = {}

local currentDesktopTaskId = nil

-- Unique studio session ID for multi-studio conflict detection
local studioSessionId = "studio_" .. tostring(game.PlaceId) .. "_" .. tostring(os.time()) .. "_" .. tostring(math.random(1000, 9999))

local function requestJson(route, payload, method)
	local httpMethod = method or "POST"
	local url = Utils.normalizeAgentUrl(UI.urlBox.Text) .. route
	local request = {
		Url = url,
		Method = httpMethod,
		Headers = {
			["Content-Type"] = "application/json",
		},
	}

	if payload ~= nil then
		request.Body = HttpService:JSONEncode(payload)
	end

	local response = HttpService:RequestAsync(request)

	if not response.Success then
		-- Try to extract a more informative error from the response body
		local decoded = {}
		pcall(function()
			if response.Body and response.Body ~= "" then
				decoded = HttpService:JSONDecode(response.Body)
			end
		end)
		local detail = decoded.error or tostring(response.StatusMessage)
		error("HTTP request failed: " .. tostring(response.StatusCode) .. " " .. detail)
	end

	local decoded = {}
	if response.Body and response.Body ~= "" then
		decoded = HttpService:JSONDecode(response.Body)
	end

	return decoded
end

local function trimToLastN(list, n)
	local trimmed = {}
	local startIdx = math.max(1, #list - n + 1)
	for i = startIdx, #list do
		trimmed[#trimmed + 1] = list[i]
	end
	return trimmed
end

local progressBuffer = {}
local progressFlushScheduled = false
local PROGRESS_FLUSH_INTERVAL = 0.3

local function flushProgressBuffer()
	progressFlushScheduled = false
	if #progressBuffer == 0 then
		return
	end
	local taskId = currentDesktopTaskId
	if not taskId then
		progressBuffer = {}
		return
	end
	local batch = progressBuffer
	progressBuffer = {}
	task.spawn(function()
		pcall(function()
			if #batch == 1 then
				requestJson("/v1/studio/tasks/" .. tostring(taskId) .. "/progress", batch[1])
			else
				requestJson("/v1/studio/tasks/" .. tostring(taskId) .. "/progress", { batch = batch })
			end
		end)
	end)
end

local function reportProgress(message, progressType, index, total, actionMeta)
	if not currentDesktopTaskId then
		return
	end
	local payload = {
		message = tostring(message or ""),
		type = tostring(progressType or "info"),
	}
	if index ~= nil then
		payload.index = index
	end
	if total ~= nil then
		payload.total = total
	end
	if type(actionMeta) == "table" then
		if actionMeta.actionType then
			payload.actionType = tostring(actionMeta.actionType)
		end
		if actionMeta.actionName then
			payload.actionName = tostring(actionMeta.actionName)
		end
		if actionMeta.actionPath then
			payload.actionPath = tostring(actionMeta.actionPath)
		end
	end
	table.insert(progressBuffer, payload)
	if #progressBuffer > Constants.PROGRESS_BUFFER_MAX then
		progressBuffer = trimToLastN(progressBuffer, Constants.PROGRESS_BUFFER_TRIM)
	end

	if progressType == "playtest" or progressType == "summary" or progressType == "thinking" then
		flushProgressBuffer()
	elseif not progressFlushScheduled then
		progressFlushScheduled = true
		task.delay(PROGRESS_FLUSH_INTERVAL, flushProgressBuffer)
	end
end

local function isTaskStopped()
	if not currentDesktopTaskId then
		return false
	end
	local ok, response = pcall(function()
		return requestJson("/v1/studio/tasks/" .. tostring(currentDesktopTaskId), nil, "GET")
	end)
	if ok and type(response) == "table" and type(response.task) == "table" then
		return response.task.status == "stopped"
	end
	return false
end

function M.refreshAgentHealth(logResult)
	local ok = pcall(function()
		requestJson("/health", nil, "GET")
	end)

	UI.updateAgentStatusLabel(ok)
	if logResult then
		if ok then
			UI.appendLog(I18N.t("logHealthOnline"))
		else
			UI.appendLog(I18N.t("logHealthOffline"))
		end
	end

	return ok
end

local function dispatchAction(action, planPlaytest)
	-- Handle run_playtest specially since Playtest module is separate from ActionHandlers
	if action.type == "run_playtest" then
		local scenario = action.scenario or {}
		local hasV2 = type(scenario.serverTest) == "string" and scenario.serverTest ~= ""
		if not hasV2 and (type(scenario.steps) ~= "table" or #scenario.steps == 0) then
			if type(action._planPlaytest) == "table" then
				local planHasV2 = type(action._planPlaytest.serverTest) == "string" and action._planPlaytest.serverTest ~= ""
				local planHasV1 = type(action._planPlaytest.steps) == "table" and #action._planPlaytest.steps > 0
				if planHasV2 or planHasV1 then
					scenario = action._planPlaytest
				end
			end
		end
		local playtestResult = Playtest.executePlaytest(scenario)
		return {
			type = "run_playtest",
			summary = "Playtest executed",
			playtestResult = playtestResult,
		}
	end

	return ActionHandlers.applyAction(action)
end

local function executePromptPlan(prompt, conversationHistory, maxAttempts, minPlaytestSec, planTimeoutSec)
	maxAttempts = maxAttempts or Constants.AUTO_REPAIR_MAX_ATTEMPTS
	minPlaytestSec = minPlaytestSec or 10
	planTimeoutSec = planTimeoutSec or 600
	local normalizedUrl = Utils.saveAgentUrl(UI.urlBox.Text)
	UI.urlBox.Text = normalizedUrl

	local function pushUnique(list, seenMap, value)
		local text = tostring(value or "")
		if text == "" then
			return
		end
		if not seenMap[text] then
			seenMap[text] = true
			table.insert(list, text)
		end
	end

	local function summarizeIssues(issues)
		local summaryLines = {}
		local maxLines = math.min(#issues, Constants.AUTO_REPAIR_ISSUE_LIMIT)
		for index = 1, maxLines do
			table.insert(summaryLines, tostring(issues[index]))
		end
		return summaryLines
	end

	local function buildRepairPrompt(basePrompt, issues, attemptIndex)
		if attemptIndex <= 1 or #issues == 0 then
			return basePrompt
		end

		local lines = {
			"",
			"[AUTO-FIX RETRY]",
			"This is retry attempt " .. tostring(attemptIndex) .. " for the same feature request.",
			"",
			"DIAGNOSTIC INSTRUCTIONS (follow carefully):",
			"1. Read EVERY error message below carefully. Pay attention to script names, line numbers, and the exact error text.",
			"2. 'attempt to call a nil value' means you called a function that does NOT EXIST. Find the exact function call at that line and replace it with a valid API.",
			"3. 'attempt to index nil' means you accessed a property on something that is nil. Check the variable/path is correct.",
			"4. Do NOT guess fixes. Trace the error to the exact line in YOUR generated code and fix the root cause.",
			"5. Do NOT make unrelated changes (like changing CFrame to Position) unless the error message specifically points to that.",
			"6. Common Luau API mistakes: task.time() does NOT exist (use os.clock() or tick()), math.random(float, float) is WRONG for integer ranges (use math.random(int, int)).",
			"",
			"PLAYTEST ASSERTION FAILURES:",
			"7. If a playtest assertion failed but the feature itself works correctly, the problem is the TEST, not the code.",
			"8. Common false failures: checking initial values (e.g. Score==0) when Touched events fire at spawn. Fix by adjusting the playtest goal/assertions, NOT by changing game code.",
			"9. If the same playtest assertion keeps failing across retries, REMOVE that assertion from the goal or replace it with a different check.",
			"10. NEVER use Players:WaitForChild('Player1') or hardcoded player names in test code. The `player` variable is already available. Use player.Name to build paths.",
			"11. NEVER call functions not listed in the playtest helpers. If you see 'attempt to call a nil value', the function does not exist — use only the helpers listed in the prompt.",
			"12. Do NOT assert RespawnLocation, BestTime, or timing-dependent state changes. Simplify assertions to existence checks and before/after value comparisons.",
			"",
			"Fix the listed issues with minimal corrective actions.",
			"Do not recreate unrelated systems.",
			"Use exact Roblox value types for properties: Color3, UDim2, UDim, Vector2, Vector3, NumberSequence, NumberRange, ColorSequence.",
			"Ensure GUI objects are created under game.StarterGui (or its descendants), not Workspace.",
			"",
			"Issues from previous attempt:",
		}

		for _, issue in ipairs(issues) do
			table.insert(lines, "- " .. tostring(issue))
		end

		return tostring(basePrompt) .. "\n" .. table.concat(lines, "\n")
	end

	local finalSummary = ""
	local latestPlaytestResult = nil
	local allChanges = {}
	local warningList = {}
	local warningSeen = {}
	local unresolvedIssues = {}
	local totalActionCount = 0
	local attemptsUsed = 0
	local previousIssues = {}
	local previousIssueFingerprint = nil
	local sameFailureCount = 0

	local stopped = false

	UI.planWaypointCount = 0
	UI.recordWaypoint("uxRoai: before plan")

	for attempt = 1, maxAttempts do
		if isTaskStopped() then
			UI.appendLog("Task stopped by user, aborting execution")
			table.insert(warningList, "Stopped by user")
			stopped = true
			break
		end
		attemptsUsed = attempt
		UI.appendLog(I18N.t("logPlanAttempt", { attempt = tostring(attempt), max = tostring(maxAttempts) }))

		UI.appendLog(I18N.t("logSnapshot"))
		local studioContext = Serialization.buildStudioContext()
		if #previousIssues > 0 then
			studioContext.repairFeedback = {
				attempt = attempt,
				maxAttempts = maxAttempts,
				issues = previousIssues,
			}
		end

		if attempt > 1 then
			reportProgress("Retrying (attempt " .. tostring(attempt) .. "/" .. tostring(maxAttempts) .. ")...", "retry")
		end

		reportProgress("Generating plan...", "info")
		UI.appendLog(I18N.t("logPlanRequest", { url = normalizedUrl }))
		local planBody = {
			prompt = buildRepairPrompt(prompt, previousIssues, attempt),
			studioContext = studioContext,
		}
		if type(conversationHistory) == "table" and #conversationHistory > 0 then
			planBody.history = conversationHistory
		end
		if currentDesktopTaskId then
			planBody.taskId = currentDesktopTaskId
		end

		planBody.async = true

		local planResponse = nil
		local planError = nil
		local planDone = false
		task.spawn(function()
			local ok, result = pcall(requestJson, "/v1/plan", planBody)
			if ok then
				planResponse = result
			else
				planError = result
			end
			planDone = true
		end)
		local thinkingTick = 0
		while not planDone do
			task.wait(2)
			thinkingTick = thinkingTick + 1
			reportProgress("AI is thinking... (" .. tostring(thinkingTick * 2) .. "s)", "thinking")
		end
		if planError then
			error(planError)
		end

		if type(planResponse) == "table" and planResponse.pending == true and planResponse.jobId then
			local jobId = planResponse.jobId
			local pollStart = os.clock()
			local maxPollTime = planTimeoutSec
			UI.appendLog("Plan processing async (job=" .. tostring(jobId) .. "), polling for result...")
			local consecutiveErrors = 0
			while os.clock() - pollStart < maxPollTime do
				if isTaskStopped() then break end
				task.wait(3)
				thinkingTick = thinkingTick + 1
				reportProgress("AI is thinking... (" .. tostring(math.floor(os.clock() - pollStart)) .. "s)", "thinking")
				local pollOk, pollResult = pcall(requestJson, "/v1/plan/result/" .. tostring(jobId), nil, "GET")
				if pollOk and type(pollResult) == "table" then
					consecutiveErrors = 0
					-- Job aborted by user stop — break gracefully
					if pollResult.aborted then
						break
					end
					if not pollResult.pending then
						planResponse = pollResult
						break
					end
				elseif not pollOk then
					-- Check if task was stopped before treating poll error as fatal
					if isTaskStopped() then break end
					consecutiveErrors = consecutiveErrors + 1
					local errStr = tostring(pollResult)
					UI.appendLog("Poll error: " .. errStr)
					-- Job aborted by user stop — not a real error
					if errStr:match("aborted") or errStr:match("stopped by user") then
						break
					end
					-- Job not found (404) or server error (500) — stop polling
					if errStr:match("404") or errStr:match("Not Found") then
						error("AI job lost (404 Not Found). The provider may have crashed. Job: " .. tostring(jobId))
					end
					if errStr:match("500") or errStr:match("Internal Server Error") then
						if isTaskStopped() then break end
						error("AI provider error (500). Job: " .. tostring(jobId))
					end
					-- Too many consecutive unknown errors — bail out
					if consecutiveErrors >= 5 then
						error("Too many consecutive poll errors (" .. tostring(consecutiveErrors) .. "). Last: " .. errStr)
					end
				end
			end
			if isTaskStopped() then
				UI.appendLog("Task stopped by user during AI generation")
				table.insert(warningList, "Stopped by user")
				stopped = true
				break
			end
			if type(planResponse) == "table" and planResponse.pending then
				error("Plan timed out after " .. tostring(maxPollTime) .. "s")
			end
		end

		if stopped then
			break
		end

		local response = planResponse

		local plan = response.plan or response
		if type(plan) ~= "table" then
			error("Invalid plan response")
		end

		if currentDesktopTaskId and attempt == 1 then
			local submitOk = pcall(requestJson, "/v1/studio/tasks/" .. tostring(currentDesktopTaskId) .. "/submit-plan", {
				plan = plan,
			})
			if submitOk then
				reportProgress("Plan ready — waiting for approval...", "plan_waiting")
				UI.appendLog("Plan submitted for approval, waiting for user decision...")

				local decision = nil
				local maxWaitTime = planTimeoutSec
				local waitStart = os.clock()

				while os.clock() - waitStart < maxWaitTime do
					if isTaskStopped() then
						break
					end

					local awaitOk, awaitResp = pcall(requestJson, "/v1/studio/tasks/" .. tostring(currentDesktopTaskId) .. "/await-approval", {
						timeoutSeconds = 30,
					})

					if awaitOk and type(awaitResp) == "table" and awaitResp.decision then
						decision = awaitResp.decision
						break
					end

					task.wait(1)
				end

				if not decision or decision.approved == false then
					UI.appendLog("Plan rejected or timed out")
					table.insert(warningList, "Plan rejected by user")
					stopped = true
					break
				end

				if type(decision.plan) == "table" then
					plan = decision.plan
				end
				UI.appendLog("Plan approved by user, executing...")
			end
		end

		finalSummary = tostring(plan.summary or finalSummary)
		UI.appendLog("Plan summary: " .. tostring(plan.summary))

		local actions = type(plan.actions) == "table" and plan.actions or {}
		reportProgress(tostring(plan.summary or "plan"), "summary")
		reportProgress(tostring(#actions) .. " actions to execute", "info")

		local planWarnings = type(plan.warnings) == "table" and plan.warnings or {}
		for _, warning in ipairs(planWarnings) do
			local text = tostring(warning)
			UI.appendLog(I18N.t("logWarningPrefix", { warning = text }))
			pushUnique(warningList, warningSeen, text)
		end

		local hasRunPlaytestAction = false
		totalActionCount = totalActionCount + #actions
		local attemptPlaytestResult = nil
		local attemptChanges = {}
		local actionCount = #actions

		if actionCount >= 15 then
			local typeCounts = {}
			for _, a in ipairs(actions) do
				local at = tostring(a.type or "unknown")
				typeCounts[at] = (typeCounts[at] or 0) + 1
			end
			local phaseInfo = {}
			for at, c in pairs(typeCounts) do
				table.insert(phaseInfo, at .. ":" .. tostring(c))
			end
			reportProgress("Large plan (" .. tostring(actionCount) .. " actions: " .. table.concat(phaseInfo, ", ") .. ")", "info")
		end

		local planPlaytest = type(plan.playtest) == "table" and plan.playtest or nil
		for actionIdx, action in ipairs(actions) do
			if isTaskStopped() then
				UI.appendLog("Task stopped by user, aborting execution")
				table.insert(warningList, "Stopped by user")
				stopped = true
				break
			end
			if action.type == "run_playtest" and planPlaytest then
				action._planPlaytest = planPlaytest
			end
			local actionName = tostring(action.name or action.className or action.type or "")
			local actionPath = tostring(action.parentPath or action.path or "")
			if actionName ~= "" and actionPath ~= "" then
				actionPath = actionPath .. "." .. actionName
			elseif actionName ~= "" then
				actionPath = actionName
			end
			if action.type == "run_playtest" then
				local scenario = action.scenario or {}
				local scenarioIsV2 = type(scenario.serverTest) == "string" and scenario.serverTest ~= ""
				if scenarioIsV2 then
					reportProgress("Running playtest V2 (Lua test code)...", "playtest", actionIdx, actionCount)
				else
					local stepCount = 0
					if type(scenario.steps) == "table" then
						stepCount = #scenario.steps
					end
					reportProgress("Running playtest (" .. tostring(stepCount) .. " steps)...", "playtest", actionIdx, actionCount)
				end
			else
				reportProgress(tostring(actionIdx) .. "/" .. tostring(actionCount) .. " " .. tostring(action.type) .. ": " .. actionName, "action", actionIdx, actionCount, {
					actionType = action.type,
					actionName = actionName,
					actionPath = actionPath,
				})
			end
			local actionOk, actionResponse = pcall(function()
				return dispatchAction(action, planPlaytest)
			end)
			if actionOk then
				local actionResult = actionResponse
				if type(actionResult) == "table" then
					table.insert(attemptChanges, actionResult)
					if actionResult.playtestResult ~= nil then
						attemptPlaytestResult = actionResult.playtestResult
						if type(actionResult.playtestResult) == "table" and actionResult.playtestResult.ok == true then
							reportProgress("Playtest passed", "playtest")
						elseif type(actionResult.playtestResult) == "table" and actionResult.playtestResult.ok == false then
							reportProgress("Playtest failed: " .. tostring(actionResult.playtestResult.errorSummary or "errors detected"), "playtest")
						end
					end
				end
			else
				local actionError = tostring(actionResponse)
				local warningText = "Action failed (" .. tostring(action.type or "unknown") .. "): " .. actionError
				UI.appendLog(
					I18N.t("logWarningPrefix", {
						warning = warningText,
					})
				)
				table.insert(attemptChanges, {
					type = tostring(action.type or "action"),
					summary = "Action failed",
					details = {
						error = actionError,
					},
				})
			end
			if action.type == "run_playtest" then
				hasRunPlaytestAction = true
			end
		end

		if stopped then
			break
		end

		if not hasRunPlaytestAction and type(plan.playtest) == "table" then
			local steps = type(plan.playtest.steps) == "table" and plan.playtest.steps or {}
			local hasV2Test = type(plan.playtest.serverTest) == "string" and plan.playtest.serverTest ~= ""
			local hasV1Steps = #steps > 0
			if hasV1Steps or hasV2Test then
				if hasV2Test then
					reportProgress("Running playtest V2 (Lua test code)...", "playtest")
				else
					reportProgress("Running playtest (" .. tostring(#steps) .. " steps)...", "playtest")
				end
				UI.appendLog(I18N.t("logPlanAutoPlaytest"))
				attemptPlaytestResult = Playtest.executePlaytest(plan.playtest)
				table.insert(attemptChanges, {
					type = "run_playtest",
					summary = "Plan-level playtest executed",
					playtestResult = attemptPlaytestResult,
				})
				if type(attemptPlaytestResult) == "table" and attemptPlaytestResult.ok == true then
					reportProgress("Playtest passed", "playtest")
				elseif type(attemptPlaytestResult) == "table" and attemptPlaytestResult.ok == false then
					reportProgress("Playtest failed: " .. tostring(attemptPlaytestResult.errorSummary or "errors detected"), "playtest")
				end
			end
		end

		if attemptPlaytestResult ~= nil then
			latestPlaytestResult = attemptPlaytestResult
		end

		for _, entry in ipairs(attemptChanges) do
			table.insert(allChanges, entry)
		end

		local playtestPassed = type(attemptPlaytestResult) == "table" and attemptPlaytestResult.ok == true
		local issues = Playtest.collectExecutionIssues(attemptChanges, playtestPassed)
		unresolvedIssues = issues
		for _, issue in ipairs(issues) do
			UI.appendLog(I18N.t("logWarningPrefix", { warning = issue }))
			pushUnique(warningList, warningSeen, issue)
		end

		if #issues == 0 then
			break
		end

		-- Normalize issues for fingerprinting: strip line numbers, stack traces, timing info
		local function normalizeForFingerprint(text)
			local s = tostring(text)
			s = s:gsub(":%d+:", ":_:") -- strip line numbers like :42:
			s = s:gsub("line %d+", "line _") -- strip "line 42"
			s = s:gsub("%d+%.%d+s", "_s") -- strip timing like 1.5s
			s = s:gsub("%(last %d+ lines%)", "(last _ lines)") -- strip console line counts
			return s
		end
		local normalizedIssues = {}
		for _, iss in ipairs(issues) do
			table.insert(normalizedIssues, normalizeForFingerprint(iss))
		end
		local issueFingerprint = table.concat(normalizedIssues, "|")
		if attempt > 1 and issueFingerprint == previousIssueFingerprint then
			sameFailureCount = sameFailureCount + 1
			if sameFailureCount >= 1 then
				UI.appendLog("Same failure repeated " .. tostring(sameFailureCount + 1) .. " times, stopping auto-repair.")
				pushUnique(warningList, warningSeen, "Auto-repair stopped: identical failure repeated (likely an environment/timing limitation, not a code bug)")
				break
			end
		else
			sameFailureCount = 0
		end
		previousIssueFingerprint = issueFingerprint

		if attempt < maxAttempts then
			UI.appendLog(
				I18N.t("logPlanRepairRetry", {
					nextAttempt = tostring(attempt + 1),
					max = tostring(maxAttempts),
				})
			)
			previousIssues = summarizeIssues(issues)
		end
	end

	flushProgressBuffer()

	UI.recordWaypoint("uxRoai: plan complete")

	return {
		ok = not stopped and #unresolvedIssues == 0,
		summary = finalSummary,
		warnings = warningList,
		actionCount = totalActionCount,
		playtestResult = latestPlaytestResult,
		changes = allChanges,
		actions = allChanges,
		issues = unresolvedIssues,
		attempts = attemptsUsed,
	}
end

local function runPlanFlow()
	local prompt = Utils.trim(UI.promptBox.Text or "")
	if prompt == "" then
		error("Prompt cannot be empty")
	end

	local result = executePromptPlan(prompt)
	if result.ok == false then
		error("Plan execution finished with validation errors")
	end
end

local function runPlaytestOnlyFlow()
	local prompt = Utils.trim(UI.promptBox.Text or "")
	if prompt == "" then
		error("Test goal cannot be empty")
	end

	local normalizedUrl = Utils.saveAgentUrl(UI.urlBox.Text)
	UI.urlBox.Text = normalizedUrl

	local studioContext = Serialization.buildStudioContext()

	UI.appendLog(I18N.t("logPlaytestRequest", { url = normalizedUrl }))
	local response = requestJson("/v1/playtests", {
		goal = prompt,
		studioContext = studioContext,
	})

	local playtest = response.playtest or response
	if type(playtest) ~= "table" then
		error("Invalid playtest response")
	end

	if type(playtest.warnings) == "table" then
		for _, warning in ipairs(playtest.warnings) do
			UI.appendLog(I18N.t("logWarningPrefix", { warning = tostring(warning) }))
		end
	end

	local result = Playtest.executePlaytest(playtest)
	if type(result) == "table" and result.ok == false then
		error("Playtest failed: " .. tostring(result.errorSummary or "runtime errors detected"))
	end
end

local function runDesktopInboxFlow(options)
	local opts = type(options) == "table" and options or {}
	local silentQueueClaim = opts.silentQueueClaim == true
	local silentQueueEmpty = opts.silentQueueEmpty == true
	local healthLog = opts.healthLog ~= false

	local normalizedUrl = Utils.saveAgentUrl(UI.urlBox.Text)
	UI.urlBox.Text = normalizedUrl

	if not M.refreshAgentHealth(healthLog) then
		return false
	end

	if not silentQueueClaim then
		UI.appendLog(I18N.t("logQueueClaim"))
	end
	local claimResponse = requestJson("/v1/studio/tasks/claim", {
		workerId = "uxroai-studio-plugin",
		workerVersion = "0.1.0",
		studioId = studioSessionId,
		longPoll = true,
		timeoutSeconds = 20,
	})

	-- Multi-studio conflict warning
	if claimResponse.conflict then
		UI.appendLog(I18N.t("logWarningPrefix", {
			warning = "Multiple Roblox Studio instances detected! Tasks may conflict.",
		}))
	end

	local claimedTask = claimResponse.task
	if type(claimedTask) ~= "table" then
		if not silentQueueEmpty then
			UI.appendLog(I18N.t("logQueueEmpty"))
		end
		return false
	end

	UI.appendLog(I18N.t("logTaskClaimed", { id = tostring(claimedTask.id) }))
	currentDesktopTaskId = tostring(claimedTask.id)
	local prompt = tostring(claimedTask.prompt or "")

	if prompt == "__undo__" then
		local undoSteps = UI.planWaypointCount
		if undoSteps <= 0 then
			-- Nothing to undo
			local reportPayload = {
				ok = true,
				summary = "Nothing to undo (no previous plan in this session)",
				warnings = {},
				actionCount = 0,
				playtestResult = nil,
				changes = {},
				actions = {},
				logs = UI.copyRecentLogLines(10),
				metadata = { worker = "uxroai-studio-plugin", reportedAt = os.time() },
			}
			pcall(requestJson, "/v1/studio/tasks/" .. tostring(claimedTask.id) .. "/result", reportPayload, "POST")
			currentDesktopTaskId = nil
			UI.appendLog("Nothing to undo — no waypoints recorded")
			return
		end
		undoSteps = math.min(undoSteps, 200)
		UI.appendLog("Undoing " .. tostring(undoSteps) .. " waypoint(s)...")
		local undoOk, undoErr = pcall(function()
			for _ = 1, undoSteps do
				ChangeHistoryService:Undo()
			end
		end)
		-- Store count before reset so second undo can redo the same plan via Roblox undo history
		local previousCount = UI.planWaypointCount
		UI.planWaypointCount = 0
		local reportPayload = {
			ok = undoOk,
			summary = undoOk and ("Undo completed (" .. tostring(undoSteps) .. " steps)") or ("Undo failed: " .. tostring(undoErr)),
			warnings = {},
			actionCount = 0,
			playtestResult = nil,
			changes = {},
			actions = {},
			logs = UI.copyRecentLogLines(10),
			metadata = { worker = "uxroai-studio-plugin", reportedAt = os.time() },
		}
		pcall(requestJson, "/v1/studio/tasks/" .. tostring(claimedTask.id) .. "/result", reportPayload, "POST")
		currentDesktopTaskId = nil
		if undoOk then
			UI.appendLog("Undo completed: " .. tostring(undoSteps) .. " steps reverted")
		else
			UI.appendLog("Undo failed: " .. tostring(undoErr))
		end
		return
	end

	local taskHistory = type(claimedTask.history) == "table" and claimedTask.history or {}
	local taskMaxRetries = tonumber(claimedTask.maxRetries) or Constants.AUTO_REPAIR_MAX_ATTEMPTS
	local taskMinPlaytestSec = tonumber(claimedTask.minPlaytestSeconds) or 10
	local taskPlanTimeoutSec = tonumber(claimedTask.planTimeoutSec) or 600
	local ok, executionResult = pcall(function()
		return executePromptPlan(prompt, taskHistory, taskMaxRetries, taskMinPlaytestSec, taskPlanTimeoutSec)
	end)

	local reportPayload
	if ok then
		reportPayload = executionResult
		reportPayload.ok = executionResult.ok ~= false
	else
		reportPayload = {
			ok = false,
			summary = tostring(executionResult),
			warnings = { "Plan execution failed in the Studio plugin" },
			actionCount = 0,
			playtestResult = nil,
		}
	end

	reportPayload.logs = UI.copyRecentLogLines(80)
	reportPayload.metadata = {
		worker = "uxroai-studio-plugin",
		reportedAt = os.time(),
	}

	currentDesktopTaskId = nil
	requestJson("/v1/studio/tasks/" .. tostring(claimedTask.id) .. "/result", reportPayload, "POST")
	UI.appendLog(I18N.t("logTaskReported", { id = tostring(claimedTask.id) }))
	return true
end

function M.runWithGuard(work)
	if UI.getIsBusy() then
		UI.appendLog(I18N.t("logBusyWait"))
		return
	end

	UI.setBusy(true)
	task.spawn(function()
		local ok, err = pcall(work)
		if not ok then
			UI.appendLog(I18N.t("logErrorPrefix", { error = tostring(err) }))
		end
		UI.setBusy(false)
	end)
end

M.runPlanFlow = runPlanFlow
M.runPlaytestOnlyFlow = runPlaytestOnlyFlow

local autoInboxStarted = false
function M.startAutoInboxPolling()
	if autoInboxStarted or not Constants.APP_FIRST_PLUGIN_MODE then
		return
	end
	autoInboxStarted = true
	UI.appendLog(I18N.t("logAutoInboxEnabled", { seconds = tostring(Constants.AUTO_INBOX_POLL_SECONDS) }))

	local stopPolling = false
	local unloadConn = plugin.Unloading:Connect(function()
		stopPolling = true
	end)
	task.spawn(function()
		while not stopPolling do
			task.wait(Constants.AUTO_INBOX_POLL_SECONDS)
			if stopPolling then break end
			if not UI.widget.Enabled then
				continue
			end
			if UI.getIsBusy() then
				continue
			end
			UI.setBusy(true)
			local ok, err = pcall(function()
				runDesktopInboxFlow({
					silentQueueClaim = true,
					silentQueueEmpty = true,
					healthLog = false,
				})
			end)
			if not ok then
				UI.appendLog(I18N.t("logErrorPrefix", { error = tostring(err) }))
			end
			UI.setBusy(false)
		end
	end)
end

function M.installHarnessManual()
	Playtest.installHarness()
end

return M
