--!strict

local SettingsService = {}
SettingsService.__index = SettingsService

export type SettingsService = typeof(setmetatable({
	_plugin = nil :: Plugin?,
	_storageKey = "",
	_defaults = {} :: {[string]: any},
	_data = {} :: {[string]: any},
	_changed = nil :: BindableEvent?,
}, SettingsService))

local function deepCopy(value: any): any
	if typeof(value) ~= "table" then
		return value
	end
	local output = {}
	for key, child in value do
		output[deepCopy(key)] = deepCopy(child)
	end
	return output
end

local function mergeDefaults(target: {[string]: any}, defaults: {[string]: any})
	for key, defaultValue in defaults do
		local current = target[key]
		if typeof(defaultValue) == "table" then
			if typeof(current) ~= "table" then
				current = {}
				target[key] = current
			end
			mergeDefaults(current, defaultValue)
		elseif current == nil or typeof(current) ~= typeof(defaultValue) then
			target[key] = defaultValue
		end
	end
end

local function splitPath(path: string): {string}
	local output = {}
	for segment in string.gmatch(path, "[^%.]+") do
		table.insert(output, segment)
	end
	return output
end

local function readPath(root: {[string]: any}, path: string): any
	local cursor: any = root
	for _, segment in splitPath(path) do
		if typeof(cursor) ~= "table" then
			return nil
		end
		cursor = cursor[segment]
	end
	return cursor
end

local function writePath(root: {[string]: any}, path: string, value: any)
	local segments = splitPath(path)
	if #segments == 0 then
		return
	end
	local cursor: {[string]: any} = root
	for index = 1, #segments - 1 do
		local segment = segments[index]
		local nextValue = cursor[segment]
		if typeof(nextValue) ~= "table" then
			nextValue = {}
			cursor[segment] = nextValue
		end
		cursor = nextValue
	end
	cursor[segments[#segments]] = value
end

local function validateAgainstDefault(defaults: {[string]: any}, path: string, value: any): boolean
	local defaultValue = readPath(defaults, path)
	if defaultValue == nil then
		-- Session/runtime extension points are intentionally allowed.
		return string.sub(path, 1, 8) == "Session."
	end
	return typeof(defaultValue) == typeof(value)
end

function SettingsService.new(pluginObject: Plugin, pluginId: string, defaults: {[string]: any}): SettingsService
	local storageKey = string.format("CursorV2.%s.Settings", pluginId)
	local saved: any = nil
	local ok = pcall(function()
		saved = pluginObject:GetSetting(storageKey)
	end)

	local data = if ok and typeof(saved) == "table" then deepCopy(saved) else {}
	mergeDefaults(data, defaults)

	return setmetatable({
		_plugin = pluginObject,
		_storageKey = storageKey,
		_defaults = deepCopy(defaults),
		_data = data,
		_changed = Instance.new("BindableEvent"),
	}, SettingsService)
end

function SettingsService:_persist()
	local pluginObject = self._plugin
	if not pluginObject then
		return
	end
	local ok, err = pcall(function()
		pluginObject:SetSetting(self._storageKey, deepCopy(self._data))
	end)
	if not ok then
		warn(string.format("[Cursor Settings] Failed to persist settings: %s", tostring(err)))
	end
end

function SettingsService:Get(path: string): any
	return deepCopy(readPath(self._data, path))
end

function SettingsService:GetAll(): {[string]: any}
	return deepCopy(self._data)
end

function SettingsService:Set(path: string, value: any): boolean
	if not validateAgainstDefault(self._defaults, path, value) then
		return false
	end
	local previous = readPath(self._data, path)
	if previous == value then
		return true
	end
	writePath(self._data, path, deepCopy(value))
	self:_persist()
	local changed = self._changed
	if changed then
		changed:Fire(path, deepCopy(value), deepCopy(previous))
	end
	return true
end

function SettingsService:Reset(path: string?)
	if path == nil or path == "" then
		self._data = deepCopy(self._defaults)
		self:_persist()
		local changed = self._changed
		if changed then
			changed:Fire("*", self:GetAll(), nil)
		end
		return
	end
	local defaultValue = readPath(self._defaults, path)
	if defaultValue == nil then
		return
	end
	self:Set(path, defaultValue)
end

function SettingsService:GetChangedSignal(): RBXScriptSignal
	return (self._changed :: BindableEvent).Event
end

function SettingsService:Destroy()
	if self._changed then
		self._changed:Destroy()
		self._changed = nil
	end
	self._plugin = nil
end

return SettingsService
