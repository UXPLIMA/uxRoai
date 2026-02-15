local M = {}

function M.trim(text)
	return (string.gsub(text, "^%s*(.-)%s*$", "%1"))
end

function M.toLowerSafe(value)
	return string.lower(tostring(value or ""))
end

function M.isArrayTable(value)
	if type(value) ~= "table" then
		return false
	end
	local maxIndex = 0
	for key, _ in pairs(value) do
		if type(key) ~= "number" or key <= 0 or math.floor(key) ~= key then
			return false
		end
		if key > maxIndex then
			maxIndex = key
		end
	end
	for index = 1, maxIndex do
		if value[index] == nil then
			return false
		end
	end
	return true
end

function M.toLuauLiteral(value, depth)
	local level = depth or 0
	if level > 6 then
		return "nil"
	end

	local valueType = type(value)
	if valueType == "string" then
		return string.format("%q", value)
	end
	if valueType == "number" then
		if value ~= value or value == math.huge or value == -math.huge then
			return "0"
		end
		return tostring(value)
	end
	if valueType == "boolean" then
		return value and "true" or "false"
	end
	if value == nil then
		return "nil"
	end
	if valueType ~= "table" then
		return string.format("%q", tostring(value))
	end

	local parts = {}
	if M.isArrayTable(value) then
		for _, item in ipairs(value) do
			table.insert(parts, M.toLuauLiteral(item, level + 1))
		end
		return "{ " .. table.concat(parts, ", ") .. " }"
	end

	local keys = {}
	for key in pairs(value) do
		table.insert(keys, key)
	end
	table.sort(keys, function(a, b)
		return tostring(a) < tostring(b)
	end)

	for _, key in ipairs(keys) do
		local keyText
		if type(key) == "string" and string.match(key, "^[_%a][_%w]*$") then
			keyText = key
		else
			keyText = "[" .. M.toLuauLiteral(key, level + 1) .. "]"
		end
		table.insert(parts, keyText .. " = " .. M.toLuauLiteral(value[key], level + 1))
	end

	return "{ " .. table.concat(parts, ", ") .. " }"
end

function M.countLines(text)
	local raw = tostring(text or "")
	if raw == "" then
		return 0
	end
	local count = 1
	for _ in string.gmatch(raw, "\n") do
		count = count + 1
	end
	return count
end

function M.normalizeEscapes(src)
	if type(src) ~= "string" then return src end
	-- Process \\\\ first to protect escaped backslashes
	src = src:gsub("\\\\", "\0ESCAPED_BACKSLASH\0")
	src = src:gsub("\\n", "\n")
	src = src:gsub("\\t", "\t")
	src = src:gsub("\\r", "\r")
	src = src:gsub("\0ESCAPED_BACKSLASH\0", "\\")
	return src
end

function M.normalizeAgentUrl(url)
	local cleaned = M.trim(url or "")
	if cleaned == "" then
		cleaned = Constants.DEFAULT_AGENT_URL
	end
	if string.sub(cleaned, -1) == "/" then
		cleaned = string.sub(cleaned, 1, -2)
	end
	return cleaned
end

function M.loadAgentUrl()
	local saved = plugin:GetSetting("AgentUrl")
	if type(saved) == "string" and saved ~= "" then
		return saved
	end
	return Constants.DEFAULT_AGENT_URL
end

function M.saveAgentUrl(url)
	local normalized = M.normalizeAgentUrl(url)
	plugin:SetSetting("AgentUrl", normalized)
	return normalized
end

function M.normalizeVariantEntries(variants)
	local normalized = {}
	for _, variant in ipairs(variants) do
		if type(variant) == "string" then
			table.insert(normalized, {
				name = variant,
				propertyOverrides = {},
			})
		elseif type(variant) == "table" then
			local name = tostring(variant.name or "")
			if name ~= "" then
				table.insert(normalized, {
					name = name,
					propertyOverrides = type(variant.propertyOverrides) == "table" and variant.propertyOverrides or {},
				})
			end
		end
	end
	return normalized
end

return M
