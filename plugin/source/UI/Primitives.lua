--!strict

local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local UserInputService = game:GetService("UserInputService")

local Root = script.Parent.Parent
local Theme = require(Root.UI.Theme)

local Primitives = {}

export type ButtonVariant = "Primary" | "Secondary" | "Ghost" | "Danger"

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

function Primitives.Corner(parent: Instance, radius: number?)
	make("UICorner", {CornerRadius = UDim.new(0, radius or Theme.RadiusMedium)}, parent)
end

function Primitives.Stroke(parent: Instance, color: Color3?, thickness: number?): UIStroke
	return make("UIStroke", {
		Color = color or Theme.BorderSoft,
		Thickness = thickness or 1,
		ApplyStrokeMode = Enum.ApplyStrokeMode.Border,
	}, parent)
end

function Primitives.Label(parent: Instance, text: string, size: number, color: Color3?, medium: boolean?): TextLabel
	return make("TextLabel", {
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		Text = text,
		TextColor3 = color or Theme.Text,
		TextSize = size,
		Font = if medium then Enum.Font.GothamMedium else Enum.Font.Gotham,
		TextXAlignment = Enum.TextXAlignment.Left,
		TextYAlignment = Enum.TextYAlignment.Center,
	}, parent)
end

local function buttonColors(variant: ButtonVariant): (Color3, Color3, Color3)
	if variant == "Primary" then
		return Theme.Accent, Theme.AccentText, Theme.AccentHover
	elseif variant == "Danger" then
		return Theme.SurfaceRaised, Theme.Danger, Theme.SurfaceHover
	elseif variant == "Ghost" then
		return Theme.Surface, Theme.TextMuted, Theme.SurfaceHover
	end
	return Theme.SurfaceRaised, Theme.TextMuted, Theme.SurfaceHover
end

local activeButtonTweens: {[TextButton]: any} = setmetatable({}, {__mode = "k"}) :: any

local function readButtonColor(object: TextButton, attributeName: string, fallback: Color3): Color3
	local value = object:GetAttribute(attributeName)
	return if typeof(value) == "Color3" then value else fallback
end

local function readButtonNumber(object: TextButton, attributeName: string, fallback: number): number
	local value = object:GetAttribute(attributeName)
	return if typeof(value) == "number" then value else fallback
end

local function cancelButtonTween(object: TextButton)
	local tween = activeButtonTweens[object]
	if tween then
		tween:Cancel()
		activeButtonTweens[object] = nil
	end
end

local function resolveButtonVisual(object: TextButton): (Color3, Color3, number)
	local hovered = object:GetAttribute("CursorHovered") == true
	local pressed = object:GetAttribute("CursorPressed") == true
	local background = readButtonColor(object, "CursorBaseBackground", object.BackgroundColor3)
	local foreground = readButtonColor(object, "CursorBaseForeground", object.TextColor3)
	local transparency = readButtonNumber(object, "CursorBaseTransparency", object.BackgroundTransparency)

	if hovered then
		background = readButtonColor(object, "CursorHoverBackground", background)
		foreground = readButtonColor(object, "CursorHoverForeground", foreground)
		transparency = readButtonNumber(object, "CursorHoverTransparency", transparency)
	end
	if pressed then
		background = Theme.SurfaceActive
	end

	return background, foreground, transparency
end

local function renderButtonVisual(object: TextButton, animate: boolean)
	cancelButtonTween(object)
	local background, foreground, transparency = resolveButtonVisual(object)
	if not animate or Theme.MotionFast <= 0 or Theme.ReduceMotion == true or Theme.AnimationsEnabled == false then
		object.BackgroundColor3 = background
		object.TextColor3 = foreground
		object.BackgroundTransparency = transparency
		return
	end

	local tween = TweenService:Create(
		object,
		TweenInfo.new(Theme.MotionFast, Enum.EasingStyle.Quad, Enum.EasingDirection.Out),
		{
			BackgroundColor3 = background,
			TextColor3 = foreground,
			BackgroundTransparency = transparency,
		}
	)
	activeButtonTweens[object] = tween
	tween:Play()
end

