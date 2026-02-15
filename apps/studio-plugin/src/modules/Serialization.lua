local CollectionService = game:GetService("CollectionService")
local Selection = game:GetService("Selection")

local M = {}

-- ── Incremental Context Cache ──
local _cache = {
	serviceNodes = {},       -- serviceName -> serialized node
	serviceBudgets = {},     -- serviceName -> budget.count used
	pathIndex = nil,         -- cached path index
	dirty = {},              -- serviceName -> true if changed since last build
	listeners = {},          -- serviceName -> {addedConn, removedConn}
	lastFullBuildAt = 0,
	initialized = false,
}

local FULL_REBUILD_INTERVAL = 60  -- seconds between forced full rebuilds

local function markServiceDirty(serviceName)
	_cache.dirty[serviceName] = true
end

local function setupServiceListeners()
	if _cache.initialized then return end
	_cache.initialized = true

	for _, serviceName in ipairs(Constants.CONTEXT_SERVICE_NAMES) do
		local serviceInstance = PathResolver.getServiceByName(serviceName)
		if serviceInstance then
			local conns = {}
			conns.added = serviceInstance.DescendantAdded:Connect(function()
				markServiceDirty(serviceName)
			end)
			conns.removed = serviceInstance.DescendantRemoving:Connect(function()
				markServiceDirty(serviceName)
			end)
			_cache.listeners[serviceName] = conns
			_cache.dirty[serviceName] = true  -- initial state: all dirty
		end
	end
end

local function sortByName(a, b)
	return a.Name < b.Name
end

