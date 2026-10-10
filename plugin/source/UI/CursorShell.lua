--!strict

local UserInputService = game:GetService("UserInputService")

local Root = script.Parent.Parent
local Theme = require(Root.UI.Theme)
local Primitives = require(Root.UI.Primitives)

local CursorShell = {}
CursorShell.__index = CursorShell

export type CursorShell = typeof(setmetatable({
	_screenGui = nil :: ScreenGui?,
	_window = nil :: Frame?,
	_settings = nil :: any,
	_themeService = nil :: any,
	_commands = nil :: any,
	_shortcuts = nil :: any,
	_notifications = nil :: any,
	_settingsButton = nil :: TextButton?,
	_settingsPopover = nil :: CanvasGroup?,
	_themeValue = nil :: TextLabel?,
	_toggleButtons = {} :: {[string]: TextButton},
	_connections = {} :: {RBXScriptConnection},
	_shortcutCleanup = {} :: {() -> ()},
}, CursorShell))

local function make(className: string, properties: {[string]: any}, parent: Instance?): any
	local object = Instance.new(className)
	for key, value in properties do
		(object :: any)[key] = value
	end
	if parent then
		object.Parent = parent
	end
	return object
end

local function bind(self: CursorShell, connection: RBXScriptConnection)
	table.insert(self._connections, connection)
end

local function addPadding(parent: Instance, left: number, right: number, top: number, bottom: number)
	make("UIPadding", {
		PaddingLeft = UDim.new(0, left),
		PaddingRight = UDim.new(0, right),
		PaddingTop = UDim.new(0, top),
		PaddingBottom = UDim.new(0, bottom),
	}, parent)
end

local function setGuiZIndex(root: Instance, zIndex: number)
	if root:IsA("GuiObject") then
		root.ZIndex = zIndex
	end
	for _, descendant in root:GetDescendants() do
		if descendant:IsA("GuiObject") then
			descendant.ZIndex = zIndex
		end
	end
end

function CursorShell.new(
	screenGui: ScreenGui,
	window: Frame,
	settingsService: any,
	themeService: any,
	commandService: any,
	shortcutService: any,
	notificationService: any
): CursorShell
	local self = setmetatable({
		_screenGui = screenGui,
		_window = window,
		_settings = settingsService,
		_themeService = themeService,
		_commands = commandService,
		_shortcuts = shortcutService,
		_notifications = notificationService,
		_settingsButton = nil,
		_settingsPopover = nil,
		_themeValue = nil,
		_toggleButtons = {},
		_connections = {},
		_shortcutCleanup = {},
	}, CursorShell)

	self:_buildSettingsPopover()
	self:_syncShortcuts()

	bind(self, commandService:GetChangedSignal():Connect(function()
		self:_syncShortcuts()
	end))
	bind(self, settingsService:GetChangedSignal():Connect(function()
		self:_refreshSettingsVisuals()
	end))
	bind(self, UserInputService.InputBegan:Connect(function(input)
		if input.UserInputType ~= Enum.UserInputType.MouseButton1 then
			return
		end
		local popover = self._settingsPopover
		local button = self._settingsButton
		if not popover or not popover.Visible or not button then
			return
		end
		local point = UserInputService:GetMouseLocation()
		local popoverMin = popover.AbsolutePosition
		local popoverMax = popoverMin + popover.AbsoluteSize
		local buttonMin = button.AbsolutePosition
		local buttonMax = buttonMin + button.AbsoluteSize
		local insidePopover = point.X >= popoverMin.X and point.X <= popoverMax.X and point.Y >= popoverMin.Y and point.Y <= popoverMax.Y
		local insideButton = point.X >= buttonMin.X and point.X <= buttonMax.X and point.Y >= buttonMin.Y and point.Y <= buttonMax.Y
		if not insidePopover and not insideButton then
			self:SetSettingsVisible(false)
		end
	end))

	self:_refreshSettingsVisuals()
	return self
end