function Primitives.SetButtonVisual(
	object: TextButton,
	background: Color3,
	foreground: Color3,
	hoverBackground: Color3?,
	hoverForeground: Color3?
)
	object:SetAttribute("CursorBaseBackground", background)
	object:SetAttribute("CursorBaseForeground", foreground)
	object:SetAttribute("CursorHoverBackground", hoverBackground or Theme.SurfaceHover)
	object:SetAttribute("CursorHoverForeground", hoverForeground or Theme.Text)
	renderButtonVisual(object, false)
end

function Primitives.SetButtonTransparency(object: TextButton, baseTransparency: number, hoverTransparency: number)
	object:SetAttribute("CursorBaseTransparency", math.clamp(baseTransparency, 0, 1))
	object:SetAttribute("CursorHoverTransparency", math.clamp(hoverTransparency, 0, 1))
	renderButtonVisual(object, false)
end

function Primitives.RefreshButtonVisual(object: TextButton, animate: boolean?)
	renderButtonVisual(object, animate == true)
end

function Primitives.Button(parent: Instance, text: string, width: number, variant: ButtonVariant?): TextButton
	local style = variant or "Secondary"
	local background, foreground, hover = buttonColors(style)
	local object = make("TextButton", {
		AutoButtonColor = false,
		BackgroundColor3 = background,
		BorderSizePixel = 0,
		Size = UDim2.fromOffset(width, Theme.ControlHeight),
		Text = text,
		TextColor3 = foreground,
		TextSize = 10,
		Font = Enum.Font.GothamMedium,
		Selectable = true,
	}, parent)
	Primitives.Corner(object, Theme.RadiusSmall)
	local outline = Primitives.Stroke(object, if style == "Primary" then Theme.BorderStrong else Theme.BorderSoft)
	outline.Transparency = if style == "Ghost" then 0.55 else 0
	object:SetAttribute("CursorHovered", false)
	object:SetAttribute("CursorPressed", false)
	Primitives.SetButtonVisual(
		object,
		background,
		foreground,
		hover,
		if style == "Primary" then Theme.AccentText else Theme.Text
	)
	Primitives.SetButtonTransparency(object, 0, 0)

	object.MouseEnter:Connect(function()
		if not object.Active then
			return
		end
		object:SetAttribute("CursorHovered", true)
		renderButtonVisual(object, true)
	end)
	object.MouseLeave:Connect(function()
		object:SetAttribute("CursorHovered", false)
		object:SetAttribute("CursorPressed", false)
		renderButtonVisual(object, true)
	end)
	object.MouseButton1Down:Connect(function()
		object:SetAttribute("CursorPressed", true)
		renderButtonVisual(object, false)
	end)
	object.MouseButton1Up:Connect(function()
		object:SetAttribute("CursorPressed", false)
		renderButtonVisual(object, true)
	end)
	object.SelectionGained:Connect(function()
		outline.Color = Theme.Focus
		outline.Transparency = 0
	end)
	object.SelectionLost:Connect(function()
		outline.Color = if style == "Primary" then Theme.BorderStrong else Theme.BorderSoft
		outline.Transparency = if style == "Ghost" then 0.55 else 0
	end)
	object.Destroying:Connect(function()
		cancelButtonTween(object)
	end)
	return object
end

function Primitives.Input(parent: Instance, placeholder: string, width: number): TextBox
	local box = make("TextBox", {
		BackgroundColor3 = Theme.Background,
		BorderSizePixel = 0,
		Size = UDim2.fromOffset(width, Theme.ControlHeight),
		ClearTextOnFocus = false,
		PlaceholderText = placeholder,
		PlaceholderColor3 = Theme.TextFaint,
		Text = "",
		TextColor3 = Theme.Text,
		TextSize = 10,
		Font = Enum.Font.Gotham,
		TextXAlignment = Enum.TextXAlignment.Left,
	}, parent)
	Primitives.Corner(box, Theme.RadiusSmall)
	make("UIPadding", {
		PaddingLeft = UDim.new(0, 9),
		PaddingRight = UDim.new(0, 9),
	}, box)
	local outline = Primitives.Stroke(box, Theme.BorderSoft)
	box.Focused:Connect(function()
		local duration = if Theme.ReduceMotion == true or Theme.AnimationsEnabled == false then 0 else Theme.MotionFast
		if duration <= 0 then
			outline.Color = Theme.BorderStrong
		else
			TweenService:Create(outline, TweenInfo.new(duration), {Color = Theme.BorderStrong}):Play()
		end
	end)
	box.FocusLost:Connect(function()
		local duration = if Theme.ReduceMotion == true or Theme.AnimationsEnabled == false then 0 else Theme.MotionFast
		if duration <= 0 then
			outline.Color = Theme.BorderSoft
		else
			TweenService:Create(outline, TweenInfo.new(duration), {Color = Theme.BorderSoft}):Play()
		end
	end)
	return box
