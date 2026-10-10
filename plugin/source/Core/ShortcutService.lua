--!strict

local UserInputService = game:GetService("UserInputService")

export type Shortcut = {
	id: string,
	chord: string,
	callback: () -> (),
	isEnabled: (() -> boolean)?,
	allowWhenTyping: boolean?,
}

local ShortcutService = {}
ShortcutService.__index = ShortcutService

export type ShortcutService = typeof(setmetatable({
	_shortcuts = {} :: {[string]: Shortcut},
	_connection = nil :: RBXScriptConnection?,
}, ShortcutService))

local function normalizeChord(chord: string): string
	local normalized = string.upper(chord:gsub("%s+", ""))
	normalized = normalized:gsub("CONTROL", "CTRL")
	return normalized
end

local function keyToken(keyCode: Enum.KeyCode): string
	if keyCode == Enum.KeyCode.Comma then
		return ","
	elseif keyCode == Enum.KeyCode.Period then
		return "."
	elseif keyCode == Enum.KeyCode.Slash then
		return "/"
	elseif keyCode == Enum.KeyCode.Semicolon then
		return ";"
	end
	return string.upper(keyCode.Name)
end

local function currentChord(input: InputObject): string
	local parts = {}
	if UserInputService:IsKeyDown(Enum.KeyCode.LeftControl) or UserInputService:IsKeyDown(Enum.KeyCode.RightControl) then
		table.insert(parts, "CTRL")
	end
	if UserInputService:IsKeyDown(Enum.KeyCode.LeftShift) or UserInputService:IsKeyDown(Enum.KeyCode.RightShift) then
		table.insert(parts, "SHIFT")
	end
	if UserInputService:IsKeyDown(Enum.KeyCode.LeftAlt) or UserInputService:IsKeyDown(Enum.KeyCode.RightAlt) then
		table.insert(parts, "ALT")
	end
	table.insert(parts, keyToken(input.KeyCode))
	return table.concat(parts, "+")
end

function ShortcutService.new(): ShortcutService
	local self = setmetatable({
		_shortcuts = {},
		_connection = nil,
	}, ShortcutService)

	self._connection = UserInputService.InputBegan:Connect(function(input, gameProcessed)
		if input.UserInputType ~= Enum.UserInputType.Keyboard then
			return
		end
		local chord = currentChord(input)
		for _, shortcut in self._shortcuts do
			if normalizeChord(shortcut.chord) ~= chord then
				continue
			end
			if shortcut.isEnabled and not shortcut.isEnabled() then
				continue
			end
			if not shortcut.allowWhenTyping and UserInputService:GetFocusedTextBox() ~= nil then
				continue
			end
			if gameProcessed and not shortcut.allowWhenTyping then
				continue
			end
			shortcut.callback()
			break
		end
	end)

	return self
end

function ShortcutService:Register(shortcut: Shortcut): () -> ()
	self._shortcuts[shortcut.id] = shortcut
	local alive = true
	return function()
		if not alive then
			return
		end
		alive = false
		if self._shortcuts[shortcut.id] == shortcut then
			self._shortcuts[shortcut.id] = nil
		end
	end
end

function ShortcutService:Destroy()
	if self._connection then
		self._connection:Disconnect()
		self._connection = nil
	end
	table.clear(self._shortcuts)
end

return ShortcutService
