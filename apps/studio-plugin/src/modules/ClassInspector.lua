local CollectionService = game:GetService("CollectionService")

local M = {}

function M.serializeValue(val)
	local t = typeof(val)
	if t == "Vector3" then
		return { x = val.X, y = val.Y, z = val.Z, _type = "Vector3" }
	elseif t == "Vector2" then
		return { x = val.X, y = val.Y, _type = "Vector2" }
	elseif t == "Color3" then
		return { r = math.floor(val.R * 255 + 0.5), g = math.floor(val.G * 255 + 0.5), b = math.floor(val.B * 255 + 0.5), _type = "Color3" }
	elseif t == "UDim2" then
		return { X = { Scale = val.X.Scale, Offset = val.X.Offset }, Y = { Scale = val.Y.Scale, Offset = val.Y.Offset }, _type = "UDim2" }
	elseif t == "UDim" then
		return { Scale = val.Scale, Offset = val.Offset, _type = "UDim" }
	elseif t == "CFrame" then
		local pos = val.Position
		local rx, ry, rz = val:ToEulerAnglesXYZ()
		return { position = { x = pos.X, y = pos.Y, z = pos.Z }, rotation = { x = math.deg(rx), y = math.deg(ry), z = math.deg(rz) }, _type = "CFrame" }
	elseif t == "BrickColor" then
		return { Name = val.Name, _type = "BrickColor" }
	elseif t == "EnumItem" then
		return tostring(val)
	elseif t == "NumberRange" then
		return { Min = val.Min, Max = val.Max, _type = "NumberRange" }
	elseif t == "Instance" then
		return { path = PathResolver.getInstancePath(val), _type = "Instance" }
	elseif t == "boolean" or t == "number" or t == "string" then
		return val
	else
		return tostring(val)
	end
end

M.COMMON_PROPERTIES = {
	"Name", "ClassName", "Parent",
	"Position", "Size", "CFrame", "Orientation", "Anchored", "CanCollide", "CanQuery", "CanTouch",
	"Transparency", "Reflectance", "Material", "BrickColor", "Color",
	"Shape", "TopSurface", "BottomSurface", "Massless", "RootPriority",
	"BackgroundColor3", "BackgroundTransparency", "BorderColor3", "BorderSizePixel",
	"TextColor3", "TextStrokeColor3", "TextStrokeTransparency",
	"AbsolutePosition", "AbsoluteSize", "AnchorPoint", "LayoutOrder",
	"SizeConstraint", "ZIndex", "Visible", "Active", "ClipsDescendants",
	"Text", "TextScaled", "TextSize", "TextWrapped", "Font", "FontFace",
	"PlaceholderText", "PlaceholderColor3", "ClearTextOnFocus",
	"RichText", "MaxVisibleGraphemes",
	"Image", "ImageColor3", "ImageTransparency", "ScaleType", "SliceCenter",
	"SoundId", "Volume", "PlaybackSpeed", "Looped", "Playing", "TimePosition",
	"Brightness", "Range", "Shadows", "Angle",
	"Enabled", "RunContext",
	"Health", "MaxHealth", "WalkSpeed", "JumpPower", "JumpHeight",
	"PrimaryPart", "WorldPivot",
}

local CLASS_PROBE_PROPERTIES = {
	"Name", "Parent", "Archivable",
	"Position", "Size", "CFrame", "Orientation", "Anchored", "CanCollide", "CanQuery", "CanTouch",
	"Transparency", "Reflectance", "Material", "BrickColor", "Color",
	"Shape", "TopSurface", "BottomSurface", "Massless", "RootPriority",
	"BackgroundColor3", "BackgroundTransparency", "BorderColor3", "BorderSizePixel",
	"TextColor3", "TextStrokeColor3", "TextStrokeTransparency",
	"AnchorPoint", "LayoutOrder", "SizeConstraint", "ZIndex", "Visible", "Active",
	"ClipsDescendants", "AutomaticSize",
	"Text", "TextScaled", "TextSize", "TextWrapped", "Font", "FontFace",
	"PlaceholderText", "RichText", "MaxVisibleGraphemes",
	"Image", "ImageColor3", "ImageTransparency", "ScaleType", "SliceCenter",
	"SoundId", "Volume", "PlaybackSpeed", "Looped", "Playing",
	"Brightness", "Range", "Shadows", "Angle",
	"Enabled", "RunContext", "Source",
	"Health", "MaxHealth", "WalkSpeed", "JumpPower", "JumpHeight",
	"PrimaryPart", "WorldPivot",
	"Value", "MaxValue", "MinValue",
	"Adornee", "AlwaysOnTop", "StudsOffset", "MaxDistance",
	"FillColor", "FillTransparency", "LineColor", "LineTransparency",
	"Thickness", "ApplyStrokeMode",
	"CornerRadius", "PaddingLeft", "PaddingRight", "PaddingTop", "PaddingBottom",
	"FillDirection", "HorizontalAlignment", "VerticalAlignment", "SortOrder", "Padding",
	"AspectRatio", "DominantAxis", "AspectType",
	"MaxTextSize", "MinTextSize",
}

