local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ScriptEditorService = game:GetService("ScriptEditorService")

local M = {}

local BLOCK_OPENER_PATTERNS = {
	"^function%s+[%w_]",
	"^local%s+function%s+[%w_]",
}
local BLOCK_KEYWORD_PATTERNS = {
	"%sdo$", "%sthen$", "^do$", "^then$", "^repeat$", "%srepeat$",
}
local BLOCK_CLOSER_PATTERNS = {
	"^end$", "^end[%s,%)%;]", "^until%s",
}

function M.splitLines(source)
	local normalized = (source or ""):gsub("\r\n", "\n"):gsub("\r", "\n")
	local endsWithNewline = normalized:sub(-1) == "\n"

	local lines = {}
	local start = 1
	while true do
		local newlinePos = string.find(normalized, "\n", start, true)
		if newlinePos then
			table.insert(lines, string.sub(normalized, start, newlinePos - 1))
			start = newlinePos + 1
		else
			local remainder = string.sub(normalized, start)
			if remainder ~= "" or not endsWithNewline then
				table.insert(lines, remainder)
			end
			break
		end
	end
	if #lines == 0 then
		table.insert(lines, "")
	end
	return lines, endsWithNewline
end

function M.joinLines(lines, hadTrailingNewline)
	local source = table.concat(lines, "\n")
	if hadTrailingNewline and source:sub(-1) ~= "\n" then
		source = source .. "\n"
	end
	return source
end