end

function Primitives.Icon(parent: Instance, kind: string, size: number?): Frame
	local extent = size or 14
	local host = make("Frame", {
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		Size = UDim2.fromOffset(extent, extent),
	}, parent)
	local function line(rotation: number, width: number, x: number, y: number)
		make("Frame", {
			AnchorPoint = Vector2.new(0.5, 0.5),
			BackgroundColor3 = Theme.TextMuted,
			BorderSizePixel = 0,
			Position = UDim2.fromOffset(x, y),
			Rotation = rotation,
			Size = UDim2.fromOffset(width, 1),
		}, host)
	end
	if kind == "Close" then
		line(45, extent - 4, math.floor(extent / 2), math.floor(extent / 2))
		line(-45, extent - 4, math.floor(extent / 2), math.floor(extent / 2))
	elseif kind == "Minimize" then
		line(0, extent - 4, math.floor(extent / 2), math.floor(extent / 2) + 2)
	elseif kind == "More" then
		for offset = -4, 4, 4 do
			local dot = make("Frame", {
				AnchorPoint = Vector2.new(0.5, 0.5),
				BackgroundColor3 = Theme.TextMuted,
				BorderSizePixel = 0,
				Position = UDim2.fromOffset(math.floor(extent / 2) + offset, math.floor(extent / 2)),
				Size = UDim2.fromOffset(2, 2),
			}, host)
			Primitives.Corner(dot, 100)
		end
	elseif kind == "Settings" then
		local center = math.floor(extent / 2)
		local ring = make("Frame", {
			AnchorPoint = Vector2.new(0.5, 0.5),
			BackgroundTransparency = 1,
			BorderSizePixel = 0,
			Position = UDim2.fromOffset(center, center),
			Size = UDim2.fromOffset(math.max(7, extent - 5), math.max(7, extent - 5)),
		}, host)
		Primitives.Corner(ring, 100)
		Primitives.Stroke(ring, Theme.TextMuted, 1)
		local dot = make("Frame", {
			AnchorPoint = Vector2.new(0.5, 0.5),
			BackgroundColor3 = Theme.TextMuted,
			BorderSizePixel = 0,
			Position = UDim2.fromScale(0.5, 0.5),
			Size = UDim2.fromOffset(3, 3),
		}, ring)
		Primitives.Corner(dot, 100)
	elseif kind == "Search" then
		local center = math.floor(extent * 0.42)
		local lens = make("Frame", {
			AnchorPoint = Vector2.new(0.5, 0.5),
			BackgroundTransparency = 1,
			BorderSizePixel = 0,
			Position = UDim2.fromOffset(center, center),
			Size = UDim2.fromOffset(math.max(6, extent - 6), math.max(6, extent - 6)),
		}, host)
		Primitives.Corner(lens, 100)
		Primitives.Stroke(lens, Theme.TextMuted, 1)
		line(45, math.max(4, math.floor(extent * 0.38)), math.floor(extent * 0.72), math.floor(extent * 0.72))
	elseif kind == "Refresh" then
		local center = math.floor(extent / 2)
		local ring = make("Frame", {
			AnchorPoint = Vector2.new(0.5, 0.5),
			BackgroundTransparency = 1,
			BorderSizePixel = 0,
			Position = UDim2.fromOffset(center, center),
			Size = UDim2.fromOffset(math.max(7, extent - 4), math.max(7, extent - 4)),
		}, host)
		Primitives.Corner(ring, 100)
		Primitives.Stroke(ring, Theme.TextMuted, 1)
		local mask = make("Frame", {
			BackgroundColor3 = Theme.SurfaceRaised,
			BorderSizePixel = 0,
			Position = UDim2.fromOffset(math.floor(extent * 0.58), 0),
			Size = UDim2.fromOffset(math.max(4, math.floor(extent * 0.42)), math.max(4, math.floor(extent * 0.32))),
		}, host)
		mask.BackgroundTransparency = 0
		line(-35, 5, math.floor(extent * 0.72), math.floor(extent * 0.25))
		line(55, 4, math.floor(extent * 0.82), math.floor(extent * 0.33))
	end
	return host
