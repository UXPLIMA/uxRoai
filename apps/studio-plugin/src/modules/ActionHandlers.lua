local CollectionService = game:GetService("CollectionService")
local InsertService = game:GetService("InsertService")

local M = {}

local function resolveOrError(path, actionName)
	local target = PathResolver.resolvePath(path)
	if not target then
		error(actionName .. " path not found: " .. tostring(path))
	end
	return target
end

local function isValidGuiParent(parent)
	if not parent then
		return false
	end
	local ok, result = pcall(function()
		return parent:IsA("LayerCollector") or parent:IsA("GuiBase2d") or parent:IsA("UIComponent")
	end)
	return ok and result
end

local function resolveCreateParent(action, className)
	local requestedPath = tostring(action.parentPath or "game.Workspace")
	local parent = PathResolver.resolvePath(requestedPath)
	local traits = PathResolver.inspectClassTraits(className)
	local usedPath = requestedPath

	local function rerouteTo(path, fallbackInstance)
		if type(path) == "string" and path ~= "" then
			local target = PathResolver.resolvePath(path)
			if target then
				parent = target
				usedPath = path
				return true
			end
		end
		if fallbackInstance then
			parent = fallbackInstance
			usedPath = PathResolver.getInstancePath(fallbackInstance)
			return true
		end
		return false
	end

	if traits.isLayerCollector then
		local valid = parent and (parent:IsA("StarterGui") or parent:IsA("PlayerGui") or parent:IsA("CoreGui"))
		if not valid then
			local remappedPath = PathResolver.mapWorkspacePathToStarterGui(requestedPath)
			local rerouted = rerouteTo(remappedPath, nil)
			if not rerouted then
				local guessedName = string.match(requestedPath, "([^%.]+)$")
				local guessed = PathResolver.findUniqueDescendantByName(game:GetService("StarterGui"), tostring(guessedName or ""))
				if guessed and guessed:IsA("LayerCollector") then
					rerouteTo(PathResolver.getInstancePath(guessed), nil)
				else
					rerouteTo(nil, game:GetService("StarterGui"))
				end
			end
		end
	elseif traits.isGuiObject or traits.isUiComponent then
		if not isValidGuiParent(parent) then
			local remappedPath = PathResolver.mapWorkspacePathToStarterGui(requestedPath)
			local remappedParent = remappedPath and PathResolver.resolvePath(remappedPath) or nil
			if isValidGuiParent(remappedParent) then
				parent = remappedParent
				usedPath = remappedPath
			else
				local guessedName = string.match(requestedPath, "([^%.]+)$")
				local guessedParent =
					PathResolver.findUniqueDescendantByName(game:GetService("StarterGui"), tostring(guessedName or ""))
				if isValidGuiParent(guessedParent) then
					parent = guessedParent
					usedPath = PathResolver.getInstancePath(guessedParent)
				else
					local generatedRoot = PathResolver.ensureGeneratedGuiRoot()
					parent = generatedRoot
					usedPath = PathResolver.getInstancePath(generatedRoot)
				end
			end
		end
	end

	if not parent then
		error("Parent path could not be resolved: " .. tostring(requestedPath))
	end

	if usedPath ~= requestedPath then
		UI.appendLog(
			I18N.t("logWarningPrefix", {
				warning = "create_instance parent rerouted: " .. requestedPath .. " -> " .. usedPath,
			})
		)
	end

	return parent
end

local function scriptClassFromContext(runContext)
	if runContext == "client" then
		return "LocalScript"
	end
	if runContext == "module" then
		return "ModuleScript"
	end
	return "Script"
end

local function applyRelativeOp(current, operand, op)
	if op == "add" then return current + operand end
	if op == "subtract" then return current - operand end
	if op == "multiply" then return current * operand end
	if op == "divide" then
		if operand == 0 then error("set_relative_property: division by zero") end
		return current / operand
	end
	if op == "power" then return current ^ operand end
	error("set_relative_property: unknown operation " .. tostring(op))
end

local function applyCreateInstance(action)
	local className = action.className or "Folder"
	local name = action.name or "NewInstance"
	local parent = resolveCreateParent(action, className)
	local existing = parent:FindFirstChild(name)
	local target = existing

	if existing and existing.ClassName ~= className then
		error("A different class already exists with the same name: " .. PathResolver.getInstancePath(existing))
	end

	if not target then
		target = Instance.new(className)
		target.Name = name
		target.Parent = parent
	end

	local setResult = {
		successCount = 0,
		failedCount = 0,
		failedProperties = {},
	}
	if type(action.properties) == "table" then
		setResult = ValueDecoder.setProperties(target, action.properties)
	end

	local path = PathResolver.getInstancePath(target)
	UI.appendLog("create_instance -> " .. path)
	UI.recordWaypoint("uxRoai: create " .. target.Name)
	return {
		type = "create_instance",
		path = path,
		name = target.Name,
		summary = "Instance ready",
		details = {
			className = target.ClassName,
			propertySuccess = setResult.successCount,
			propertyFail = setResult.failedCount,
			failedProperties = setResult.failedProperties,
		},
	}
end