function M.lintLuauSource(source)
	local warnings = {}
	if type(source) ~= "string" or #source == 0 then
		return warnings
	end

	local stack = {}
	local bracketMap = { ["("] = ")", ["["] = "]", ["{"] = "}" }
	local closeBracket = { [")"] = "(", ["]"] = "[", ["}"] = "{" }
	local lineNum = 1
	local inString = false
	local stringChar = nil
	local inComment = false
	local inBlockComment = false
	local i = 1
	local blockClosePattern = nil  -- set when entering block comment/string
	local inLongString = false

	while i <= #source do
		local ch = string.sub(source, i, i)
		if ch == "\n" then
			lineNum = lineNum + 1
			if not inBlockComment and not inLongString then
				inComment = false
			end
		end
		if inBlockComment or inLongString then
			-- Check for matching close pattern
			if blockClosePattern and string.sub(source, i, i + #blockClosePattern - 1) == blockClosePattern then
				inBlockComment = false
				inLongString = false
				i = i + #blockClosePattern
				blockClosePattern = nil
			else
				i = i + 1
			end
		elseif inString then
			if ch == "\\" then
				i = i + 2
			elseif ch == stringChar then
				inString = false
				i = i + 1
			else
				i = i + 1
			end
		elseif inComment then
			i = i + 1
		else
			-- Check for block comments: --[[ or --[=[
			if string.sub(source, i, i + 4) == "--[=[" then
				inBlockComment = true
				blockClosePattern = "]=]"
				i = i + 5
			elseif string.sub(source, i, i + 3) == "--[[" then
				inBlockComment = true
				blockClosePattern = "]]"
				i = i + 4
			elseif string.sub(source, i, i + 1) == "--" then
				inComment = true
				i = i + 2
			-- Check for long strings: [=[ or [[
			elseif string.sub(source, i, i + 2) == "[=[" then
				inLongString = true
				blockClosePattern = "]=]"
				i = i + 3
			elseif string.sub(source, i, i + 1) == "[[" then
				inLongString = true
				blockClosePattern = "]]"
				i = i + 2
			elseif ch == '"' or ch == "'" then
				inString = true
				stringChar = ch
				i = i + 1
			elseif bracketMap[ch] then
				table.insert(stack, { char = ch, line = lineNum })
				i = i + 1
			elseif closeBracket[ch] then
				if #stack > 0 and stack[#stack].char == closeBracket[ch] then
					table.remove(stack)
				else
					table.insert(warnings, "Line " .. tostring(lineNum) .. ": unmatched '" .. ch .. "'")
				end
				i = i + 1
			else
				i = i + 1
			end
		end
	end
	for _, unclosed in ipairs(stack) do
		table.insert(warnings, "Line " .. tostring(unclosed.line) .. ": unclosed '" .. unclosed.char .. "'")
	end

	local blockOpeners = 0
	local endCount = 0
	for line in source:gmatch("[^\n]+") do
		local trimmed = line:match("^%s*(.-)%s*$")
		if trimmed:sub(1, 2) ~= "--" then
			for _, pat in ipairs(BLOCK_OPENER_PATTERNS) do
				if trimmed:match(pat) then
					blockOpeners = blockOpeners + 1
					break
				end
			end
			for _ in trimmed:gmatch("function%s*%(") do
				blockOpeners = blockOpeners + 1
			end
			for _, pat in ipairs(BLOCK_KEYWORD_PATTERNS) do
				if trimmed:match(pat) then
					blockOpeners = blockOpeners + 1
					break
				end
			end
			for _, pat in ipairs(BLOCK_CLOSER_PATTERNS) do
				if trimmed:match(pat) then
					endCount = endCount + 1
					break
				end
			end
		end
	end
	if blockOpeners > endCount then
		table.insert(warnings, "Possibly missing " .. tostring(blockOpeners - endCount) .. " 'end' statement(s)")
	elseif endCount > blockOpeners then
		table.insert(warnings, "Possibly " .. tostring(endCount - blockOpeners) .. " extra 'end' statement(s)")
	end

	return warnings
end

function M.writeScriptSource(instance, source)
	source = Utils.normalizeEscapes(source)
	local updateOk, updateErr = pcall(function()
		ScriptEditorService:UpdateSourceAsync(instance, function()
			return source
		end)
	end)
	if updateOk then return end

	local directOk, directErr = pcall(function()
		instance.Source = source
	end)
	if directOk then return end

	error("Failed to write script source: UpdateSourceAsync: "
		.. tostring(updateErr) .. ", direct: " .. tostring(directErr))
end

function M.upsertScript(parent, className, name, source)
	local existing = parent:FindFirstChild(name)
	local existedBefore = existing ~= nil
	local beforeSource = ""
	if existing and existing.ClassName ~= className then
		existing:Destroy()
		existing = nil
		existedBefore = false
	end

	if existing then
		local ok, rawSource = pcall(function()
			return existing.Source
		end)
		if ok and type(rawSource) == "string" then
			beforeSource = rawSource
		end
	end

	if not existing then
		existing = Instance.new(className)
		existing.Name = name
		existing.Parent = parent
	end

	local lintWarnings = M.lintLuauSource(source)
	if #lintWarnings > 0 then
		UI.appendLog("Lint warnings for " .. name .. ": " .. table.concat(lintWarnings, "; "))
	end

	M.writeScriptSource(existing, source)

	local scriptPath = PathResolver.getInstancePath(existing)
	return existing, {
		type = "upsert_script",
		path = scriptPath,
		scriptPath = scriptPath,
		name = name,
		summary = #lintWarnings > 0 and ("Script upsert completed (" .. #lintWarnings .. " lint warnings)") or "Script upsert completed",
		details = {
			className = className,
			existedBefore = existedBefore,
			beforeLines = Utils.countLines(beforeSource),
			afterLines = Utils.countLines(source),
			lintWarnings = #lintWarnings > 0 and lintWarnings or nil,
		},
		beforeSource = string.sub(beforeSource, 1, Constants.SCRIPT_SOURCE_PREVIEW_MAX),
		afterSource = string.sub(source, 1, Constants.SCRIPT_SOURCE_PREVIEW_MAX),
	}
end

function M.ensureRootHarness()
	local rootFolder = ReplicatedStorage:FindFirstChild(Constants.ROOT_FOLDER_NAME)
	if not rootFolder then
		rootFolder = Instance.new("Folder")
		rootFolder.Name = Constants.ROOT_FOLDER_NAME
		rootFolder.Parent = ReplicatedStorage
	end

	local remoteFunction = rootFolder:FindFirstChild(Constants.REMOTE_NAME)
	if remoteFunction and not remoteFunction:IsA("RemoteFunction") then
		remoteFunction:Destroy()
		remoteFunction = nil
	end

	if not remoteFunction then
		remoteFunction = Instance.new("RemoteFunction")
		remoteFunction.Name = Constants.REMOTE_NAME
		remoteFunction.Parent = rootFolder
	end

	local testHooks = rootFolder:FindFirstChild("TestHooks")
	if not testHooks then
		testHooks = Instance.new("Folder")
		testHooks.Name = "TestHooks"
		testHooks.Parent = rootFolder
	end

	return rootFolder
end

function M.injectTestCode(template, marker, code)
	local pos = string.find(template, marker, 1, true)
	if pos then
		return string.sub(template, 1, pos - 1) .. (code or "") .. string.sub(template, pos + #marker)
	end
	return template
end

function M.buildReactiveBindingScript(action)
	local config = {
		sourcePath = tostring(action.sourceGuiPath or ""),
		targetPath = tostring(action.targetGuiPath or ""),
		sourceProperty = tostring(action.sourceProperty or "Text"),
		targetProperty = tostring(action.targetProperty or "Visible"),
		rules = type(action.rules) == "table" and action.rules or {},
		defaultValue = action.defaultValue,
	}

	local configLiteral = Utils.toLuauLiteral(config, 0)
	local lines = {
		'local Players = game:GetService("Players")',
		'local player = Players.LocalPlayer',
		'local config = ' .. configLiteral,
		'',
		'local function splitPath(path)',
		'\tlocal segments = {}',
		'\tfor segment in string.gmatch(path, "[^%.]+") do',
		'\t\ttable.insert(segments, segment)',
		'\tend',
		'\treturn segments',
		'end',
		'',
		'local function resolvePlayerGuiPath(path)',
		'\tif type(path) ~= "string" or path == "" then',
		'\t\treturn nil',
		'\tend',
		'\tlocal current = player:WaitForChild("PlayerGui")',
		'\tfor _, segment in ipairs(splitPath(path)) do',
		'\t\tif segment ~= "PlayerGui" then',
		'\t\t\tcurrent = current:FindFirstChild(segment)',
		'\t\t\tif not current then',
		'\t\t\t\treturn nil',
		'\t\t\tend',
		'\t\tend',
		'\tend',
		'\treturn current',
		'end',
		'',
		'local function evaluate(value)',
		'\tfor _, rule in ipairs(config.rules) do',
		'\t\tlocal op = tostring(rule.op or "")',
		'\t\tlocal matched = false',
		'\t\tif op == "contains" then',
		'\t\t\tmatched = string.find(tostring(value), tostring(rule.value), 1, true) ~= nil',
		'\t\telseif op == "equals" then',
		'\t\t\tmatched = tostring(value) == tostring(rule.value)',
		'\t\telseif op == "gte" then',
		'\t\t\tlocal left = tonumber(value)',
		'\t\t\tlocal right = tonumber(rule.value)',
		'\t\t\tmatched = left ~= nil and right ~= nil and left >= right',
		'\t\telseif op == "lte" then',
		'\t\t\tlocal left = tonumber(value)',
		'\t\t\tlocal right = tonumber(rule.value)',
		'\t\t\tmatched = left ~= nil and right ~= nil and left <= right',
		'\t\tend',
		'\t\tif matched then',
		'\t\t\treturn rule.set',
		'\t\tend',
		'\tend',
		'\treturn config.defaultValue',
		'end',
		'',
		'local function start()',
		'\tlocal source = resolvePlayerGuiPath(config.sourcePath)',
		'\tlocal target = resolvePlayerGuiPath(config.targetPath)',
		'\tif not source or not target then',
		'\t\twarn("[uxRoaiBinding] source/target not found", config.sourcePath, config.targetPath)',
		'\t\treturn',
		'\tend',
		'\tlocal function applyBinding()',
		'\t\tlocal current = source[config.sourceProperty]',
		'\t\tlocal nextValue = evaluate(current)',
		'\t\tif nextValue ~= nil then',
		'\t\t\ttarget[config.targetProperty] = nextValue',
		'\t\tend',
		'\tend',
		'\tsource:GetPropertyChangedSignal(config.sourceProperty):Connect(applyBinding)',
		'\tapplyBinding()',
		'end',
		'',
		'start()',
	}
	return table.concat(lines, "\n") .. "\n"
end

return M