end

function Primitives.SetChevronExpanded(host: Frame, expanded: boolean, reduceMotion: boolean?)
	local a = host:FindFirstChild("A")
	local b = host:FindFirstChild("B")
	if not a or not b or not a:IsA("Frame") or not b:IsA("Frame") then
		return
	end
	local aPosition = if expanded then UDim2.fromScale(0.39, 0.48) else UDim2.fromScale(0.48, 0.36)
	local bPosition = if expanded then UDim2.fromScale(0.61, 0.48) else UDim2.fromScale(0.48, 0.64)
	local aRotation = 45
	local bRotation = -45
	local duration = if reduceMotion == true or Theme.ReduceMotion == true or Theme.AnimationsEnabled == false then 0 else Theme.MotionFast
	if duration <= 0 then
		a.Position = aPosition
		b.Position = bPosition
		a.Rotation = aRotation
		b.Rotation = bRotation
		return
	end
	local info = TweenInfo.new(duration, Enum.EasingStyle.Quint, Enum.EasingDirection.Out)
	TweenService:Create(a, info, {Position = aPosition, Rotation = aRotation}):Play()
	TweenService:Create(b, info, {Position = bPosition, Rotation = bRotation}):Play()
end

function Primitives.Chevron(parent: Instance, expanded: boolean, size: number?): Frame
	local host = make("Frame", {
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		Size = UDim2.fromOffset(size or 12, size or 12),
	}, parent)
	make("Frame", {
		Name = "A",
		AnchorPoint = Vector2.new(0.5, 0.5),
		BackgroundColor3 = Theme.TextFaint,
		BorderSizePixel = 0,
		Position = UDim2.fromScale(0.48, 0.36),
		Size = UDim2.fromOffset(6, 1),
		Rotation = 45,
	}, host)
	make("Frame", {
		Name = "B",
		AnchorPoint = Vector2.new(0.5, 0.5),
		BackgroundColor3 = Theme.TextFaint,
		BorderSizePixel = 0,
		Position = UDim2.fromScale(0.48, 0.64),
		Size = UDim2.fromOffset(6, 1),
		Rotation = -45,
	}, host)
	Primitives.SetChevronExpanded(host, expanded, true)
	return host
end

function Primitives.Eye(parent: Instance, visible: boolean, size: number?): Frame
	local extent = size or 14
	local host = make("Frame", {
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		Size = UDim2.fromOffset(extent, extent),
	}, parent)
	local ring = make("Frame", {
		Name = "Ring",
		AnchorPoint = Vector2.new(0.5, 0.5),
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		Position = UDim2.fromScale(0.5, 0.5),
		Size = UDim2.fromOffset(extent - 3, math.max(6, extent - 7)),
	}, host)
	Primitives.Corner(ring, 100)
	Primitives.Stroke(ring, if visible then Theme.TextMuted else Theme.TextFaint, 1)
	local pupil = make("Frame", {
		Name = "Pupil",
		AnchorPoint = Vector2.new(0.5, 0.5),
		BackgroundColor3 = if visible then Theme.TextMuted else Theme.TextFaint,
		BorderSizePixel = 0,
		Position = UDim2.fromScale(0.5, 0.5),
		Size = UDim2.fromOffset(3, 3),
		Visible = visible,
	}, ring)
	Primitives.Corner(pupil, 100)
	if not visible then
		make("Frame", {
			Name = "Slash",
			AnchorPoint = Vector2.new(0.5, 0.5),
			BackgroundColor3 = Theme.TextFaint,
			BorderSizePixel = 0,
			Position = UDim2.fromScale(0.5, 0.5),
			Rotation = -35,
			Size = UDim2.fromOffset(extent - 1, 1),
		}, host)
	end
	return host
