--!strict

export type Command = {
	id: string,
	title: string,
	description: string?,
	keywords: {string}?,
	shortcut: string?,
	action: () -> (),
	isEnabled: (() -> boolean)?,
}

local CommandService = {}
CommandService.__index = CommandService

export type CommandService = typeof(setmetatable({
	_commands = {} :: {[string]: Command},
	_changed = nil :: BindableEvent?,
}, CommandService))

local function normalize(text: string): string
	return string.lower((text:gsub("%s+", " "):match("^%s*(.-)%s*$") or ""))
end

local function scoreCommand(command: Command, query: string): number
	if query == "" then
		return 1
	end
	local title = normalize(command.title)
	local id = normalize(command.id)
	if title == query then
		return 1000
	end
	if string.sub(title, 1, #query) == query then
		return 800
	end
	if string.find(title, query, 1, true) then
		return 600
	end
	if string.find(id, query, 1, true) then
		return 450
	end
	if command.description and string.find(normalize(command.description), query, 1, true) then
		return 300
	end
	for _, keyword in command.keywords or {} do
		local normalizedKeyword = normalize(keyword)
		if normalizedKeyword == query then
			return 500
		end
		if string.find(normalizedKeyword, query, 1, true) then
			return 250
		end
	end
	return 0
end

function CommandService.new(): CommandService
	return setmetatable({
		_commands = {},
		_changed = Instance.new("BindableEvent"),
	}, CommandService)
end

function CommandService:Register(command: Command): () -> ()
	assert(command.id ~= "", "Command id is required")
	assert(command.title ~= "", "Command title is required")
	self._commands[command.id] = command
	local changedEvent = self._changed
	if changedEvent then
		changedEvent:Fire()
	end

	local alive = true
	return function()
		if not alive then
			return
		end
		alive = false
		if self._commands[command.id] == command then
			self._commands[command.id] = nil
			if self._changed then
				self._changed:Fire()
			end
		end
	end
end

function CommandService:Get(id: string): Command?
	return self._commands[id]
end

function CommandService:GetAll(): {Command}
	local output = {}
	for _, command in self._commands do
		table.insert(output, command)
	end
	table.sort(output, function(a, b)
		return a.title < b.title
	end)
	return output
end

function CommandService:Search(query: string, limit: number?): {Command}
	local cleanQuery = normalize(query)
	local ranked = {}
	for _, command in self._commands do
		if command.isEnabled == nil or command.isEnabled() then
			local score = scoreCommand(command, cleanQuery)
			if score > 0 then
				table.insert(ranked, {command = command, score = score})
			end
		end
	end
	table.sort(ranked, function(a, b)
		if a.score == b.score then
			return a.command.title < b.command.title
		end
		return a.score > b.score
	end)

	local output = {}
	local maxResults = math.max(1, limit or 12)
	for index = 1, math.min(maxResults, #ranked) do
		table.insert(output, ranked[index].command)
	end
	return output
end

function CommandService:Execute(id: string): (boolean, string?)
	local command = self._commands[id]
	if not command then
		return false, "Unknown command"
	end
	if command.isEnabled and not command.isEnabled() then
		return false, "Command is unavailable"
	end
	local ok, err = xpcall(command.action, debug.traceback)
	if not ok then
		return false, tostring(err)
	end
	return true, nil
end

function CommandService:GetChangedSignal(): RBXScriptSignal
	return (self._changed :: BindableEvent).Event
end

function CommandService:Destroy()
	table.clear(self._commands)
	if self._changed then
		self._changed:Destroy()
		self._changed = nil
	end
end

return CommandService
