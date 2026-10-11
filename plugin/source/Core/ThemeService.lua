--!strict

local RunService = game:GetService("RunService")

local ThemeService = {}
ThemeService.__index = ThemeService

export type ThemeService = typeof(setmetatable({
	_settings = nil :: any,
	_theme = nil :: {[string]: any}?,
	_changed = nil :: BindableEvent?,
	_root = nil :: Instance?,
	_rainbowConnection = nil :: RBXScriptConnection?,
	_rainbowAddedConnection = nil :: RBXScriptConnection?,
	_rainbowBindings = {} :: {any},
	_rainbowAccumulator = 0,
}, ThemeService))

local COLOR_PROPERTIES = {
	"BackgroundColor3",
	"BorderColor3",
	"TextColor3",
	"PlaceholderColor3",
	"ImageColor3",
	"ScrollBarImageColor3",
}

local COLOR_ATTRIBUTES = {
	"CursorBaseBackground",
	"CursorBaseForeground",
	"CursorHoverBackground",
	"CursorHoverForeground",
	"EaseColor",
}

local RAINBOW_TOKENS = {
	"Accent",
	"AccentHover",
	"AccentSoft",
	"AccentFaint",
	"Focus",
	"Ring",
	"Secondary",
	"SecondarySoft",
	"Playhead",
	"Selection",
	"KeyframeSelected",
}

local function colorKey(color: Color3): string
	return string.format("%.6f,%.6f,%.6f", color.R, color.G, color.B)
end

local function buildReplacementMap(before: {[string]: Color3}, after: {[string]: Color3}): {[string]: Color3}
	local replacements: {[string]: Color3} = {}
	local names = {}
	for name in before do
		table.insert(names, name)
	end
	table.sort(names)
	for _, name in names do
		local oldColor = before[name]
		local newColor = after[name]
		if newColor then
			local key = colorKey(oldColor)
			if replacements[key] == nil then
				replacements[key] = newColor
			end
		end
	end
	return replacements
end

local function remapObject(object: Instance, replacements: {[string]: Color3})
	for _, propertyName in COLOR_PROPERTIES do
		local ok, current = pcall(function()
			return (object :: any)[propertyName]
		end)
		if ok and typeof(current) == "Color3" then
			local replacement = replacements[colorKey(current)]
			if replacement then
				pcall(function()
					(object :: any)[propertyName] = replacement
				end)
			end
		end
	end

	if object:IsA("UIStroke") then
		local replacement = replacements[colorKey(object.Color)]
		if replacement then
			object.Color = replacement
		end
	end

	for _, attributeName in COLOR_ATTRIBUTES do
		local current = object:GetAttribute(attributeName)
		if typeof(current) == "Color3" then
			local replacement = replacements[colorKey(current)]
			if replacement then
				object:SetAttribute(attributeName, replacement)
			end
		end
	end
end

function ThemeService.new(settingsService: any, themeModule: {[string]: any}): ThemeService
	return setmetatable({
		_settings = settingsService,
		_theme = themeModule,
		_changed = Instance.new("BindableEvent"),
		_root = nil,
		_rainbowConnection = nil,
		_rainbowAddedConnection = nil,
		_rainbowBindings = {},
		_rainbowAccumulator = 0,
	}, ThemeService)
end

function ThemeService:_stopRainbow()
	if self._rainbowConnection then
		self._rainbowConnection:Disconnect()
		self._rainbowConnection = nil
	end
	if self._rainbowAddedConnection then
		self._rainbowAddedConnection:Disconnect()
		self._rainbowAddedConnection = nil
	end
	table.clear(self._rainbowBindings)
	self._rainbowAccumulator = 0
end

function ThemeService:_registerRainbowObject(object: Instance)
	local theme = self._theme
	if not theme then
		return
	end

	local tokenByColor: {[string]: string} = {}
	for _, token in RAINBOW_TOKENS do
		local color = theme[token]
		if typeof(color) == "Color3" then
			tokenByColor[colorKey(color)] = token
		end
	end

	for _, propertyName in COLOR_PROPERTIES do
		local ok, current = pcall(function()
			return (object :: any)[propertyName]
		end)
		if ok and typeof(current) == "Color3" then
			local token = tokenByColor[colorKey(current)]
			if token then
				table.insert(self._rainbowBindings, {
					object = object,
					kind = "property",
					name = propertyName,
					token = token,
				})
			end
		end
	end

	if object:IsA("UIStroke") then
		local token = tokenByColor[colorKey(object.Color)]
		if token then
			table.insert(self._rainbowBindings, {
				object = object,
				kind = "stroke",
				name = "Color",
				token = token,
			})
		end
	end

	for _, attributeName in COLOR_ATTRIBUTES do
		local current = object:GetAttribute(attributeName)
		if typeof(current) == "Color3" then
			local token = tokenByColor[colorKey(current)]
			if token then
				table.insert(self._rainbowBindings, {
					object = object,
					kind = "attribute",
					name = attributeName,
					token = token,
				})
			end
		end
	end
