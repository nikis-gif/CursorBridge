--!strict

local CoreGui = game:GetService("CoreGui")
local UserInputService = game:GetService("UserInputService")

local Root = script.Parent.Parent
local Theme = require(Root.UI.Theme)
local Primitives = require(Root.UI.Primitives)

local PLUGIN_ICON = "rbxassetid://132318313203288"
local GUI_NAME = "CursorBridgeV2UI"
local DEFAULT_SIZE = Vector2.new(548, 356)
local MIN_SIZE = Vector2.new(470, 312)
local MAX_SIZE = Vector2.new(760, 510)
local TITLE_HEIGHT = 30
local FOOTER_HEIGHT = 28
local SIDEBAR_WIDTH = 208

local BridgeWindow = {}
BridgeWindow.__index = BridgeWindow

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

local function bind(self: any, connection: RBXScriptConnection)
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

local function divider(parent: Instance, y: number)
	make("Frame", {
		BackgroundColor3 = Theme.BorderSoft,
		BorderSizePixel = 0,
		Position = UDim2.new(0, 10, 0, y),
		Size = UDim2.new(1, -20, 0, 1),
	}, parent)
end

local function note(parent: Instance, value: string, y: number, color: Color3?): TextLabel
	local label = Primitives.Label(parent, value, 9, color or Theme.TextMuted, false)
	label.Position = UDim2.new(0, 12, 0, y)
	label.Size = UDim2.new(1, -24, 0, 34)
	label.TextWrapped = true
	label.TextYAlignment = Enum.TextYAlignment.Top
	return label
end