end

function Primitives.SetCanvasGroupVisible(group: CanvasGroup, visible: boolean, reduceMotion: boolean?)
	local motionDisabled = reduceMotion == true or Theme.ReduceMotion == true or Theme.AnimationsEnabled == false
	local duration = if motionDisabled then 0 else Theme.MotionNormal

	local rawToken = group:GetAttribute("CursorVisibilityToken")
	local token = (if typeof(rawToken) == "number" then rawToken else 0) + 1
	group:SetAttribute("CursorVisibilityToken", token)
	group:SetAttribute("CursorTargetVisible", visible)
	group.Interactable = visible

	if visible then
		group.Visible = true
		if duration <= 0 then
			group.GroupTransparency = 0
			return
		end
		group.GroupTransparency = math.min(group.GroupTransparency, 0.96)
		TweenService:Create(group, TweenInfo.new(duration, Enum.EasingStyle.Quint, Enum.EasingDirection.Out), {
			GroupTransparency = 0,
		}):Play()
		return
	end

	if duration <= 0 then
		group.GroupTransparency = 1
		group.Visible = false
		return
	end

	TweenService:Create(group, TweenInfo.new(duration * 0.75, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
		GroupTransparency = 1,
	}):Play()
	task.delay(duration * 0.8, function()
		if not group.Parent then
			return
		end
		if group:GetAttribute("CursorVisibilityToken") ~= token then
			return
		end
		if group:GetAttribute("CursorTargetVisible") == false then
			group.Visible = false
		end
	end)
end