end

function ThemeService:_startRainbow(root: Instance)
	local theme = self._theme
	if not theme or not theme.IsAnimatedPreset(theme.GetActivePreset()) then
		return
	end

	self:_stopRainbow()
	self._root = root
	self:_registerRainbowObject(root)
	for _, descendant in root:GetDescendants() do
		self:_registerRainbowObject(descendant)
	end

	self._rainbowAddedConnection = root.DescendantAdded:Connect(function(descendant)
		self:_registerRainbowObject(descendant)
	end)

	self._rainbowConnection = RunService.Heartbeat:Connect(function(deltaTime)
		self._rainbowAccumulator += deltaTime
		if self._rainbowAccumulator < (1 / 24) then
			return
		end
		self._rainbowAccumulator = 0

		local hue = (os.clock() * 0.075) % 1
		theme.ApplyRainbowHue(hue)
		local bindings = self._rainbowBindings
		local writeIndex = 1
		for readIndex = 1, #bindings do
			local binding = bindings[readIndex]
			local object = binding.object :: Instance
			if object.Parent ~= nil then
				local color = theme[binding.token]
				if typeof(color) == "Color3" then
					if binding.kind == "property" then
						pcall(function()
							(object :: any)[binding.name] = color
						end)
					elseif binding.kind == "stroke" and object:IsA("UIStroke") then
						object.Color = color
					elseif binding.kind == "attribute" then
						object:SetAttribute(binding.name, color)
					end
				end
				bindings[writeIndex] = binding
				writeIndex += 1
			end
		end
		for index = #bindings, writeIndex, -1 do
			bindings[index] = nil
		end
	end)
end

function ThemeService:Initialize()
	local theme = self._theme
	if not theme then
		return
	end
	local preset = self._settings:Get("Appearance.Theme")
	local applied = theme.ApplyPreset(if typeof(preset) == "string" then preset else "Obsidian")
	if applied ~= preset then
		self._settings:Set("Appearance.Theme", applied)
	end
	theme.ReduceMotion = self._settings:Get("Appearance.ReduceMotion") == true
	theme.AnimationsEnabled = self._settings:Get("Appearance.Animations") ~= false
end

function ThemeService:GetActivePreset(): string
	local theme = self._theme
	return if theme then theme.GetActivePreset() else "Obsidian"
end

function ThemeService:GetPresetNames(): {string}
	local theme = self._theme
	local output = {}
	if theme then
		for _, name in theme.PresetNames do
			table.insert(output, name)
		end
	end
	return output
end

function ThemeService:SetPreset(name: string, root: Instance?): string
	local theme = self._theme
	if not theme then
		return "Obsidian"
	end

	self:_stopRainbow()
	if root then
		self._root = root
	end

	local before = theme.GetColorSnapshot()
	local applied = theme.ApplyPreset(name)
	local after = theme.GetColorSnapshot()
	local targetRoot = root or self._root

	if targetRoot then
		local replacements = buildReplacementMap(before, after)
		remapObject(targetRoot, replacements)
		for _, descendant in targetRoot:GetDescendants() do
			remapObject(descendant, replacements)
		end
	end

	self._settings:Set("Appearance.Theme", applied)
	if targetRoot and theme.IsAnimatedPreset(applied) then
		self:_startRainbow(targetRoot)
	end

	local changed = self._changed
	if changed then
		changed:Fire(applied)
	end
	return applied
end

function ThemeService:SetReduceMotion(enabled: boolean)
	local theme = self._theme
	if theme then
		theme.ReduceMotion = enabled
	end
	self._settings:Set("Appearance.ReduceMotion", enabled)
	local changed = self._changed
	if changed then
		changed:Fire(self:GetActivePreset())
	end
end

function ThemeService:SetAnimationsEnabled(enabled: boolean)
	local theme = self._theme
	if theme then
		theme.AnimationsEnabled = enabled
	end
	self._settings:Set("Appearance.Animations", enabled)
	local changed = self._changed
	if changed then
		changed:Fire(self:GetActivePreset())
	end
end

function ThemeService:GetChangedSignal(): RBXScriptSignal
	return (self._changed :: BindableEvent).Event
end

function ThemeService:Destroy()
	self:_stopRainbow()
	if self._changed then
		self._changed:Destroy()
		self._changed = nil
	end
	self._settings = nil
	self._theme = nil
	self._root = nil
end

return ThemeService
