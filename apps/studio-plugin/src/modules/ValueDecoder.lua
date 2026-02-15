local M = {}

function M.decodeValue(value, instance, propertyName)
	local function readNumber(raw, keyList)
		if type(raw) ~= "table" then
			return nil
		end
		for _, key in ipairs(keyList) do
			local candidate = raw[key]
			if candidate ~= nil then
				local num = tonumber(candidate)
				if num ~= nil then
					return num
				end
			end
		end
		return nil
	end

	local function unpackNested(raw)
		local current = raw
		for _ = 1, 4 do
			if type(current) ~= "table" then
				break
			end
			if current.__type ~= nil or current.type ~= nil or current.kind ~= nil then
				break
			end
			if type(current.value) == "table" then
				current = current.value
			elseif type(current.data) == "table" then
				current = current.data
			else
				break
			end
		end
		return current
	end

	local function readColor3(raw, allowVectorFallback)
		if type(raw) == "string" then
			local hex = string.match(raw, "^#?(%x%x%x%x%x%x)$")
			if hex then
				local r = tonumber(string.sub(hex, 1, 2), 16) or 0
				local g = tonumber(string.sub(hex, 3, 4), 16) or 0
				local b = tonumber(string.sub(hex, 5, 6), 16) or 0
				return Color3.fromRGB(r, g, b)
			end
			return nil
		end
		if type(raw) ~= "table" then
			return nil
		end

		local r = readNumber(raw, { "r", "R", "red", "Red", 1 })
		local g = readNumber(raw, { "g", "G", "green", "Green", 2 })
		local b = readNumber(raw, { "b", "B", "blue", "Blue", 3 })
		if (r == nil or g == nil or b == nil) and allowVectorFallback then
			r = readNumber(raw, { "x", "X", 1 })
			g = readNumber(raw, { "y", "Y", 2 })
			b = readNumber(raw, { "z", "Z", 3 })
		end

		if r == nil or g == nil or b == nil then
			return nil
		end

		if r > 1 or g > 1 or b > 1 then
			r = r / 255
			g = g / 255
			b = b / 255
		end

		return Color3.new(
			math.clamp(r, 0, 1),
			math.clamp(g, 0, 1),
			math.clamp(b, 0, 1)
		)
	end

	local function readVector3(raw)
		if type(raw) ~= "table" then
			return nil
		end
		local x = readNumber(raw, { "x", "X", 1 })
		local y = readNumber(raw, { "y", "Y", 2 })
		local z = readNumber(raw, { "z", "Z", 3 })
		if x == nil or y == nil or z == nil then
			return nil
		end
		return Vector3.new(x, y, z)
	end

	local function readVector2(raw)
		if type(raw) ~= "table" then
			return nil
		end
		local x = readNumber(raw, { "x", "X", 1 })
		local y = readNumber(raw, { "y", "Y", 2 })
		if x == nil or y == nil then
			return nil
		end
		return Vector2.new(x, y)
	end

	local function readUDim(raw)
		if type(raw) == "number" then
			return UDim.new(raw, 0)
		end
		if type(raw) ~= "table" then
			return nil
		end

		local scale = readNumber(raw, { "scale", "Scale", "s", "x", "X", 1 })
		local offset = readNumber(raw, { "offset", "Offset", "o", "y", "Y", 2 })
		if scale == nil and offset == nil then
			return nil
		end
		if scale == nil then
			scale = 0
		end
		if offset == nil then
			offset = 0
		end
		return UDim.new(scale, offset)
	end

	local function readUDim2(raw)
		if type(raw) ~= "table" then
			return nil
		end

		local xScale = readNumber(raw, { "xScale", "XScale", "sx", 1 })
		local xOffset = readNumber(raw, { "xOffset", "XOffset", "ox", 2 })
		local yScale = readNumber(raw, { "yScale", "YScale", "sy", 3 })
		local yOffset = readNumber(raw, { "yOffset", "YOffset", "oy", 4 })

		if xScale == nil and xOffset == nil and yScale == nil and yOffset == nil then
			if type(raw.scale) == "table" then
				xScale = readNumber(raw.scale, { "x", "X", 1 })
				yScale = readNumber(raw.scale, { "y", "Y", 2 })
			end
			if type(raw.offset) == "table" then
				xOffset = readNumber(raw.offset, { "x", "X", 1 })
				yOffset = readNumber(raw.offset, { "y", "Y", 2 })
			end
		end

		if type(raw.x) == "table" then
			xScale = xScale or readNumber(raw.x, { "scale", "Scale", "s", 1 })
			xOffset = xOffset or readNumber(raw.x, { "offset", "Offset", "o", 2 })
		end
		if type(raw.X) == "table" then
			xScale = xScale or readNumber(raw.X, { "scale", "Scale", "s", 1 })
			xOffset = xOffset or readNumber(raw.X, { "offset", "Offset", "o", 2 })
		end
		if type(raw.y) == "table" then
			yScale = yScale or readNumber(raw.y, { "scale", "Scale", "s", 1 })
			yOffset = yOffset or readNumber(raw.y, { "offset", "Offset", "o", 2 })
		end
		if type(raw.Y) == "table" then
			yScale = yScale or readNumber(raw.Y, { "scale", "Scale", "s", 1 })
			yOffset = yOffset or readNumber(raw.Y, { "offset", "Offset", "o", 2 })
		end

		if type(raw.xScale) == "table" then
			xScale = xScale or readNumber(raw.xScale, { "scale", "s", "value", 1 })
		end
		if type(raw.yScale) == "table" then
			yScale = yScale or readNumber(raw.yScale, { "scale", "s", "value", 1 })
		end

		if xScale == nil and xOffset == nil and yScale == nil and yOffset == nil then
			return nil
		end

		return UDim2.new(xScale or 0, xOffset or 0, yScale or 0, yOffset or 0)
	end

	local function readNumberRange(raw)
		if type(raw) == "number" then
			return NumberRange.new(raw)
		end
		if type(raw) ~= "table" then
			return nil
		end

		local minValue = readNumber(raw, { "min", "Min", "from", "start", "x", "X", 1 })
		local maxValue = readNumber(raw, { "max", "Max", "to", "finish", "end", "y", "Y", 2 })
		if minValue == nil and maxValue == nil then
			return nil
		end
		if minValue == nil then
			minValue = maxValue
		end
		if maxValue == nil then
			maxValue = minValue
		end
		return NumberRange.new(minValue or 0, maxValue or minValue or 0)
	end

	local function readNumberSequence(raw)
		if type(raw) == "number" then
			return NumberSequence.new(raw)
		end
		if type(raw) ~= "table" then
			return nil
		end

		local keypointsRaw = raw.keypoints
		if type(keypointsRaw) == "table" and #keypointsRaw > 0 then
			local keypoints = {}
			for _, item in ipairs(keypointsRaw) do
				if type(item) == "table" then
					local tValue = readNumber(item, { "time", "t", 1 }) or 0
					local vValue = readNumber(item, { "value", "v", "amount", 2 })
					local envelope = readNumber(item, { "envelope", "e", 3 }) or 0
					if vValue ~= nil then
						table.insert(keypoints, NumberSequenceKeypoint.new(math.clamp(tValue, 0, 1), vValue, envelope))
					end
				end
			end
			if #keypoints == 1 then
				return NumberSequence.new(keypoints[1].Value)
			end
			if #keypoints > 1 then
				table.sort(keypoints, function(a, b)
					return a.Time < b.Time
				end)
				return NumberSequence.new(keypoints)
			end
		end

		local startValue = readNumber(raw, { "start", "from", "min", "x", "X", 1 })
		local endValue = readNumber(raw, { "finish", "end", "max", "to", "y", "Y", 2 })
		if startValue == nil and endValue == nil then
			return nil
		end
		if startValue == nil then
			startValue = endValue
		end
		if endValue == nil then
			endValue = startValue
		end
		return NumberSequence.new({
			NumberSequenceKeypoint.new(0, startValue or 0),
			NumberSequenceKeypoint.new(1, endValue or startValue or 0),
		})
	end

	local function readColorSequence(raw)
		if type(raw) ~= "table" then
			local single = readColor3(raw, true)
			if single then
				return ColorSequence.new(single)
			end
			return nil
		end

		local keypointsRaw = raw.keypoints
		if type(keypointsRaw) == "table" and #keypointsRaw > 0 then
			local keypoints = {}
			for _, item in ipairs(keypointsRaw) do
				if type(item) == "table" then
					local tValue = readNumber(item, { "time", "t", 1 }) or 0
					local colorValue = readColor3(item.color or item.value or item, true)
					if colorValue then
						table.insert(keypoints, ColorSequenceKeypoint.new(math.clamp(tValue, 0, 1), colorValue))
					end
				end
			end
			if #keypoints == 1 then
				return ColorSequence.new(keypoints[1].Value)
			end
			if #keypoints > 1 then
				table.sort(keypoints, function(a, b)
					return a.Time < b.Time
				end)
				return ColorSequence.new(keypoints)
			end
		end

		local first = readColor3(raw[1], true)
		local second = readColor3(raw[2], true)
		if first and second then
			return ColorSequence.new(first, second)
		end
		if first then
			return ColorSequence.new(first)
		end

		local single = readColor3(raw, true)
		if single then
			return ColorSequence.new(single)
		end
		return nil
	end

	local function readEnum(raw)
		if type(raw) ~= "table" then
			return nil
		end
		local enumTypeName = raw.enumType or raw.typeName or raw.enum
		local enumItemName = raw.enumItem or raw.item or raw.name
		if enumTypeName and enumItemName then
			local enumType = Enum[enumTypeName]
			if enumType and enumType[enumItemName] then
				return enumType[enumItemName]
			end
		end
		return nil
	end

	local raw = unpackNested(value)
	local propertyLower = string.lower(tostring(propertyName or ""))
	local expectedType = ""
	if instance and propertyName and propertyName ~= "" then
		pcall(function()
			expectedType = typeof(instance[propertyName])
		end)
	end
	local valueType = ""
	if type(raw) == "table" then
		valueType = string.lower(tostring(raw.__type or raw.type or raw.kind or ""))
	end

	if expectedType == "Color3" then
		local decoded = readColor3(raw, true)
		if decoded then
			return decoded
		end
	end
	if expectedType == "Vector3" then
		local decoded = readVector3(raw)
		if decoded then
			return decoded
		end
	end
	if expectedType == "Vector2" then
		local decoded = readVector2(raw)
		if decoded then
			return decoded
		end
	end
	if expectedType == "UDim2" then
		local decoded = readUDim2(raw)
		if decoded then
			return decoded
		end
	end
	if expectedType == "UDim" then
		local decoded = readUDim(raw)
		if decoded then
			return decoded
		end
	end
	if expectedType == "CFrame" then
		local decoded = readVector3(raw)
		if decoded then
			return CFrame.new(decoded)
		end
	end
	if expectedType == "NumberRange" then
		local decoded = readNumberRange(raw)
		if decoded then
			return decoded
		end
	end
	if expectedType == "NumberSequence" then
		local decoded = readNumberSequence(raw)
		if decoded then
			return decoded
		end
	end
	if expectedType == "ColorSequence" then
		local decoded = readColorSequence(raw)
		if decoded then
			return decoded
		end
	end
	if expectedType == "EnumItem" then
		local decoded = readEnum(raw)
		if decoded then
			return decoded
		end
		if type(raw) == "string" and instance and propertyName then
			local enumOk, currentEnum = pcall(function() return instance[propertyName] end)
			if enumOk and typeof(currentEnum) == "EnumItem" then
				local enumType = currentEnum.EnumType
				local itemOk, enumItem = pcall(function() return enumType[raw] end)
				if itemOk and enumItem then
					return enumItem
				end
			end
		end
	end
	if expectedType == "BrickColor" then
		if type(raw) == "string" and raw ~= "" then
			local brickOk, brickColor = pcall(BrickColor.new, raw)
			if brickOk and brickColor then
				return brickColor
			end
		end
		if type(raw) == "number" then
			local brickOk, brickColor = pcall(BrickColor.new, raw)
			if brickOk and brickColor then
				return brickColor
			end
		end
	end

	if valueType == "color3" then
		local decoded = readColor3(raw, true)
		if decoded then
			return decoded
		end
	end
	if valueType == "vector3" then
		local decoded = readVector3(raw)
		if decoded then
			return decoded
		end
	end
	if valueType == "vector2" then
		local decoded = readVector2(raw)
		if decoded then
			return decoded
		end
	end
	if valueType == "udim2" then
		local decoded = readUDim2(raw)
		if decoded then
			return decoded
		end
	end
	if valueType == "udim" then
		local decoded = readUDim(raw)
		if decoded then
			return decoded
		end
	end
	if valueType == "numbersequence" then
		local decoded = readNumberSequence(raw)
		if decoded then
			return decoded
		end
	end
	if valueType == "numberrange" then
		local decoded = readNumberRange(raw)
		if decoded then
			return decoded
		end
	end
	if valueType == "colorsequence" then
		local decoded = readColorSequence(raw)
		if decoded then
			return decoded
		end
	end
	if valueType == "enum" then
		local decoded = readEnum(raw)
		if decoded then
			return decoded
		end
	end
	if valueType == "cframe" then
		local decoded = readVector3(raw)
		if decoded then
			return CFrame.new(decoded)
		end
	end

	if string.find(propertyLower, "position", 1, true) ~= nil or string.find(propertyLower, "size", 1, true) ~= nil then
		local decoded = readUDim2(raw)
		if decoded then
			return decoded
		end
	end

	if string.find(propertyLower, "cornerradius", 1, true) ~= nil then
		local decoded = readUDim(raw)
		if decoded then
			return decoded
		end
	end

	if string.find(propertyLower, "color", 1, true) ~= nil or string.find(propertyLower, "ambient", 1, true) ~= nil then
		local decoded = readColor3(raw, true)
		if decoded then
			return decoded
		end
	end

	if type(raw) == "string" and propertyLower == "brickcolor" then
		local brickOk, brickColor = pcall(BrickColor.new, raw)
		if brickOk and brickColor then
			return brickColor
		end
	end

	if type(raw) == "string" and instance and propertyName and propertyName ~= "" then
		local enumOk, currentVal = pcall(function() return instance[propertyName] end)
		if enumOk and typeof(currentVal) == "EnumItem" then
			local enumType = currentVal.EnumType
			local itemOk, enumItem = pcall(function() return enumType[raw] end)
			if itemOk and enumItem then
				return enumItem
			end
		end
	end

	return raw
end

function M.setProperties(instance, properties)
	local result = {
		successCount = 0,
		failedCount = 0,
		failedProperties = {},
	}

	for property, rawValue in pairs(properties) do
		local decoded = M.decodeValue(rawValue, instance, property)
		local ok, err = pcall(function()
			instance[property] = decoded
		end)
		if not ok then
			warn("Property set fail (" .. instance.Name .. "." .. property .. "): " .. tostring(err))
			result.failedCount = result.failedCount + 1
			table.insert(result.failedProperties, {
				property = property,
				error = tostring(err),
			})
		else
			result.successCount = result.successCount + 1
		end
	end

	return result
end

return M
