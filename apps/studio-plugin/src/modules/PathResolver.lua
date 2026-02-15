local CollectionService = game:GetService("CollectionService")

local M = {}

function M.getInstancePath(instance)
	local segments = {}
	local current = instance
	while current and current ~= game do
		segments[#segments + 1] = current.Name
		current = current.Parent
	end

	if #segments == 0 then
		return "game"
	end

	local n = #segments
	for i = 1, math.floor(n / 2) do
		segments[i], segments[n - i + 1] = segments[n - i + 1], segments[i]
	end

	return "game." .. table.concat(segments, ".")
end

function M.getServiceByName(serviceName)
	local direct = game:FindFirstChild(serviceName)
	if direct then
		return direct
	end

	local ok, service = pcall(function()
		return game:GetService(serviceName)
	end)
	if ok then
		return service
	end

	return nil
end

function M.resolvePath(path)
	if type(path) ~= "string" or path == "" then
		return nil
	end

	if path == "game" then
		return game
	end

	local current = game
	for segment in string.gmatch(path, "[^%.]+") do
		if segment ~= "game" then
			local nextInstance = current:FindFirstChild(segment)
			if not nextInstance and current == game then
				nextInstance = M.getServiceByName(segment)
			end
			current = nextInstance
			if not current then
				return nil
			end
		end
	end

	return current
end

function M.mapWorkspacePathToStarterGui(path)
	if type(path) ~= "string" or path == "" then
		return nil
	end
	local workspacePrefix = "game.Workspace"
	if string.sub(path, 1, #workspacePrefix) ~= workspacePrefix then
		return nil
	end
	return "game.StarterGui" .. string.sub(path, #workspacePrefix + 1)
end

local classTraitsCache = {}

function M.inspectClassTraits(className)
	if classTraitsCache[className] then
		return classTraitsCache[className]
	end

	local traits = {
		isLayerCollector = false,
		isGuiObject = false,
		isUiComponent = false,
	}

	local ok, probe = pcall(function()
		return Instance.new(className)
	end)
	if not ok or not probe then
		classTraitsCache[className] = traits
		return traits
	end

	local probeOk, _ = pcall(function()
		traits.isLayerCollector = probe:IsA("LayerCollector")
		traits.isGuiObject = probe:IsA("GuiObject")
		traits.isUiComponent = probe:IsA("UIComponent")
	end)
	if not probeOk then
		-- Keep defaults.
	end

	pcall(function()
		probe:Destroy()
	end)

	classTraitsCache[className] = traits
	return traits
end

function M.ensureGeneratedGuiRoot()
	local starterGui = game:GetService("StarterGui")
	local existing = starterGui:FindFirstChild(Constants.GENERATED_GUI_ROOT_NAME)
	if existing and existing:IsA("ScreenGui") then
		return existing
	end
	if existing then
		pcall(function()
			existing:Destroy()
		end)
	end

	local rootGui = Instance.new("ScreenGui")
	rootGui.Name = Constants.GENERATED_GUI_ROOT_NAME
	rootGui.ResetOnSpawn = false
	rootGui.IgnoreGuiInset = false
	rootGui.Parent = starterGui
	return rootGui
end

function M.findUniqueDescendantByName(root, name)
	if not root or type(name) ~= "string" or name == "" then
		return nil
	end
	local found = nil
	for _, child in ipairs(root:GetDescendants()) do
		if child.Name == name then
			if found then
				return nil
			end
			found = child
		end
	end
	return found
end

function M.resolvePathWithGuiFallback(path)
	local direct = M.resolvePath(path)
	if direct then
		return direct, path
	end

	local remapped = M.mapWorkspacePathToStarterGui(path)
	if remapped then
		local remappedInstance = M.resolvePath(remapped)
		if remappedInstance then
			return remappedInstance, remapped
		end
	end

	if type(path) == "string" then
		local lastSegment = string.match(path, "([^%.]+)$")
		local starterGui = game:GetService("StarterGui")
		local guessed = M.findUniqueDescendantByName(starterGui, tostring(lastSegment or ""))
		if guessed then
			return guessed, M.getInstancePath(guessed)
		end
	end

	return nil, path
end

function M.collectInstancesByQuery(query)
	local queryTable = type(query) == "table" and query or {}
	local rootPath = tostring(queryTable.rootPath or "game")
	local root = M.resolvePath(rootPath)
	if not root then
		return {}, {
			visited = 0,
			rootPath = rootPath,
			error = "Query root not found",
		}
	end

	local recursive = queryTable.recursive ~= false
	local className = tostring(queryTable.className or "")
	local nameContains = Utils.toLowerSafe(queryTable.nameContains)
	local pathContains = Utils.toLowerSafe(queryTable.pathContains)
	local maxResults = math.clamp(tonumber(queryTable.maxResults) or 200, 1, 2000)
	local maxScan = math.clamp(tonumber(queryTable.maxScan) or 25000, 50, 70000)

	local propertyName = tostring(queryTable.propertyName or "")
	local propertyValue = queryTable.propertyValue
	local scriptContentContains = Utils.toLowerSafe(queryTable.scriptContentContains)
	local hasTag = tostring(queryTable.hasTag or "")
	local hasAttribute = tostring(queryTable.hasAttribute or "")
	local attributeValue = queryTable.attributeValue

	local queue = { root }
	local queueHead = 1
	local matches = {}
	local visited = 0

	while queueHead <= #queue and visited < maxScan and #matches < maxResults do
		local current = queue[queueHead]
		queueHead = queueHead + 1
		visited = visited + 1

		local instancePath = M.getInstancePath(current)
		local classOk = className == "" or current:IsA(className)
		local nameOk = nameContains == "" or string.find(Utils.toLowerSafe(current.Name), nameContains, 1, true) ~= nil
		local pathOk = pathContains == "" or string.find(Utils.toLowerSafe(instancePath), pathContains, 1, true) ~= nil

		local propOk = true
		if propertyName ~= "" and propertyValue ~= nil then
			propOk = false
			local readOk, propVal = pcall(function() return current[propertyName] end)
			if readOk then
				if tostring(propVal) == tostring(propertyValue) then
					propOk = true
				elseif type(propVal) == "boolean" and propVal == (propertyValue == true or propertyValue == "true") then
					propOk = true
				end
			end
		end

		local scriptOk = true
		if scriptContentContains ~= "" then
			scriptOk = false
			if current:IsA("LuaSourceContainer") then
				local readOk, source = pcall(function() return current.Source end)
				if readOk and type(source) == "string" then
					if string.find(string.lower(source), scriptContentContains, 1, true) ~= nil then
						scriptOk = true
					end
				end
			end
		end

		local tagOk = true
		if hasTag ~= "" then
			tagOk = false
			local tagCheckOk, hasTg = pcall(function() return CollectionService:HasTag(current, hasTag) end)
			if tagCheckOk and hasTg then
				tagOk = true
			end
		end

		local attrOk = true
		if hasAttribute ~= "" then
			attrOk = false
			local attrCheckOk, attrVal = pcall(function() return current:GetAttribute(hasAttribute) end)
			if attrCheckOk and attrVal ~= nil then
				if attributeValue == nil then
					attrOk = true
				elseif tostring(attrVal) == tostring(attributeValue) then
					attrOk = true
				end
			end
		end

		if classOk and nameOk and pathOk and propOk and scriptOk and tagOk and attrOk then
			table.insert(matches, current)
		end

		local shouldQueueChildren = recursive or current == root
		if shouldQueueChildren then
			local children = current:GetChildren()
			table.sort(children, function(a, b)
				return a.Name < b.Name
			end)
			for _, child in ipairs(children) do
				table.insert(queue, child)
			end
		end
	end

	return matches, {
		visited = visited,
		rootPath = rootPath,
		maxScan = maxScan,
		recursive = recursive,
		truncated = #matches >= maxResults or visited >= maxScan,
	}
end

function M.pathsFromInstances(instances)
	local out = {}
	for _, instance in ipairs(instances) do
		table.insert(out, M.getInstancePath(instance))
	end
	return out
end

return M