function CursorShell:_buildSettingsPopover()
	local window = self._window
	local screenGui = self._screenGui
	if not window or not screenGui then
		return
	end

	local titleBar = window:FindFirstChild("TitleBar", true)
	if not titleBar or not titleBar:IsA("GuiObject") then
		return
	end

	local button = Primitives.Button(titleBar, "", 26, "Ghost")
	button.Name = "SettingsButton"
	button.AnchorPoint = Vector2.new(1, 0.5)
	button.Position = UDim2.new(1, -62, 0.5, 0)
	button.Size = UDim2.fromOffset(26, 24)
	button.BackgroundTransparency = 1
	button.ZIndex = 75
	Primitives.SetButtonTransparency(button, 1, 0)
	local icon = Primitives.Icon(button, "Settings", 13)
	icon.AnchorPoint = Vector2.new(0.5, 0.5)
	icon.Position = UDim2.fromScale(0.5, 0.5)
	setGuiZIndex(icon, 76)
	Primitives.AttachTooltip(button, screenGui, "Settings", function()
		return Theme.ReduceMotion == true
	end)
	self._settingsButton = button

	local popover = make("CanvasGroup", {
		Name = "SettingsPopover",
		AnchorPoint = Vector2.new(1, 0),
		BackgroundColor3 = Theme.SurfaceRaised,
		BorderSizePixel = 0,
		GroupTransparency = 1,
		Interactable = false,
		Visible = false,
		Position = UDim2.new(1, -8, 0, 30),
		Size = UDim2.fromOffset(232, 238),
		ZIndex = 620,
	}, window)
	Primitives.Corner(popover, Theme.RadiusMedium)
	Primitives.Stroke(popover, Theme.BorderStrong)
	self._settingsPopover = popover

	local heading = Primitives.Label(popover, "Settings", 10, Theme.Text, true)
	heading.Position = UDim2.fromOffset(12, 8)
	heading.Size = UDim2.new(1, -24, 0, 18)
	heading.ZIndex = 621

	local productName = tostring(self._settings:Get("Product.Name") or "Cursor V2")
	local subtitleText = if string.find(productName, "DataStore", 1, true) then "DataStore preferences"
		elseif string.find(productName, "Animator", 1, true) then "Animator preferences"
		else "Easy preferences"
	local subtitle = Primitives.Label(popover, subtitleText, 7, Theme.TextFaint, false)
	subtitle.Position = UDim2.fromOffset(12, 24)
	subtitle.Size = UDim2.new(1, -24, 0, 14)
	subtitle.ZIndex = 621

	local divider = Primitives.Divider(popover, false)
	divider.Position = UDim2.fromOffset(0, 44)
	divider.ZIndex = 621

	local themeRow = make("Frame", {
		BackgroundTransparency = 1,
		Position = UDim2.fromOffset(10, 52),
		Size = UDim2.new(1, -20, 0, 32),
		ZIndex = 621,
	}, popover)
	local themeLabel = Primitives.Label(themeRow, "Theme", 8, Theme.TextMuted, false)
	themeLabel.Size = UDim2.new(0, 76, 1, 0)
	themeLabel.ZIndex = 622
	local previousTheme = Primitives.Button(themeRow, "‹", 24, "Ghost")
	previousTheme.AnchorPoint = Vector2.new(1, 0.5)
	previousTheme.Position = UDim2.new(1, -118, 0.5, 0)
	previousTheme.Size = UDim2.fromOffset(24, 24)
	previousTheme.TextSize = 14
	previousTheme.ZIndex = 622
	local themeValue = Primitives.Label(themeRow, "Obsidian", 8, Theme.Text, true)
	themeValue.AnchorPoint = Vector2.new(1, 0.5)
	themeValue.Position = UDim2.new(1, -28, 0.5, 0)
	themeValue.Size = UDim2.fromOffset(86, 24)
	themeValue.TextXAlignment = Enum.TextXAlignment.Center
	themeValue.ZIndex = 622
	local nextTheme = Primitives.Button(themeRow, "›", 24, "Ghost")
	nextTheme.AnchorPoint = Vector2.new(1, 0.5)
	nextTheme.Position = UDim2.new(1, 0, 0.5, 0)
	nextTheme.Size = UDim2.fromOffset(24, 24)
	nextTheme.TextSize = 14
	nextTheme.ZIndex = 622
	self._themeValue = themeValue

	local rowY = 88
	local function makeToggleRow(path: string, labelText: string)
		local row = make("Frame", {
			BackgroundTransparency = 1,
			Position = UDim2.fromOffset(10, rowY),
			Size = UDim2.new(1, -20, 0, 30),
			ZIndex = 621,
		}, popover)
		rowY += 31
		local label = Primitives.Label(row, labelText, 8, Theme.TextMuted, false)
		label.Size = UDim2.new(1, -64, 1, 0)
		label.ZIndex = 622
		local toggle = Primitives.Button(row, "Off", 52, "Secondary")
		toggle.AnchorPoint = Vector2.new(1, 0.5)
		toggle.Position = UDim2.new(1, 0, 0.5, 0)
		toggle.Size = UDim2.fromOffset(52, 24)
		toggle.ZIndex = 622
		self._toggleButtons[path] = toggle
		bind(self, toggle.MouseButton1Click:Connect(function()
			local current = self._settings:Get(path) == true
			self._settings:Set(path, not current)
			if path == "Appearance.ReduceMotion" then
				Theme.ReduceMotion = not current
			elseif path == "Appearance.Animations" then
				Theme.AnimationsEnabled = not current
			end
			self:_refreshSettingsVisuals()
		end))
	end

	makeToggleRow("Appearance.ReduceMotion", "Reduce motion")
	makeToggleRow("Appearance.Animations", "UI animations")
	makeToggleRow("Behavior.ShowTooltips", "Tooltips")
	if string.find(productName, "DataStore", 1, true) then
		makeToggleRow("Behavior.ConfirmDestructiveActions", "Confirm deletes")
	else
		makeToggleRow("Behavior.RestoreSession", "Restore session")
	end

	local reset = Primitives.Button(popover, "Reset preferences", 118, "Ghost")
	reset.AnchorPoint = Vector2.new(0, 1)
	reset.Position = UDim2.new(0, 10, 1, -8)
	reset.Size = UDim2.fromOffset(118, 24)
	reset.TextXAlignment = Enum.TextXAlignment.Left
	reset.ZIndex = 622
	addPadding(reset, 5, 5, 0, 0)
	bind(self, reset.MouseButton1Click:Connect(function()
		self._settings:Reset("Appearance")
		self._settings:Reset("Behavior")
		self._themeService:SetPreset("Obsidian", screenGui)
		Theme.ReduceMotion = self._settings:Get("Appearance.ReduceMotion") == true
		Theme.AnimationsEnabled = self._settings:Get("Appearance.Animations") ~= false
		self:_refreshSettingsVisuals()
		if self._notifications then
			self._notifications:Show("Preferences reset")
		end
	end))

	local function cycleTheme(direction: number)
		local names = self._themeService:GetPresetNames()
		if #names == 0 then
			return
		end
		local current = self._themeService:GetActivePreset()
		local index = table.find(names, current) or 1
		local nextIndex = ((index - 1 + direction) % #names) + 1
		self._themeService:SetPreset(names[nextIndex], screenGui)
		self:_refreshSettingsVisuals()
	end
	bind(self, previousTheme.MouseButton1Click:Connect(function() cycleTheme(-1) end))
	bind(self, nextTheme.MouseButton1Click:Connect(function() cycleTheme(1) end))
	bind(self, button.MouseButton1Click:Connect(function()
		self:SetSettingsVisible(not popover.Visible)
	end))
end

function CursorShell:_refreshSettingsVisuals()
	local themeValue = self._themeValue
	if themeValue then
		themeValue.Text = self._themeService:GetActivePreset()
	end
	for path, button in self._toggleButtons do
		local enabled = self._settings:Get(path) == true
		button.Text = if enabled then "On" else "Off"
		Primitives.SetButtonVisual(
			button,
			if enabled then Theme.AccentSoft else Theme.Background,
			if enabled then Theme.Text else Theme.TextMuted,
			Theme.SurfaceHover,
			Theme.Text
		)
	end
end

function CursorShell:_syncShortcuts()
	for _, cleanup in self._shortcutCleanup do
		cleanup()
	end
	table.clear(self._shortcutCleanup)

	local settingsCleanup = self._shortcuts:Register({
		id = "cursor.settings",
		chord = "Ctrl+,",
		callback = function()
			self:SetSettingsVisible(not (self._settingsPopover and self._settingsPopover.Visible or false))
		end,
	})
	table.insert(self._shortcutCleanup, settingsCleanup)

	for _, command in self._commands:GetAll() do
		local chord = command.shortcut
		if chord and chord ~= "" then
			local commandId = command.id
			local cleanup = self._shortcuts:Register({
				id = "command." .. commandId,
				chord = chord,
				callback = function()
					local ok, err = self._commands:Execute(commandId)
					if not ok and self._notifications then
						self._notifications:Show(err or "Action failed", "danger")
					end
				end,
				isEnabled = command.isEnabled,
			})
			table.insert(self._shortcutCleanup, cleanup)
		end
	end
end

function CursorShell:SetSettingsVisible(visible: boolean)
	local popover = self._settingsPopover
	if not popover then
		return
	end
	if visible then
		self:_refreshSettingsVisuals()
	end
	Primitives.SetCanvasGroupVisible(popover, visible, false)
end

function CursorShell:ToggleSettings()
	self:SetSettingsVisible(not (self._settingsPopover and self._settingsPopover.Visible or false))
end

function CursorShell:Destroy()
	for _, connection in self._connections do
		connection:Disconnect()
	end
	table.clear(self._connections)
	for _, cleanup in self._shortcutCleanup do
		cleanup()
	end
	table.clear(self._shortcutCleanup)
	local popover = self._settingsPopover
	self._settingsPopover = nil
	if popover then
		popover:Destroy()
	end
	local button = self._settingsButton
	self._settingsButton = nil
	if button then
		button:Destroy()
	end
end

return CursorShell