function M.serializeInstance(instance, depth, maxChildren, budget)
	if budget and budget.count >= budget.maxNodes then
		return {
			name = instance.Name,
			className = instance.ClassName,
			path = PathResolver.getInstancePath(instance),
			truncated = true,
		}
	end

	if budget then
		budget.count = budget.count + 1
	end

	local node = {
		name = instance.Name,
		className = instance.ClassName,
		path = PathResolver.getInstancePath(instance),
	}

	local importantProps = {}
	local propertyCandidates = {
		"Text",
		"Visible",
		"Enabled",
		"Name",
	}
	for _, propName in ipairs(propertyCandidates) do
		local ok, propValue = pcall(function()
			return instance[propName]
		end)
		if ok and (type(propValue) == "string" or type(propValue) == "boolean" or type(propValue) == "number") then
			importantProps[propName] = propValue
		end
	end
	if next(importantProps) ~= nil then
		node.properties = importantProps
	end

	local scriptClasses = {
		Script = true,
		LocalScript = true,
		ModuleScript = true,
	}

	if scriptClasses[instance.ClassName] then
		local ok, source = pcall(function()
			return instance.Source
		end)
		if ok and type(source) == "string" then
			node.sourcePreview = string.sub(source, 1, 1200)
			node.sourceLength = #source
		end
	end

	local attributes = {}
	local attrOk, attrList = pcall(function() return instance:GetAttributes() end)
	if attrOk and type(attrList) == "table" then
		for attrName, attrValue in pairs(attrList) do
			attributes[attrName] = attrValue
		end
	end
	if next(attributes) ~= nil then
		node.attributes = attributes
	end

	local tagOk, tagList = pcall(function() return CollectionService:GetTags(instance) end)
	if tagOk and type(tagList) == "table" and #tagList > 0 then
		node.tags = tagList
	end

	if depth <= 0 then
		return node
	end

	if budget and budget.count >= budget.maxNodes then
		node.truncated = true
		return node
	end

	local children = instance:GetChildren()
	table.sort(children, sortByName)

	local limit = math.min(#children, maxChildren)
	if limit > 0 then
		node.children = {}
		for index = 1, limit do
			table.insert(node.children, M.serializeInstance(children[index], depth - 1, maxChildren, budget))
			if budget and budget.count >= budget.maxNodes then
				node.truncated = true
				break
			end
		end
	end

	if #children > maxChildren then
		node.truncatedChildren = #children - maxChildren
	end

	return node
end

function M.buildPathIndex(rootInstances, maxEntries)
	local index = {}
	local queue = {}
	for _, root in ipairs(rootInstances) do
		queue[#queue + 1] = root
	end

	local queueHead = 1
	while queueHead <= #queue and #index < maxEntries do
		local current = queue[queueHead]
		queueHead = queueHead + 1
		index[#index + 1] = {
			path = PathResolver.getInstancePath(current),
			name = current.Name,
			className = current.ClassName,
			childCount = #current:GetChildren(),
		}

		local children = current:GetChildren()
		table.sort(children, sortByName)
		for _, child in ipairs(children) do
			if #index + (#queue - queueHead + 1) >= maxEntries then
				break
			end
			queue[#queue + 1] = child
		end
	end

	return index
end

-- Priority weights for services (higher = more budget allocation)
local SERVICE_PRIORITY = {
	Workspace = 10,
	StarterGui = 8,
	ReplicatedStorage = 8,
	ServerScriptService = 7,
	StarterPlayer = 5,
	Lighting = 2,
	SoundService = 2,
	Teams = 1,
	CollectionService = 1,
}

local function countDescendants(instance, maxCount)
	local count = 0
	local queue = { instance }
	local head = 1
	while head <= #queue and count < maxCount do
		local current = queue[head]
		head = head + 1
		count = count + 1
		for _, child in ipairs(current:GetChildren()) do
			queue[#queue + 1] = child
		end
	end
	return count
end

function M.buildStudioContext()
	local selected = Selection:Get()
	local explorerRoots = {}
	for _, serviceName in ipairs(Constants.CONTEXT_SERVICE_NAMES) do
		local serviceInstance = PathResolver.getServiceByName(serviceName)
		if serviceInstance then
			table.insert(explorerRoots, serviceInstance)
		end
	end

	local selectedPaths = {}
	for _, item in ipairs(selected) do
		table.insert(selectedPaths, PathResolver.getInstancePath(item))
	end

	-- Pre-count descendants per service and compute budget allocation
	local totalBudget = Constants.CONTEXT_MAX_NODES
	local serviceInfo = {}
	local totalWeightedDemand = 0
	for _, rootInstance in ipairs(explorerRoots) do
		local desc = countDescendants(rootInstance, totalBudget)
		local weight = SERVICE_PRIORITY[rootInstance.Name] or 3
		local info = { instance = rootInstance, descendantCount = desc, weight = weight }
		table.insert(serviceInfo, info)
		totalWeightedDemand = totalWeightedDemand + (desc * weight)
	end

	-- Allocate budget: proportional to (descendantCount * weight), capped at actual need
	local budgetAllocations = {}
	local allocated = 0
	for _, info in ipairs(serviceInfo) do
		local share
		if totalWeightedDemand > 0 then
			share = math.floor(totalBudget * (info.descendantCount * info.weight) / totalWeightedDemand)
		else
			share = math.floor(totalBudget / #serviceInfo)
		end
		-- Don't allocate more than the service actually has
		share = math.min(share, info.descendantCount)
		-- Minimum 10 nodes for any service that has children
		if info.descendantCount > 0 then
			share = math.max(share, 10)
		end
		budgetAllocations[info.instance] = share
		allocated = allocated + share
	end

	-- Distribute remaining budget to highest-priority services
	local remaining = totalBudget - allocated
	if remaining > 0 then
		-- Sort by priority descending
		local sorted = {}
		for _, info in ipairs(serviceInfo) do
			if info.descendantCount > budgetAllocations[info.instance] then
				table.insert(sorted, info)
			end
		end
		table.sort(sorted, function(a, b) return a.weight > b.weight end)
		for _, info in ipairs(sorted) do
			if remaining <= 0 then break end
			local canUse = info.descendantCount - budgetAllocations[info.instance]
			local give = math.min(canUse, remaining)
			budgetAllocations[info.instance] = budgetAllocations[info.instance] + give
			remaining = remaining - give
		end
	end

	-- Initialize incremental listeners (once)
	setupServiceListeners()

	-- Determine if we need a forced full rebuild
	local now = os.clock()
	local forceFullRebuild = (now - _cache.lastFullBuildAt) >= FULL_REBUILD_INTERVAL

	local totalCount = 0
	local rootNodes = {}
	local cacheHits = 0
	for _, info in ipairs(serviceInfo) do
		local svcName = info.instance.Name
		local isDirty = _cache.dirty[svcName] or forceFullRebuild or not _cache.serviceNodes[svcName]

		if isDirty then
			-- Re-serialize this service
			local serviceBudget = {
				count = 0,
				maxNodes = budgetAllocations[info.instance] or 100,
			}
			local node = M.serializeInstance(info.instance, Constants.CONTEXT_DEPTH, Constants.CONTEXT_MAX_CHILDREN, serviceBudget)
			_cache.serviceNodes[svcName] = node
			_cache.serviceBudgets[svcName] = serviceBudget.count
			_cache.dirty[svcName] = false
			totalCount = totalCount + serviceBudget.count
			table.insert(rootNodes, node)
		else
			-- Use cached version
			table.insert(rootNodes, _cache.serviceNodes[svcName])
			totalCount = totalCount + (_cache.serviceBudgets[svcName] or 0)
			cacheHits = cacheHits + 1
		end
	end

	if forceFullRebuild then
		_cache.lastFullBuildAt = now
	end

	-- Rebuild path index only if any service was dirty or no cache exists
	if cacheHits < #serviceInfo or not _cache.pathIndex then
		_cache.pathIndex = M.buildPathIndex(explorerRoots, 3200)
	end
	local pathIndex = _cache.pathIndex

	local selectedNodes = {}
	for _, instance in ipairs(selected) do
		table.insert(selectedNodes, M.serializeInstance(instance, 3, 60, {
			count = 0,
			maxNodes = 500,
		}))
	end

	local scriptSources = {}
	for _, instance in ipairs(selected) do
		if instance:IsA("LuaSourceContainer") then
			local ok, source = pcall(function() return instance.Source end)
			if ok and type(source) == "string" then
				table.insert(scriptSources, {
					path = PathResolver.getInstancePath(instance),
					name = instance.Name,
					className = instance.ClassName,
					source = string.sub(source, 1, 30000),
					lineCount = Utils.countLines(source),
				})
			end
		end
	end

	return {
		placeId = game.PlaceId,
		placeVersion = game.PlaceVersion,
		selectedPaths = selectedPaths,
		rootNodes = rootNodes,
		selectedNodes = selectedNodes,
		scriptSources = scriptSources,
		explorer = {
			rootServices = Constants.CONTEXT_SERVICE_NAMES,
			pathIndex = pathIndex,
			totalNodesCaptured = totalCount,
			maxNodes = totalBudget,
			truncated = totalCount >= totalBudget,
		},
		capturedAt = os.time(),
	}
end

return M