function BridgeWindow.new(_pluginObject: Plugin)
	local previous = CoreGui:FindFirstChild(GUI_NAME)
	if previous then
		previous:Destroy()
	end

	local screenGui = make("ScreenGui", {
		Name = GUI_NAME,
		IgnoreGuiInset = true,
		ResetOnSpawn = false,
		DisplayOrder = 425,
		ZIndexBehavior = Enum.ZIndexBehavior.Sibling,
		Enabled = false,
	}, CoreGui)

	local window = make("Frame", {
		Name = "Window",
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		Position = UDim2.fromOffset(78, 82),
		Size = UDim2.fromOffset(DEFAULT_SIZE.X, DEFAULT_SIZE.Y),
		ClipsDescendants = false,
	}, screenGui)

	local chrome = make("Frame", {
		Name = "WindowChrome",
		BackgroundColor3 = Theme.Surface,
		BorderSizePixel = 0,
		ClipsDescendants = true,
		Size = UDim2.fromScale(1, 1),
	}, window)
	Primitives.Corner(chrome, Theme.RadiusLarge)
	Primitives.Stroke(chrome, Theme.Border)

	local titleBar = make("Frame", {
		Name = "TitleBar",
		Active = true,
		BackgroundColor3 = Theme.SurfaceRaised,
		BorderSizePixel = 0,
		Size = UDim2.new(1, 0, 0, TITLE_HEIGHT),
	}, chrome)
	Primitives.Corner(titleBar, Theme.RadiusLarge)
	make("Frame", {
		BackgroundColor3 = Theme.SurfaceRaised,
		BorderSizePixel = 0,
		Position = UDim2.new(0, 0, 1, -10),
		Size = UDim2.new(1, 0, 0, 10),
	}, titleBar)
	local titleDivider = Primitives.Divider(titleBar, false)
	titleDivider.Position = UDim2.new(0, 0, 1, -1)

	make("ImageLabel", {
		Name = "CursorIcon",
		BackgroundTransparency = 1,
		Image = PLUGIN_ICON,
		Position = UDim2.fromOffset(9, 7),
		Size = UDim2.fromOffset(16, 16),
	}, titleBar)
	local title = Primitives.Label(titleBar, "Cursor Bridge V2", 10, Theme.Text, true)
	title.Position = UDim2.fromOffset(32, 0)
	title.Size = UDim2.new(1, -162, 1, 0)
	title.TextTruncate = Enum.TextTruncate.AtEnd

	local minimize = Primitives.Button(titleBar, "", 26, "Ghost")
	minimize.Name = "MinimizeButton"
	minimize.Position = UDim2.new(1, -91, 0, 3)
	minimize.Size = UDim2.fromOffset(26, 24)
	minimize.BackgroundTransparency = 1
	local minimizeIcon = Primitives.Icon(minimize, "Minimize", 12)
	minimizeIcon.AnchorPoint = Vector2.new(0.5, 0.5)
	minimizeIcon.Position = UDim2.fromScale(0.5, 0.5)

	local close = Primitives.Button(titleBar, "", 26, "Ghost")
	close.Name = "CloseButton"
	close.Position = UDim2.new(1, -28, 0, 3)
	close.Size = UDim2.fromOffset(26, 24)
	close.BackgroundTransparency = 1
	local closeIcon = Primitives.Icon(close, "Close", 12)
	closeIcon.AnchorPoint = Vector2.new(0.5, 0.5)
	closeIcon.Position = UDim2.fromScale(0.5, 0.5)

	local body = make("Frame", {
		Name = "Body",
		BackgroundColor3 = Theme.Surface,
		BorderSizePixel = 0,
		Position = UDim2.fromOffset(0, TITLE_HEIGHT),
		Size = UDim2.new(1, 0, 1, -TITLE_HEIGHT),
		ClipsDescendants = true,
	}, chrome)

	local heading = Primitives.Label(body, "STUDIO CONNECTION", 9, Theme.TextMuted, true)
	heading.Position = UDim2.fromOffset(13, 8)
	heading.Size = UDim2.new(1, -160, 0, 20)
	local subtitle = Primitives.Label(body, "Secure local synchronization", 8, Theme.TextFaint, false)
	subtitle.Position = UDim2.fromOffset(13, 26)
	subtitle.Size = UDim2.new(1, -160, 0, 16)

	local marker = Primitives.Badge(body, "LOCAL ONLY", "neutral")
	marker.AnchorPoint = Vector2.new(1, 0)
	marker.Position = UDim2.new(1, -13, 0, 14)
	marker.Size = UDim2.fromOffset(86, 22)

	local sidebar = make("Frame", {
		Name = "ConnectionPanel",
		BackgroundColor3 = Theme.SurfaceRaised,
		BorderSizePixel = 0,
		Position = UDim2.fromOffset(12, 54),
		Size = UDim2.new(0, SIDEBAR_WIDTH, 1, -(54 + FOOTER_HEIGHT + 12)),
		ClipsDescendants = true,
	}, body)
	Primitives.Corner(sidebar, Theme.RadiusMedium)
	Primitives.Stroke(sidebar, Theme.BorderSoft)

	local pairingTitle = Primitives.Label(sidebar, "PAIR WITH DESKTOP", 9, Theme.Text, true)
	pairingTitle.Position = UDim2.fromOffset(12, 11)
	pairingTitle.Size = UDim2.new(1, -24, 0, 22)
	note(sidebar, "Enter the code from Cursor Bridge for Windows.", 38)

	local codeBox = Primitives.Input(sidebar, "000000", SIDEBAR_WIDTH - 24)
	codeBox.Name = "PairingCode"
	codeBox.Position = UDim2.fromOffset(12, 83)
	codeBox.Size = UDim2.new(1, -24, 0, 32)
	codeBox.Font = Enum.Font.Code
	codeBox.TextSize = 16
	codeBox.TextXAlignment = Enum.TextXAlignment.Center
	codeBox.Text = ""

	local connect = Primitives.Button(sidebar, "Connect", SIDEBAR_WIDTH - 24, "Primary")
	connect.Name = "ConnectButton"
	connect.Position = UDim2.fromOffset(12, 125)
	connect.Size = UDim2.new(1, -24, 0, 30)

	local disconnect = Primitives.Button(sidebar, "Disconnect", SIDEBAR_WIDTH - 24, "Danger")
	disconnect.Name = "DisconnectButton"
	disconnect.Position = connect.Position
	disconnect.Size = connect.Size
	disconnect.Visible = false

	divider(sidebar, 168)
	local hostTitle = Primitives.Label(sidebar, "ENDPOINT", 8, Theme.TextFaint, true)
	hostTitle.Position = UDim2.fromOffset(12, 176)
	hostTitle.Size = UDim2.new(1, -24, 0, 18)
	local hostValue = Primitives.Label(sidebar, "127.0.0.1:38471", 10, Theme.TextMuted, false)
	hostValue.Position = UDim2.fromOffset(12, 196)
	hostValue.Size = UDim2.new(1, -24, 0, 20)

	local details = make("Frame", {
		Name = "SessionPanel",
		BackgroundColor3 = Theme.SurfaceRaised,
		BorderSizePixel = 0,
		Position = UDim2.fromOffset(SIDEBAR_WIDTH + 23, 54),
		Size = UDim2.new(1, -(SIDEBAR_WIDTH + 35), 1, -(54 + FOOTER_HEIGHT + 12)),
		ClipsDescendants = true,
	}, body)
	Primitives.Corner(details, Theme.RadiusMedium)
	Primitives.Stroke(details, Theme.BorderSoft)

	local statusTitle = Primitives.Label(details, "SESSION STATUS", 9, Theme.Text, true)
	statusTitle.Position = UDim2.fromOffset(12, 11)
	statusTitle.Size = UDim2.new(1, -100, 0, 22)
	local statusBadge = Primitives.Badge(details, "IDLE", "neutral")
	statusBadge.AnchorPoint = Vector2.new(1, 0)
	statusBadge.Position = UDim2.new(1, -11, 0, 11)
	statusBadge.Size = UDim2.fromOffset(48, 20)

	local status = Primitives.Label(details, "Disconnected", 10, Theme.TextMuted, false)
	status.Name = "SessionStatus"
	status.Position = UDim2.fromOffset(12, 40)
	status.Size = UDim2.new(1, -24, 0, 40)
	status.TextWrapped = true
	status.TextYAlignment = Enum.TextYAlignment.Top

	divider(details, 88)
	local row1 = Primitives.Label(details, "EXPLORER MIRROR", 9, Theme.Text, true)
	row1.Position = UDim2.fromOffset(12, 100)
	row1.Size = UDim2.new(1, -24, 0, 19)
	note(details, "Track scripts, folders, and instance paths.", 120)
	local row2 = Primitives.Label(details, "BIDIRECTIONAL EDITS", 9, Theme.Text, true)
	row2.Position = UDim2.fromOffset(12, 157)
	row2.Size = UDim2.new(1, -24, 0, 18)
	note(details, "Keep Studio and the desktop app in sync.", 178)

	local footer = make("Frame", {
		Name = "Footer",
		BackgroundColor3 = Theme.SurfaceRaised,
		BorderSizePixel = 0,
		AnchorPoint = Vector2.new(0, 1),
		Position = UDim2.new(0, 0, 1, 0),
		Size = UDim2.new(1, 0, 0, FOOTER_HEIGHT),
	}, body)
	Primitives.Corner(footer, Theme.RadiusLarge)
	make("Frame", {
		BackgroundColor3 = Theme.SurfaceRaised,
		BorderSizePixel = 0,
		Size = UDim2.new(1, 0, 0, 8),
	}, footer)
	local footerDivider = Primitives.Divider(footer, false)
	footerDivider.Position = UDim2.new(0, 0, 0, 0)
	local footerLabel = Primitives.Label(footer, "One active Studio session  /  Live monitoring", 8, Theme.TextFaint, false)
	footerLabel.Position = UDim2.fromOffset(12, 0)
	footerLabel.Size = UDim2.new(1, -24, 1, 0)

	local resizeGrip = make("TextButton", {
		Name = "ResizeGrip",
		AnchorPoint = Vector2.new(1, 1),
		AutoButtonColor = false,
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		Position = UDim2.fromScale(1, 1),
		Size = UDim2.fromOffset(20, 20),
		Text = "",
		ZIndex = 520,
	}, window)
	for offset = 0, 2 do
		make("Frame", {
			AnchorPoint = Vector2.new(0.5, 0.5),
			BackgroundColor3 = Theme.TextFaint,
			BorderSizePixel = 0,
			Position = UDim2.new(1, -5 - offset * 4, 1, -5),
			Rotation = -45,
			Size = UDim2.fromOffset(8, 1),
			ZIndex = 521,
		}, resizeGrip)
	end

	local self = setmetatable({
		_screenGui = screenGui,
		_window = window,
		_body = body,
		_resizeGrip = resizeGrip,
		_minimized = false,
		_restoreSize = window.Size,
		_connected = false,
		_busy = false,
		_status = status,
		_statusBadge = statusBadge,
		_visibleChanged = Instance.new("BindableEvent"),
		_closeRequested = Instance.new("BindableEvent"),
		_connections = {} :: {RBXScriptConnection},
		CodeBox = codeBox,
		ConnectButton = connect,
		DisconnectButton = disconnect,
	}, BridgeWindow)

	bind(self, close.MouseButton1Click:Connect(function()
		self._closeRequested:Fire()
	end))
	bind(self, minimize.MouseButton1Click:Connect(function()
		self:_toggleMinimized()
	end))

	local dragging = false
	local dragOrigin = Vector2.zero
	local windowOrigin = Vector2.zero
	bind(self, titleBar.InputBegan:Connect(function(input)
		if input.UserInputType == Enum.UserInputType.MouseButton1 then
			dragging = true
			dragOrigin = UserInputService:GetMouseLocation()
			windowOrigin = Vector2.new(window.Position.X.Offset, window.Position.Y.Offset)
		end
	end))
	bind(self, UserInputService.InputChanged:Connect(function(input)
		if dragging and input.UserInputType == Enum.UserInputType.MouseMovement then
			local delta = UserInputService:GetMouseLocation() - dragOrigin
			window.Position = UDim2.fromOffset(windowOrigin.X + delta.X, windowOrigin.Y + delta.Y)
		end
	end))
	bind(self, UserInputService.InputEnded:Connect(function(input)
		if input.UserInputType == Enum.UserInputType.MouseButton1 then
			dragging = false
		end
	end))

	local resizing = false
	local resizeOrigin = Vector2.zero
	local sizeOrigin = Vector2.zero
	bind(self, resizeGrip.MouseButton1Down:Connect(function()
		resizing = true
		resizeOrigin = UserInputService:GetMouseLocation()
		sizeOrigin = window.AbsoluteSize
	end))
	bind(self, UserInputService.InputChanged:Connect(function(input)
		if resizing and input.UserInputType == Enum.UserInputType.MouseMovement and not self._minimized then
			local delta = UserInputService:GetMouseLocation() - resizeOrigin
			window.Size = UDim2.fromOffset(
				math.clamp(sizeOrigin.X + delta.X, MIN_SIZE.X, MAX_SIZE.X),
				math.clamp(sizeOrigin.Y + delta.Y, MIN_SIZE.Y, MAX_SIZE.Y)
			)
			self._restoreSize = window.Size
		end
	end))
	bind(self, UserInputService.InputEnded:Connect(function(input)
		if input.UserInputType == Enum.UserInputType.MouseButton1 then
			resizing = false
		end
	end))

	return self
