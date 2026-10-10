--!strict

local Logger = {}
Logger.__index = Logger

export type Logger = typeof(setmetatable({
	_prefix = "Cursor",
	_debugEnabled = false,
}, Logger))

function Logger.new(prefix: string, debugEnabled: boolean?): Logger
	return setmetatable({
		_prefix = prefix,
		_debugEnabled = debugEnabled == true,
	}, Logger)
end

function Logger:SetDebugEnabled(enabled: boolean)
	self._debugEnabled = enabled
end

function Logger:Debug(message: string, ...: any)
	if not self._debugEnabled then
		return
	end
	print(string.format("[%s] %s", self._prefix, string.format(message, ...)))
end

function Logger:Info(message: string, ...: any)
	print(string.format("[%s] %s", self._prefix, string.format(message, ...)))
end

function Logger:Warn(message: string, ...: any)
	warn(string.format("[%s] %s", self._prefix, string.format(message, ...)))
end

return Logger