local function applyUpsertScript(action)
	local parentPath = action.parentPath
	if not parentPath or parentPath == "" then
		parentPath = "game.ServerScriptService"
	end

	local className = scriptClassFromContext(action.runContext)
	local scriptName = action.name or "GeneratedScript"
	local source = action.source or "-- generated by uxRoai"
	local sourceLower = string.lower(source)

	if className == "Script" and string.find(sourceLower, "localplayer", 1, true) ~= nil then
		className = "LocalScript"
		if string.find(parentPath, "game.ServerScriptService", 1, true) == 1 then
			parentPath = "game.StarterPlayer.StarterPlayerScripts"
		end
		UI.appendLog(
			I18N.t("logWarningPrefix", {
				warning = "Detected LocalPlayer usage. Writing script as LocalScript in StarterPlayerScripts.",
			})
		)
	end

	local parent = PathResolver.resolvePath(parentPath)
	if not parent then
		error("Script parent path could not be resolved: " .. tostring(parentPath))
	end

	local created, change = ScriptWriter.upsertScript(parent, className, scriptName, source)
	UI.appendLog("upsert_script -> " .. PathResolver.getInstancePath(created))
	UI.recordWaypoint("uxRoai: script " .. scriptName)
	return change
end

local function applyEditScript(action)
	local target = resolveOrError(action.path, "edit_script")
	if not target:IsA("LuaSourceContainer") then
		error("edit_script target is not a script: " .. target.ClassName)
	end

	local ok, currentSource = pcall(function() return target.Source end)
	if not ok then
		error("Cannot read script source: " .. tostring(currentSource))
	end
	local beforeSource = currentSource

	local edits = type(action.edits) == "table" and action.edits or {}
	local appliedCount = 0
	for _, edit in ipairs(edits) do
		local oldText = tostring(edit.oldText or "")
		local newText = tostring(edit.newText or "")
		if oldText ~= "" then
			local startPos = string.find(currentSource, oldText, 1, true)
			if startPos then
				currentSource = string.sub(currentSource, 1, startPos - 1)
					.. newText
					.. string.sub(currentSource, startPos + #oldText)
				appliedCount = appliedCount + 1
			end
		end
	end

	if appliedCount == 0 then
		error("edit_script: no edits matched in " .. tostring(action.path))
	end

	local lintWarnings = ScriptWriter.lintLuauSource(currentSource)
	if #lintWarnings > 0 then
		UI.appendLog("Lint warnings for " .. target.Name .. ": " .. table.concat(lintWarnings, "; "))
	end

	ScriptWriter.writeScriptSource(target, currentSource)

	local path = PathResolver.getInstancePath(target)
	UI.appendLog("edit_script -> " .. path .. " (" .. tostring(appliedCount) .. " edits)")
	UI.recordWaypoint("uxRoai: edit " .. target.Name)
	return {
		type = "edit_script",
		path = path,
		scriptPath = path,
		name = target.Name,
		summary = appliedCount .. " edit(s) applied" .. (#lintWarnings > 0 and (" (" .. #lintWarnings .. " lint warnings)") or ""),
		details = {
			appliedEdits = appliedCount,
			totalEdits = #edits,
			lintWarnings = #lintWarnings > 0 and lintWarnings or nil,
		},
		beforeSource = string.sub(beforeSource, 1, Constants.SCRIPT_SOURCE_PREVIEW_MAX),
		afterSource = string.sub(currentSource, 1, Constants.SCRIPT_SOURCE_PREVIEW_MAX),
	}
end

local function applySetProperty(action)
	local target, resolvedPath = PathResolver.resolvePathWithGuiFallback(action.path)
	if not target then
		error("set_property path could not be resolved: " .. tostring(action.path))
	end
	if resolvedPath ~= action.path then
		UI.appendLog(
			I18N.t("logWarningPrefix", {
				warning = "set_property path rerouted: " .. tostring(action.path) .. " -> " .. tostring(resolvedPath),
			})
		)
	end

	local property = action.property
	if type(property) ~= "string" or property == "" then
		error("set_property property is invalid")
	end

	local isInstanceRefProp = (property == "Parent" or property == "PrimaryPart"
		or property == "Adornee" or property == "Part0" or property == "Part1")
	local decoded
	if isInstanceRefProp and type(action.value) == "string" and action.value ~= "" then
		local refTarget = PathResolver.resolvePath(action.value)
		if not refTarget then
			error("set_property: instance reference not found: " .. tostring(action.value))
		end
		decoded = refTarget
	else
		decoded = ValueDecoder.decodeValue(action.value, target, property)
	end

	local previousValue = nil
	local hadPreviousValue = false
	pcall(function()
		previousValue = target[property]
		hadPreviousValue = true
	end)
	local ok, err = pcall(function()
		target[property] = decoded
	end)
	if not ok then
		error("set_property failed: " .. tostring(err))
	end

	local path = PathResolver.getInstancePath(target)
	UI.appendLog("set_property -> " .. path .. "." .. property)
	UI.recordWaypoint("uxRoai: set " .. property)
	return {
		type = "set_property",
		path = path,
		name = target.Name,
		summary = "Property set",
		details = {
			property = property,
			before = hadPreviousValue and tostring(previousValue) or "",
			after = tostring(decoded),
		},
	}
end

local function applyDeleteInstance(action)
	local target, resolvedPath = PathResolver.resolvePathWithGuiFallback(action.path)
	if not target then
		UI.appendLog("delete_instance skip (not found): " .. tostring(action.path))
		return {
			type = "delete_instance",
			path = tostring(action.path),
			summary = "Delete skipped (instance missing)",
		}
	end
	if target == game then
		error("delete_instance cannot target game root")
	end
	local path = PathResolver.getInstancePath(target)
	if resolvedPath ~= action.path then
		UI.appendLog(
			I18N.t("logWarningPrefix", {
				warning = "delete_instance path rerouted: " .. tostring(action.path) .. " -> " .. tostring(resolvedPath),
			})
		)
	end
	local name = target.Name
	target:Destroy()
	UI.appendLog("delete_instance -> " .. path)
	UI.recordWaypoint("uxRoai: delete " .. name)
	return {
		type = "delete_instance",
		path = path,
		summary = "Instance deleted",
	}
end

local function applySetAttribute(action)
	local target = resolveOrError(action.path, "set_attribute")
	local attrName = tostring(action.attribute or "")
	if attrName == "" then
		error("set_attribute: attribute name is empty")
	end
	local value = action.value
	if type(value) == "table" then
		value = ValueDecoder.decodeValue(value, nil, attrName)
	end
	local previousAttr = target:GetAttribute(attrName)
	target:SetAttribute(attrName, value)
	local path = PathResolver.getInstancePath(target)
	UI.appendLog("set_attribute -> " .. path .. "." .. attrName)
	UI.recordWaypoint("uxRoai: attr " .. attrName)
	return {
		type = "set_attribute",
		path = path,
		name = target.Name,
		summary = "Attribute set: " .. attrName,
		details = {
			attribute = attrName,
			before = previousAttr ~= nil and tostring(previousAttr) or "",
			after = tostring(value),
		},
	}
end

local function applyAddTag(action)
	local target = resolveOrError(action.path, "add_tag")
	local tag = tostring(action.tag or "")
	if tag == "" then
		error("add_tag: tag name is empty")
	end
	CollectionService:AddTag(target, tag)
	local path = PathResolver.getInstancePath(target)
	UI.appendLog("add_tag -> " .. path .. " [" .. tag .. "]")
	UI.recordWaypoint("uxRoai: tag " .. tag)
	return {
		type = "add_tag",
		path = path,
		name = target.Name,
		summary = "Tag added: " .. tag,
		details = { tag = tag },
	}
end

local function applyRemoveTag(action)
	local target = resolveOrError(action.path, "remove_tag")
	local tag = tostring(action.tag or "")
	if tag == "" then
		error("remove_tag: tag name is empty")
	end
	CollectionService:RemoveTag(target, tag)
	local path = PathResolver.getInstancePath(target)
	UI.appendLog("remove_tag -> " .. path .. " [" .. tag .. "]")
	UI.recordWaypoint("uxRoai: untag " .. tag)
	return {
		type = "remove_tag",
		path = path,
		name = target.Name,
		summary = "Tag removed: " .. tag,
		details = { tag = tag },
	}
end

local function applyQueryInstances(action)
	local query = type(action.query) == "table" and action.query or {}
	local instances, meta = PathResolver.collectInstancesByQuery(query)
	local paths = PathResolver.pathsFromInstances(instances)
	UI.appendLog("query_instances -> " .. tostring(#paths) .. " result(s)")
	return {
		type = "query_instances",
		count = #paths,
		paths = paths,
		summary = "Explorer query completed",
		details = meta,
	}
end

local function applyBulkSetProperties(action)
	local properties = type(action.properties) == "table" and action.properties or {}
	local targetPaths = type(action.targetPaths) == "table" and action.targetPaths or {}
	local targetMap = {}

	for _, path in ipairs(targetPaths) do
		local instance = PathResolver.resolvePath(path)
		if instance then
			targetMap[PathResolver.getInstancePath(instance)] = instance
		end
	end

	if type(action.query) == "table" then
		local queryMatches = PathResolver.collectInstancesByQuery(action.query)
		for _, instance in ipairs(queryMatches) do
			targetMap[PathResolver.getInstancePath(instance)] = instance
		end
	end

	local touchedPaths = {}
	local propertySuccess = 0
	local propertyFail = 0

	for path, instance in pairs(targetMap) do
		local setResult = ValueDecoder.setProperties(instance, properties)
		table.insert(touchedPaths, path)
		propertySuccess = propertySuccess + setResult.successCount
		propertyFail = propertyFail + setResult.failedCount
	end

	table.sort(touchedPaths, function(a, b)
		return a < b
	end)

	UI.appendLog("bulk_set_properties -> " .. tostring(#touchedPaths) .. " instance(s)")
	UI.recordWaypoint("uxRoai: bulk props " .. tostring(#touchedPaths) .. " instances")
	return {
		type = "bulk_set_properties",
		count = #touchedPaths,
		paths = touchedPaths,
		summary = "Bulk property update completed",
		details = {
			propertySuccess = propertySuccess,
			propertyFail = propertyFail,
		},
	}
end

local function applyCloneTemplateToVariants(action)
	local template = resolveOrError(action.templatePath, "clone_template_to_variants")

	local parent = nil
	if type(action.parentPath) == "string" and action.parentPath ~= "" then
		parent = PathResolver.resolvePath(action.parentPath)
	else
		parent = template.Parent
	end
	if not parent then
		error("clone_template_to_variants parent not found")
	end

	local variants = Utils.normalizeVariantEntries(type(action.variants) == "table" and action.variants or {})
	local createdPaths = {}
	local replacedCount = 0
	local propertySuccess = 0
	local propertyFail = 0

	for _, variant in ipairs(variants) do
		local variantName = tostring(variant.name or "")
		if variantName ~= "" then
			local existing = parent:FindFirstChild(variantName)
			if existing and action.deleteIfExists ~= false then
				existing:Destroy()
				existing = nil
				replacedCount = replacedCount + 1
			end

			if not existing then
				local clone = template:Clone()
				clone.Name = variantName
				if type(variant.propertyOverrides) == "table" then
					local setResult = ValueDecoder.setProperties(clone, variant.propertyOverrides)
					propertySuccess = propertySuccess + setResult.successCount
					propertyFail = propertyFail + setResult.failedCount
				end
				clone.Parent = parent
				table.insert(createdPaths, PathResolver.getInstancePath(clone))
			end
		end
	end

	UI.appendLog("clone_template_to_variants -> " .. tostring(#createdPaths) .. " clone(s)")
	UI.recordWaypoint("uxRoai: clone " .. tostring(#createdPaths) .. " variants")
	return {
		type = "clone_template_to_variants",
		count = #createdPaths,
		paths = createdPaths,
		summary = "Template variants created",
		details = {
			templatePath = PathResolver.getInstancePath(template),
			parentPath = PathResolver.getInstancePath(parent),
			replacedCount = replacedCount,
			propertySuccess = propertySuccess,
			propertyFail = propertyFail,
		},
	}
end

local function applyCreateReactiveBinding(action)
	local parentPath = action.parentPath
	if type(parentPath) ~= "string" or parentPath == "" then
		parentPath = "game.StarterPlayer.StarterPlayerScripts"
	end

	local parent = PathResolver.resolvePath(parentPath)
	if not parent then
		error("create_reactive_binding parent not found: " .. tostring(parentPath))
	end

	local scriptName = tostring(action.name or "UxRoaIReactiveBinding")
	local scriptSource = ScriptWriter.buildReactiveBindingScript(action)
	local _, change = ScriptWriter.upsertScript(parent, "LocalScript", scriptName, scriptSource)
	change.type = "create_reactive_binding"
	change.summary = "Reactive binding script created"
	change.details = change.details or {}
	change.details.sourceGuiPath = tostring(action.sourceGuiPath or "")
	change.details.targetGuiPath = tostring(action.targetGuiPath or "")
	UI.recordWaypoint("uxRoai: reactive binding " .. scriptName)
	return change
end

local function serializeForReturn(value, depth)
	depth = depth or 0
	if depth > 3 then return tostring(value) end

	local valType = type(value)
	if valType == "nil" then return "nil" end
	if valType == "string" then return string.sub(value, 1, 500) end
	if valType == "number" or valType == "boolean" then return tostring(value) end

	if valType == "table" then
		local parts = {}
		local count = 0
		for k, v in pairs(value) do
			count = count + 1
			if count > 30 then
				table.insert(parts, "...")
				break
			end
			local keyStr = type(k) == "number" and "" or (tostring(k) .. "=")
			table.insert(parts, keyStr .. serializeForReturn(v, depth + 1))
		end
		return "{" .. table.concat(parts, ", ") .. "}"
	end

	local typeofVal = typeof(value)
	if typeofVal == "Instance" then
		return "<" .. value.ClassName .. "> " .. PathResolver.getInstancePath(value)
	end

	return tostring(value)
end

local function applyRunCode(action)
	local source = tostring(action.source or "")
	if source == "" then
		error("run_code: empty source")
	end

	local env = setmetatable({
		game = game,
		workspace = workspace,
		Instance = Instance,
		Vector3 = Vector3,
		CFrame = CFrame,
		Color3 = Color3,
		UDim2 = UDim2,
		UDim = UDim,
		Enum = Enum,
		BrickColor = BrickColor,
		NumberRange = NumberRange,
		NumberSequence = NumberSequence,
		ColorSequence = ColorSequence,
		Rect = Rect,
		Ray = Ray,
		Region3 = Region3,
		TweenInfo = TweenInfo,
		task = task,
		pcall = pcall,
		xpcall = xpcall,
		pairs = pairs,
		ipairs = ipairs,
		next = next,
		select = select,
		unpack = unpack,
		type = type,
		typeof = typeof,
		tostring = tostring,
		tonumber = tonumber,
		print = print,
		warn = warn,
		error = error,
		require = require,
		newproxy = newproxy,
		setmetatable = setmetatable,
		getmetatable = getmetatable,
		rawget = rawget,
		rawset = rawset,
		math = math,
		string = string,
		table = table,
		os = { clock = os.clock, time = os.time },
		tick = tick,
		PathResolver = PathResolver,
	}, { __index = function(_, key)
		local ok, service = pcall(game.GetService, game, key)
		if ok and service then return service end
		return nil
	end })

	local fn, compileErr = loadstring(source)
	if not fn then
		error("run_code compile error: " .. tostring(compileErr))
	end
	setfenv(fn, env)

	local ok, result = pcall(fn)
	if not ok then
		error("run_code runtime error: " .. tostring(result))
	end

	local resultStr = serializeForReturn(result, 0)

	local description = tostring(action.description or "Custom code execution")
	UI.appendLog("run_code -> " .. description)
	UI.recordWaypoint("uxRoai: run_code " .. string.sub(description, 1, 40))
	return {
		type = "run_code",
		summary = description,
		details = {
			sourceLength = #source,
			result = resultStr,
		},
	}
end

local function applyMassCreate(action)
	local objects = type(action.objects) == "table" and action.objects or {}
	local succeeded = 0
	local failed = 0
	local errors = {}
	local createdPaths = {}

	for _, obj in ipairs(objects) do
		local ok, err = pcall(function()
			local className = tostring(obj.className or "Part")
			local name = tostring(obj.name or "Instance")
			local parent = resolveCreateParent(obj, className)
			local existing = parent:FindFirstChild(name)
			local target = existing

			if existing and existing.ClassName ~= className then
				error("A different class already exists: " .. PathResolver.getInstancePath(existing))
			end

			if not target then
				target = Instance.new(className)
				target.Name = name
				target.Parent = parent
			end

			if type(obj.properties) == "table" then
				ValueDecoder.setProperties(target, obj.properties)
			end

			table.insert(createdPaths, PathResolver.getInstancePath(target))
		end)
		if ok then
			succeeded = succeeded + 1
		else
			failed = failed + 1
			if #errors < Constants.ERROR_BATCH_LIMIT then
				table.insert(errors, tostring(err))
			end
		end
	end

	UI.appendLog("mass_create -> " .. tostring(succeeded) .. " created, " .. tostring(failed) .. " failed")
	UI.recordWaypoint("uxRoai: mass_create " .. tostring(succeeded) .. " instances")
	return {
		type = "mass_create",
		count = succeeded,
		paths = createdPaths,
		summary = succeeded .. " instance(s) created" .. (failed > 0 and (", " .. failed .. " failed") or ""),
		details = {
			succeeded = succeeded,
			failed = failed,
			errors = errors,
		},
	}
end

local function applyInsertScriptLines(action)
	local target = resolveOrError(action.path, "insert_script_lines")
	if not target:IsA("LuaSourceContainer") then
		error("insert_script_lines target is not a script: " .. target.ClassName)
	end

	local readOk, currentSource = pcall(function() return target.Source end)
	if not readOk then
		error("Cannot read script source: " .. tostring(currentSource))
	end
	local beforeSource = currentSource

	local afterLine = tonumber(action.afterLine) or 0
	local content = tostring(action.content or "")
	local newLines = ScriptWriter.splitLines(content)

	local lines, hadTrailingNewline = ScriptWriter.splitLines(currentSource)

	if afterLine < 0 then afterLine = 0 end
	if afterLine > #lines then afterLine = #lines end

	for i, newLine in ipairs(newLines) do
		table.insert(lines, afterLine + i, newLine)
	end

	local newSource = ScriptWriter.joinLines(lines, hadTrailingNewline)
	ScriptWriter.writeScriptSource(target, newSource)

	local path = PathResolver.getInstancePath(target)
	UI.appendLog("insert_script_lines -> " .. path .. " (+" .. tostring(#newLines) .. " lines after line " .. tostring(afterLine) .. ")")
	UI.recordWaypoint("uxRoai: insert lines " .. target.Name)
	return {
		type = "insert_script_lines",
		path = path,
		scriptPath = path,
		name = target.Name,
		summary = #newLines .. " line(s) inserted after line " .. tostring(afterLine),
		details = { insertedLines = #newLines, afterLine = afterLine },
		beforeSource = string.sub(beforeSource, 1, Constants.SCRIPT_SOURCE_PREVIEW_MAX),
		afterSource = string.sub(newSource, 1, Constants.SCRIPT_SOURCE_PREVIEW_MAX),
	}
end

local function applyDeleteScriptLines(action)
	local target = resolveOrError(action.path, "delete_script_lines")
	if not target:IsA("LuaSourceContainer") then
		error("delete_script_lines target is not a script: " .. target.ClassName)
	end

	local readOk, currentSource = pcall(function() return target.Source end)
	if not readOk then
		error("Cannot read script source: " .. tostring(currentSource))
	end
	local beforeSource = currentSource

	local startLine = tonumber(action.startLine) or 1
	local endLine = tonumber(action.endLine) or 1
	if startLine > endLine then
		startLine, endLine = endLine, startLine
	end

	local lines, hadTrailingNewline = ScriptWriter.splitLines(currentSource)
	if startLine < 1 then startLine = 1 end
	if endLine > #lines then endLine = #lines end

	local deletedCount = endLine - startLine + 1
	if deletedCount <= 0 then
		error("delete_script_lines: no lines in range " .. tostring(startLine) .. "-" .. tostring(endLine))
	end

	for i = endLine, startLine, -1 do
		table.remove(lines, i)
	end

	local newSource = ScriptWriter.joinLines(lines, hadTrailingNewline)
	ScriptWriter.writeScriptSource(target, newSource)

	local path = PathResolver.getInstancePath(target)
	UI.appendLog("delete_script_lines -> " .. path .. " (-" .. tostring(deletedCount) .. " lines, " .. tostring(startLine) .. "-" .. tostring(endLine) .. ")")
	UI.recordWaypoint("uxRoai: delete lines " .. target.Name)
	return {
		type = "delete_script_lines",
		path = path,
		scriptPath = path,
		name = target.Name,
		summary = deletedCount .. " line(s) deleted (" .. tostring(startLine) .. "-" .. tostring(endLine) .. ")",
		details = { deletedLines = deletedCount, startLine = startLine, endLine = endLine },
		beforeSource = string.sub(beforeSource, 1, Constants.SCRIPT_SOURCE_PREVIEW_MAX),
		afterSource = string.sub(newSource, 1, Constants.SCRIPT_SOURCE_PREVIEW_MAX),
	}
end

local function applySetRelativeProperty(action)
	local paths = type(action.paths) == "table" and action.paths or {}
	local property = tostring(action.property or "")
	local op = tostring(action.operation or "")
	local value = action.value
	local component = action.component and tostring(action.component) or nil

	if property == "" then
		error("set_relative_property: property is empty")
	end

	local modifiedPaths = {}
	local errors = {}

	for _, pathStr in ipairs(paths) do
		local ok, err = pcall(function()
			local target = PathResolver.resolvePath(pathStr)
			if not target then
				error("Path not found: " .. tostring(pathStr))
			end

			local current = target[property]
			local currentType = typeof(current)
			local newValue

			if currentType == "number" then
				local operand = tonumber(value)
				if not operand then error("Value must be a number") end
				newValue = applyRelativeOp(current, operand, op)

			elseif currentType == "Vector3" then
				if type(value) == "table" then
					local vx = tonumber(value.x) or 0
					local vy = tonumber(value.y) or 0
					local vz = tonumber(value.z) or 0
					if component then
						local cx, cy, cz = current.X, current.Y, current.Z
						if component == "X" then cx = applyRelativeOp(cx, vx, op)
						elseif component == "Y" then cy = applyRelativeOp(cy, vy, op)
						elseif component == "Z" then cz = applyRelativeOp(cz, vz, op)
						end
						newValue = Vector3.new(cx, cy, cz)
					else
						newValue = Vector3.new(
							applyRelativeOp(current.X, vx, op),
							applyRelativeOp(current.Y, vy, op),
							applyRelativeOp(current.Z, vz, op)
						)
					end
				else
					local operand = tonumber(value)
					if not operand then error("Value must be number or {x,y,z}") end
					newValue = Vector3.new(
						applyRelativeOp(current.X, operand, op),
						applyRelativeOp(current.Y, operand, op),
						applyRelativeOp(current.Z, operand, op)
					)
				end

			elseif currentType == "Color3" then
				if type(value) == "table" then
					local vr = tonumber(value.r) or 0
					local vg = tonumber(value.g) or 0
					local vb = tonumber(value.b) or 0
					vr = vr / 255
					vg = vg / 255
					vb = vb / 255
					newValue = Color3.new(
						math.clamp(applyRelativeOp(current.R, vr, op), 0, 1),
						math.clamp(applyRelativeOp(current.G, vg, op), 0, 1),
						math.clamp(applyRelativeOp(current.B, vb, op), 0, 1)
					)
				else
					error("Color3 value must be {r,g,b}")
				end

			elseif currentType == "UDim2" then
				if not component then
					error("UDim2 requires a component (XScale/XOffset/YScale/YOffset)")
				end
				local operand = tonumber(value)
				if type(value) == "table" then
					operand = tonumber(value[component]) or tonumber(value.value) or 0
				end
				if not operand then error("Cannot parse operand for UDim2 component") end
				local xs, xo, ys, yo = current.X.Scale, current.X.Offset, current.Y.Scale, current.Y.Offset
				if component == "XScale" then xs = applyRelativeOp(xs, operand, op)
				elseif component == "XOffset" then xo = applyRelativeOp(xo, operand, op)
				elseif component == "YScale" then ys = applyRelativeOp(ys, operand, op)
				elseif component == "YOffset" then yo = applyRelativeOp(yo, operand, op)
				else error("Unknown UDim2 component: " .. component)
				end
				newValue = UDim2.new(xs, xo, ys, yo)

			else
				error("Unsupported property type: " .. currentType)
			end

			target[property] = newValue
			table.insert(modifiedPaths, PathResolver.getInstancePath(target))
		end)
		if not ok then
			if #errors < Constants.ERROR_BATCH_LIMIT then
				table.insert(errors, tostring(pathStr) .. ": " .. tostring(err))
			end
		end
	end

	UI.appendLog("set_relative_property -> " .. tostring(#modifiedPaths) .. " modified (" .. property .. " " .. op .. ")")
	if #modifiedPaths > 0 then
		UI.recordWaypoint("uxRoai: relative " .. property .. " " .. op)
	end
	return {
		type = "set_relative_property",
		count = #modifiedPaths,
		paths = modifiedPaths,
		summary = #modifiedPaths .. " instance(s) modified (" .. property .. " " .. op .. ")",
		details = {
			property = property,
			operation = op,
			modified = #modifiedPaths,
			failed = #errors,
			errors = errors,
		},
	}
end

local function applySmartDuplicate(action)
	local source = resolveOrError(action.sourcePath, "smart_duplicate")

	local count = tonumber(action.count) or 1
	if count < 1 then count = 1 end
	if count > Constants.SMART_DUPLICATE_MAX then count = Constants.SMART_DUPLICATE_MAX end

	local namePattern = action.namePattern
	local posOffset = action.positionOffset
	local rotOffset = action.rotationOffset
	local scaleMul = action.scaleMultiplier
	local propVariations = type(action.propertyVariations) == "table" and action.propertyVariations or nil
	local targetParents = type(action.targetParents) == "table" and action.targetParents or nil

	local sourcePos = nil
	local sourceSize = nil
	pcall(function() sourcePos = source.Position end)
	pcall(function() sourceSize = source.Size end)

	local createdPaths = {}
	local errors = {}

	for i = 1, count do
		local ok, err = pcall(function()
			local clone = source:Clone()

			if namePattern and type(namePattern) == "string" then
				clone.Name = string.gsub(namePattern, "{n}", tostring(i))
			else
				clone.Name = source.Name .. "_" .. tostring(i)
			end

			if posOffset and sourcePos then
				pcall(function()
					local ox = tonumber(posOffset.x) or 0
					local oy = tonumber(posOffset.y) or 0
					local oz = tonumber(posOffset.z) or 0
					clone.Position = sourcePos + Vector3.new(ox * i, oy * i, oz * i)
				end)
			end

			if rotOffset then
				pcall(function()
					local rx = math.rad((tonumber(rotOffset.x) or 0) * i)
					local ry = math.rad((tonumber(rotOffset.y) or 0) * i)
					local rz = math.rad((tonumber(rotOffset.z) or 0) * i)
					clone.CFrame = clone.CFrame * CFrame.Angles(rx, ry, rz)
				end)
			end

			if scaleMul and sourceSize then
				pcall(function()
					local sx = tonumber(scaleMul.x) or 1
					local sy = tonumber(scaleMul.y) or 1
					local sz = tonumber(scaleMul.z) or 1
					clone.Size = Vector3.new(
						sourceSize.X * (sx ^ i),
						sourceSize.Y * (sy ^ i),
						sourceSize.Z * (sz ^ i)
					)
				end)
			end

			if propVariations then
				for propName, values in pairs(propVariations) do
					if type(values) == "table" and #values > 0 then
						local idx = ((i - 1) % #values) + 1
						local rawVal = values[idx]
						pcall(function()
							clone[propName] = ValueDecoder.decodeValue(rawVal, clone, propName)
						end)
					end
				end
			end

			local parent = source.Parent
			if targetParents and targetParents[i] then
				local tp = PathResolver.resolvePath(tostring(targetParents[i]))
				if tp then parent = tp end
			end
			clone.Parent = parent

			table.insert(createdPaths, PathResolver.getInstancePath(clone))
		end)
		if not ok then
			if #errors < Constants.ERROR_BATCH_LIMIT then
				table.insert(errors, "Clone " .. tostring(i) .. ": " .. tostring(err))
			end
		end
	end

	UI.appendLog("smart_duplicate -> " .. tostring(#createdPaths) .. " clone(s) from " .. tostring(action.sourcePath))
	UI.recordWaypoint("uxRoai: duplicate " .. tostring(#createdPaths) .. " clones")
	return {
		type = "smart_duplicate",
		count = #createdPaths,
		paths = createdPaths,
		summary = #createdPaths .. " clone(s) created",
		details = {
			sourcePath = PathResolver.getInstancePath(source),
			succeeded = #createdPaths,
			failed = #errors,
			errors = errors,
		},
	}
end

local function applyInsertAsset(action)
	local assetId = tonumber(action.assetId)
	if not assetId or assetId <= 0 then
		error("insert_asset: invalid assetId")
	end
	local parentPath = tostring(action.parentPath or "game.Workspace")
	local parent = resolveOrError(parentPath, "insert_asset")
	local model = InsertService:LoadAsset(assetId)
	if not model then
		error("insert_asset: LoadAsset returned nil for assetId " .. tostring(assetId))
	end
	local insertedNames = {}
	for _, child in ipairs(model:GetChildren()) do
		if action.name and #model:GetChildren() == 1 then
			child.Name = tostring(action.name)
		end
		child.Parent = parent
		table.insert(insertedNames, child.Name)
	end
	model:Destroy()
	local path = PathResolver.getInstancePath(parent)
	UI.appendLog("insert_asset -> " .. path .. " (assetId=" .. tostring(assetId) .. ", " .. tostring(#insertedNames) .. " objects)")
	UI.recordWaypoint("uxRoai: insert asset " .. tostring(assetId))
	return {
		type = "insert_asset",
		path = path,
		name = table.concat(insertedNames, ", "),
		summary = #insertedNames .. " object(s) inserted from asset " .. tostring(assetId),
		details = {
			assetId = assetId,
			insertedNames = insertedNames,
		},
	}
end

local function applyEnsurePlaytestHarness()
	UI.appendLog(I18N.t("logHarnessDeferred"))
	return {
		type = "ensure_playtest_harness",
		summary = "Harness will be installed only during playtest execution",
		details = { lazy = true },
	}
end

local function applyInjectInstance(action)
	local source = tostring(action.source or "")
	if source == "" then
		error("inject_instance: empty source")
	end

	local timeoutSec = tonumber(action.timeout) or 10
	if timeoutSec < 1 then timeoutSec = 1 end
	if timeoutSec > 30 then timeoutSec = 30 end

	local description = tostring(action.description or "Injected server code")
	local scriptName = "UxRoaI_Inject_" .. tostring(os.clock()):gsub("%.", "_")

	-- Create result channel (BindableEvent)
	local resultEvent = Instance.new("BindableEvent")
	resultEvent.Name = scriptName .. "_Result"
	resultEvent.Parent = game:GetService("ServerScriptService")

	-- Wrap user code: catch errors, fire result, then self-destruct
	local wrappedSource = string.format([[
local resultEvent = script.Parent:FindFirstChild(%q)
local ok, result = pcall(function()
%s
end)
if resultEvent then
	resultEvent:Fire(ok, ok and tostring(result or "nil") or tostring(result))
end
task.defer(function()
	if resultEvent then resultEvent:Destroy() end
	script:Destroy()
end)
]], resultEvent.Name, source)

	-- Create the real Script in ServerScriptService
	local injectedScript = Instance.new("Script")
	injectedScript.Name = scriptName
	injectedScript.Source = wrappedSource
	injectedScript.Parent = game:GetService("ServerScriptService")

	-- Wait for result via the BindableEvent
	local gotResult = false
	local resultOk, resultValue = false, "timeout"

	local conn
	conn = resultEvent.Event:Connect(function(rOk, rVal)
		gotResult = true
		resultOk = rOk
		resultValue = rVal
		if conn then conn:Disconnect() end
	end)

	local startTime = os.clock()
	while not gotResult and (os.clock() - startTime) < timeoutSec do
		task.wait(0.1)
	end

	-- Cleanup
	if conn then
		pcall(function() conn:Disconnect() end)
	end
	pcall(function()
		if resultEvent.Parent then resultEvent:Destroy() end
	end)
	pcall(function()
		if injectedScript.Parent then injectedScript:Destroy() end
	end)

	if not gotResult then
		error("inject_instance: timed out after " .. tostring(timeoutSec) .. "s")
	end

	if not resultOk then
		error("inject_instance runtime error: " .. tostring(resultValue))
	end

	UI.appendLog("inject_instance -> " .. description)
	UI.recordWaypoint("uxRoai: inject " .. string.sub(description, 1, 40))
	return {
		type = "inject_instance",
		summary = description,
		details = {
			sourceLength = #source,
			result = tostring(resultValue),
			timeout = timeoutSec,
		},
	}
end

local ACTION_DISPATCH = {
	create_instance = applyCreateInstance,
	upsert_script = applyUpsertScript,
	edit_script = applyEditScript,
	set_property = applySetProperty,
	delete_instance = applyDeleteInstance,
	set_attribute = applySetAttribute,
	add_tag = applyAddTag,
	remove_tag = applyRemoveTag,
	query_instances = applyQueryInstances,
	bulk_set_properties = applyBulkSetProperties,
	clone_template_to_variants = applyCloneTemplateToVariants,
	create_reactive_binding = applyCreateReactiveBinding,
	run_code = applyRunCode,
	mass_create = applyMassCreate,
	get_instance_properties = function(a) return ClassInspector.applyGetInstanceProperties(a) end,
	get_class_info = function(a) return ClassInspector.applyGetClassInfo(a) end,
	insert_script_lines = applyInsertScriptLines,
	delete_script_lines = applyDeleteScriptLines,
	set_relative_property = applySetRelativeProperty,
	smart_duplicate = applySmartDuplicate,
	insert_asset = applyInsertAsset,
	inject_instance = applyInjectInstance,
	ensure_playtest_harness = applyEnsurePlaytestHarness,
	run_playtest = function() return nil end,
}

function M.applyAction(action)
	if type(action) ~= "table" then
		return nil
	end

	local handler = ACTION_DISPATCH[action.type]
	if handler then
		return handler(action)
	end

	UI.appendLog(I18N.t("logUnknownAction", { actionType = tostring(action.type) }))
	return nil
end

return M