end

function BridgeWindow:_toggleMinimized()
	local window = self._window
	if not window then
		return
	end
	self._minimized = not self._minimized
	if self._minimized then
		self._restoreSize = window.Size
		window.Size = UDim2.fromOffset(math.max(MIN_SIZE.X, window.AbsoluteSize.X), TITLE_HEIGHT)
	else
		window.Size = self._restoreSize
	end
	self._body.Visible = not self._minimized
	self._resizeGrip.Visible = not self._minimized
end

function BridgeWindow:SetBusy(busy: boolean)
	self._busy = busy
	self.ConnectButton.Text = if busy then "Connecting..." else "Connect"
	self.ConnectButton.Active = not busy
	self.CodeBox.TextEditable = not busy and not self._connected
end

function BridgeWindow:SetConnected(connected: boolean)
	self._connected = connected
	self.ConnectButton.Visible = not connected
	self.DisconnectButton.Visible = connected
	self.CodeBox.TextEditable = not connected and not self._busy
	self._statusBadge.Text = if connected then "LIVE" else "IDLE"
	self._statusBadge.TextColor3 = if connected then Theme.Success else Theme.TextMuted
end

function BridgeWindow:SetStatus(message: string)
	self._status.Text = message
	local lowered = string.lower(message)
	local warning = string.find(lowered, "failed", 1, true)
		or string.find(lowered, "interruption", 1, true)
		or string.find(lowered, "expired", 1, true)
		or string.find(lowered, "unavailable", 1, true)
		or string.find(lowered, "could not", 1, true)
		or string.find(lowered, "limit", 1, true)
	self._status.TextColor3 = if warning then Theme.Warning else if self._connected then Theme.Success else Theme.TextMuted
end

function BridgeWindow:SetVisible(visible: boolean)
	if not self._screenGui or self._screenGui.Enabled == visible then
		return
	end
	self._screenGui.Enabled = visible
	self._visibleChanged:Fire(visible)
end

function BridgeWindow:IsVisible(): boolean
	return self._screenGui ~= nil and self._screenGui.Enabled
end

function BridgeWindow:GetScreenGui(): ScreenGui
	assert(self._screenGui, "Bridge screen gui is unavailable")
	return self._screenGui
end

function BridgeWindow:GetWindow(): Frame
	assert(self._window, "Bridge window is unavailable")
	return self._window
end

function BridgeWindow:GetVisibilityChangedSignal(): RBXScriptSignal
	return self._visibleChanged.Event
end

function BridgeWindow:GetCloseRequestedSignal(): RBXScriptSignal
	return self._closeRequested.Event
end

function BridgeWindow:Destroy()
	for _, connection in self._connections do
		connection:Disconnect()
	end
	table.clear(self._connections)
	self._visibleChanged:Destroy()
	self._closeRequested:Destroy()
	self._screenGui = nil
	self._window = nil
	local current = CoreGui:FindFirstChild(GUI_NAME)
	if current then
		current:Destroy()
	end
end

return BridgeWindow