function Primitives.AttachTooltip(gui: GuiObject, screenGui: ScreenGui, text: string, reduceMotion: () -> boolean)
	local tooltip = make("CanvasGroup", {
		Name = "Tooltip",
		BackgroundColor3 = Theme.Overlay,
		BorderSizePixel = 0,
		GroupTransparency = 1,
		Visible = false,
		Interactable = false,
		Size = UDim2.fromOffset(math.max(64, #text * 6 + 18), 26),
		ZIndex = 500,
	}, screenGui)
	tooltip:SetAttribute("CursorTooltip", true)
	Primitives.Corner(tooltip, Theme.RadiusSmall)
	Primitives.Stroke(tooltip, Theme.BorderSoft)

	local label = Primitives.Label(tooltip, text, 9, Theme.TextMuted, false)
	label.Position = UDim2.fromOffset(8, 0)
	label.Size = UDim2.new(1, -16, 1, 0)
	label.ZIndex = 501

	local hoverToken = 0
	local hovering = false
	local watchConnection: RBXScriptConnection? = nil
	local destroyed = false

	local function disconnectWatch()
		if watchConnection then
			watchConnection:Disconnect()
			watchConnection = nil
		end
	end

	local function isEffectivelyVisible(): boolean
		if destroyed or not screenGui.Enabled or not gui:IsDescendantOf(screenGui) then
			return false
		end

		local current: Instance? = gui
		while current and current ~= screenGui do
			if current:IsA("GuiObject") and not current.Visible then
				return false
			end
			if current:IsA("CanvasGroup") and current.GroupTransparency >= 0.995 then
				return false
			end
			current = current.Parent
		end

		return current == screenGui and gui.AbsoluteSize.X > 0 and gui.AbsoluteSize.Y > 0
	end

	local function isMouseInside(): boolean
		local mouse = UserInputService:GetMouseLocation()
		local position = gui.AbsolutePosition
		local size = gui.AbsoluteSize
		return mouse.X >= position.X
			and mouse.X <= position.X + size.X
			and mouse.Y >= position.Y
			and mouse.Y <= position.Y + size.Y
	end

	local function hideTooltip()
		disconnectWatch()
		if tooltip.Parent then
			-- Tooltips are transient; hide immediately so stale hints never linger.
			Primitives.SetCanvasGroupVisible(tooltip, false, true)
		end
	end

	local function startWatch()
		disconnectWatch()
		watchConnection = RunService.Heartbeat:Connect(function()
			if not hovering or not isEffectivelyVisible() or not isMouseInside() then
				hovering = false
				hoverToken += 1
				hideTooltip()
			end
		end)
	end

	gui.MouseEnter:Connect(function()
		hovering = true
		hoverToken += 1
		local token = hoverToken

		task.delay(0.38, function()
			if destroyed or token ~= hoverToken or not hovering or not isEffectivelyVisible() or not isMouseInside() then
				return
			end

			-- Only one tooltip may be visible at a time.
			for _, child in screenGui:GetChildren() do
				if child ~= tooltip and child:IsA("CanvasGroup") and child:GetAttribute("CursorTooltip") == true then
					Primitives.SetCanvasGroupVisible(child, false, true)
				end
			end

			local viewport = workspace.CurrentCamera and workspace.CurrentCamera.ViewportSize or Vector2.new(1280, 720)
			local x = math.clamp(
				gui.AbsolutePosition.X + gui.AbsoluteSize.X * 0.5 - tooltip.AbsoluteSize.X * 0.5,
				6,
				math.max(6, viewport.X - tooltip.AbsoluteSize.X - 6)
			)
			local y = gui.AbsolutePosition.Y + gui.AbsoluteSize.Y + 6
			if y + tooltip.AbsoluteSize.Y > viewport.Y - 6 then
				y = gui.AbsolutePosition.Y - tooltip.AbsoluteSize.Y - 6
			end

			tooltip.Position = UDim2.fromOffset(x, math.max(6, y))
			Primitives.SetCanvasGroupVisible(tooltip, true, reduceMotion())
			startWatch()
		end)
	end)

	gui.MouseLeave:Connect(function()
		hovering = false
		hoverToken += 1
		hideTooltip()
	end)

	gui.Destroying:Connect(function()
		destroyed = true
		hovering = false
		hoverToken += 1
		disconnectWatch()
		if tooltip.Parent then
			tooltip:Destroy()
		end
	end)
end


function Primitives.Divider(parent: Instance, vertical: boolean?): Frame
	return make("Frame", {
		BackgroundColor3 = Theme.BorderSoft,
		BackgroundTransparency = 0.22,
		BorderSizePixel = 0,
		Size = if vertical then UDim2.new(0, 1, 1, 0) else UDim2.new(1, 0, 0, 1),
	}, parent)
end

function Primitives.Card(parent: Instance, height: number?): Frame
	local card = make("Frame", {
		BackgroundColor3 = Theme.SurfaceRaised,
		BorderSizePixel = 0,
		Size = UDim2.new(1, 0, 0, height or 96),
		ClipsDescendants = true,
	}, parent)
	Primitives.Corner(card, Theme.RadiusLarge)
	Primitives.Stroke(card, Theme.BorderSoft)
	return card
end

function Primitives.Badge(parent: Instance, text: string, tone: string?): TextLabel
	local color = Theme.TextMuted
	local background = Theme.SurfaceActive
	if tone == "success" then
		color = Theme.Success
		background = Theme.Success:Lerp(Theme.Surface, 0.82)
	elseif tone == "warning" then
		color = Theme.Warning
		background = Theme.Warning:Lerp(Theme.Surface, 0.84)
	elseif tone == "danger" then
		color = Theme.Danger
		background = Theme.Danger:Lerp(Theme.Surface, 0.84)
	elseif tone == "accent" then
		color = Theme.Accent
		background = Theme.AccentFaint
	end
	local badge = make("TextLabel", {
		AutomaticSize = Enum.AutomaticSize.X,
		BackgroundColor3 = background,
		BorderSizePixel = 0,
		Size = UDim2.fromOffset(0, 20),
		Text = text,
		TextColor3 = color,
		TextSize = 8,
		Font = Enum.Font.GothamMedium,
	}, parent)
	Primitives.Corner(badge, Theme.RadiusSmall)
	make("UIPadding", {
		PaddingLeft = UDim.new(0, 7),
		PaddingRight = UDim.new(0, 7),
	}, badge)
	return badge
end

function Primitives.SectionHeader(parent: Instance, titleText: string, descriptionText: string?): Frame
	local height = if descriptionText and descriptionText ~= "" then 42 else 24
	local host = make("Frame", {
		BackgroundTransparency = 1,
		Size = UDim2.new(1, 0, 0, height),
	}, parent)
	local title = Primitives.Label(host, titleText, 11, Theme.Text, true)
	title.Size = UDim2.new(1, 0, 0, 20)
	if descriptionText and descriptionText ~= "" then
		local description = Primitives.Label(host, descriptionText, 8, Theme.TextFaint, false)
		description.Position = UDim2.fromOffset(0, 21)
		description.Size = UDim2.new(1, 0, 0, 17)
		description.TextTruncate = Enum.TextTruncate.AtEnd
	end
	return host
end

function Primitives.SearchInput(parent: Instance, placeholder: string, width: number): (Frame, TextBox)
	local host = make("Frame", {
		BackgroundColor3 = Theme.Background,
		BorderSizePixel = 0,
		Size = UDim2.fromOffset(width, 32),
	}, parent)
	Primitives.Corner(host, Theme.RadiusMedium)
	local outline = Primitives.Stroke(host, Theme.BorderSoft)
	local icon = Primitives.Icon(host, "Search", 13)
	icon.Position = UDim2.fromOffset(10, 9)
	local input = make("TextBox", {
		BackgroundTransparency = 1,
		BorderSizePixel = 0,
		ClearTextOnFocus = false,
		PlaceholderText = placeholder,
		PlaceholderColor3 = Theme.TextFaint,
		Text = "",
		TextColor3 = Theme.Text,
		TextSize = 10,
		Font = Enum.Font.Gotham,
		TextXAlignment = Enum.TextXAlignment.Left,
		Position = UDim2.fromOffset(31, 0),
		Size = UDim2.new(1, -39, 1, 0),
	}, host)
	input.Focused:Connect(function()
		outline.Color = Theme.Focus
	end)
	input.FocusLost:Connect(function()
		outline.Color = Theme.BorderSoft
	end)
	return host, input
end

function Primitives.EmptyState(parent: Instance, titleText: string, descriptionText: string): Frame
	local host = make("Frame", {
		BackgroundTransparency = 1,
		Size = UDim2.fromScale(1, 1),
	}, parent)
	local marker = make("Frame", {
		AnchorPoint = Vector2.new(0.5, 0.5),
		BackgroundColor3 = Theme.SurfaceRaised,
		BorderSizePixel = 0,
		Position = UDim2.new(0.5, 0, 0.5, -22),
		Size = UDim2.fromOffset(28, 28),
	}, host)
	Primitives.Corner(marker, 14)
	Primitives.Stroke(marker, Theme.BorderSoft)
	local dot = make("Frame", {
		AnchorPoint = Vector2.new(0.5, 0.5),
		BackgroundColor3 = Theme.TextFaint,
		BorderSizePixel = 0,
		Position = UDim2.fromScale(0.5, 0.5),
		Size = UDim2.fromOffset(4, 4),
	}, marker)
	Primitives.Corner(dot, 2)
	local title = Primitives.Label(host, titleText, 11, Theme.Text, true)
	title.AnchorPoint = Vector2.new(0.5, 0.5)
	title.Position = UDim2.new(0.5, 0, 0.5, 2)
	title.Size = UDim2.new(1, -40, 0, 20)
	title.TextXAlignment = Enum.TextXAlignment.Center
	local description = Primitives.Label(host, descriptionText, 8, Theme.TextFaint, false)
	description.AnchorPoint = Vector2.new(0.5, 0)
	description.Position = UDim2.new(0.5, 0, 0.5, 15)
	description.Size = UDim2.new(1, -50, 0, 36)
	description.TextWrapped = true
	description.TextXAlignment = Enum.TextXAlignment.Center
	description.TextYAlignment = Enum.TextYAlignment.Top
	return host
end

function Primitives.SetButtonEnabled(object: TextButton, enabled: boolean)
	object.Active = enabled
	object.Selectable = enabled
	object:SetAttribute("CursorDisabled", not enabled)
	if enabled then
		object.TextTransparency = 0
		Primitives.RefreshButtonVisual(object, false)
	else
		object.BackgroundColor3 = Theme.SurfaceDisabled
		object.TextColor3 = Theme.TextDisabled
		object.TextTransparency = 0.05
	end
end

return table.freeze(Primitives)