local CLASS_PROBE_METHODS = {
	"Destroy", "Clone", "FindFirstChild", "FindFirstChildOfClass", "FindFirstChildWhichIsA",
	"GetChildren", "GetDescendants", "WaitForChild", "IsA", "IsAncestorOf", "IsDescendantOf",
	"GetFullName", "GetAttribute", "SetAttribute", "GetAttributes",
	"GetTags", "AddTag", "RemoveTag", "HasTag",
	"MoveTo", "SetPrimaryPartCFrame", "GetBoundingBox",
	"Play", "Stop", "Pause", "Resume",
	"Fire", "Invoke", "Connect",
	"TweenPosition", "TweenSize", "TweenSizeAndPosition",
}

local CLASS_PROBE_BASES = {
	"BasePart", "GuiObject", "GuiBase2d", "LuaSourceContainer", "ValueBase",
	"Model", "Humanoid", "Tool", "Camera", "Sound", "Light",
	"UIComponent", "UILayout", "UIConstraint",
	"Attachment", "Constraint",
}

local classInfoCache = {}

function M.applyGetInstanceProperties(action)
	local target = PathResolver.resolvePath(action.path)
	if not target then
		error("get_instance_properties path not found: " .. tostring(action.path))
	end

	local properties = {}
	for _, propName in ipairs(M.COMMON_PROPERTIES) do
		local ok, val = pcall(function() return target[propName] end)
		if ok and val ~= nil then
			properties[propName] = M.serializeValue(val)
		end
	end

	local scriptSource = nil
	local numberedSource = nil
	local lineCount = nil
	if target:IsA("LuaSourceContainer") then
		local ok, src = pcall(function() return target.Source end)
		if ok then
			local rawSrc = tostring(src)
			scriptSource = string.sub(rawSrc, 1, 30000)
			local srcLines = ScriptWriter.splitLines(rawSrc)
			lineCount = #srcLines
			local numbered = {}
			for i, line in ipairs(srcLines) do
				table.insert(numbered, tostring(i) .. ": " .. line)
			end
			numberedSource = string.sub(table.concat(numbered, "\n"), 1, 40000)
		end
	end

	local attributes = {}
	local ok, attrs = pcall(function() return target:GetAttributes() end)
	if ok and type(attrs) == "table" then
		for k, v in pairs(attrs) do
			attributes[k] = M.serializeValue(v)
		end
	end

	local tags = {}
	local tagOk, tagList = pcall(function() return CollectionService:GetTags(target) end)
	if tagOk and type(tagList) == "table" then
		tags = tagList
	end

	local path = PathResolver.getInstancePath(target)
	UI.appendLog("get_instance_properties -> " .. path .. " (" .. tostring(#properties) .. " props)")
	return {
		type = "get_instance_properties",
		path = path,
		name = target.Name,
		summary = "Property dump for " .. target.ClassName,
		details = {
			className = target.ClassName,
			properties = properties,
			attributes = attributes,
			tags = tags,
			scriptSource = scriptSource,
			numberedSource = numberedSource,
			lineCount = lineCount,
		},
	}
end

function M.applyGetClassInfo(action)
	local className = tostring(action.className or "")
	if className == "" then
		error("get_class_info: className is empty")
	end

	if classInfoCache[className] then
		UI.appendLog("get_class_info -> " .. className .. " (cached)")
		return classInfoCache[className]
	end

	local ok, probe = pcall(Instance.new, className)
	if not ok or not probe then
		error("get_class_info: cannot create instance of " .. className)
	end

	local supportedProperties = {}
	for _, propName in ipairs(CLASS_PROBE_PROPERTIES) do
		local propOk, val = pcall(function() return probe[propName] end)
		if propOk then
			table.insert(supportedProperties, propName)
		end
	end

	local supportedMethods = {}
	for _, methodName in ipairs(CLASS_PROBE_METHODS) do
		local methodOk, val = pcall(function() return type(probe[methodName]) == "function" end)
		if methodOk and val then
			table.insert(supportedMethods, methodName)
		end
	end

	local baseClasses = {}
	for _, baseName in ipairs(CLASS_PROBE_BASES) do
		local baseOk, isBase = pcall(function() return probe:IsA(baseName) end)
		if baseOk and isBase then
			table.insert(baseClasses, baseName)
		end
	end

	probe:Destroy()

	local result = {
		type = "get_class_info",
		summary = "Class info for " .. className,
		details = {
			className = className,
			supportedProperties = supportedProperties,
			supportedMethods = supportedMethods,
			baseClasses = baseClasses,
		},
	}
	classInfoCache[className] = result
	UI.appendLog("get_class_info -> " .. className .. " (" .. tostring(#supportedProperties) .. " props, " .. tostring(#supportedMethods) .. " methods)")
	return result
end

return M
