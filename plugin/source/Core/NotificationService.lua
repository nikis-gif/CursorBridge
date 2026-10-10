--!strict

local TweenService = game:GetService("TweenService")

local Root = script.Parent.Parent
local Theme = require(Root.UI.Theme)
local Primitives = require(Root.UI.Primitives)

local NotificationService = {}
NotificationService.__index = NotificationService

export type NotificationService = typeof(setmetatable({
	_screenGui = nil :: ScreenGui?,
	_host = nil :: Frame?,
}, NotificationService))

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

function NotificationService.new(screenGui: ScreenGui): NotificationService
	local host = make("Frame", {
		Name = "CursorNotifications",
		AnchorPoint = Vector2.new(1, 1),
		BackgroundTransparency = 1,
		Position = UDim2.new(1, -12, 1, -12),
		Size = UDim2.fromOffset(280, 220),
		ZIndex = 900,
	}, screenGui)
	make("UIListLayout", {
		FillDirection = Enum.FillDirection.Vertical,
		HorizontalAlignment = Enum.HorizontalAlignment.Right,
		VerticalAlignment = Enum.VerticalAlignment.Bottom,
		Padding = UDim.new(0, 6),
	}, host)

	return setmetatable({
		_screenGui = screenGui,
		_host = host,
	}, NotificationService)
end

function NotificationService:Show(message: string, tone: string?, duration: number?)
	local host = self._host
	if not host then
		return
	end
	local card = make("CanvasGroup", {
		Name = "Toast",
		BackgroundColor3 = Theme.SurfaceRaised,
		BorderSizePixel = 0,
		GroupTransparency = 1,
		Size = UDim2.fromOffset(260, 38),
		ZIndex = 901,
	}, host)
	Primitives.Corner(card, Theme.RadiusMedium)
	Primitives.Stroke(card, if tone == "danger" then Theme.Danger else Theme.Border)
	local label = Primitives.Label(card, message, 9, if tone == "danger" then Theme.Danger else Theme.TextMuted, true)
	label.Position = UDim2.fromOffset(10, 0)
	label.Size = UDim2.new(1, -20, 1, 0)
	label.TextTruncate = Enum.TextTruncate.AtEnd
	label.ZIndex = 902

	local motionDisabled = Theme.ReduceMotion == true or Theme.AnimationsEnabled == false
	local fadeTime = if motionDisabled then 0 else Theme.MotionNormal
	if fadeTime > 0 then
		TweenService:Create(card, TweenInfo.new(fadeTime), {GroupTransparency = 0}):Play()
	else
		card.GroupTransparency = 0
	end

	task.delay(duration or 2.6, function()
		if not card.Parent then
			return
		end
		if fadeTime <= 0 then
			card:Destroy()
			return
		end
		local tween = TweenService:Create(card, TweenInfo.new(fadeTime), {GroupTransparency = 1})
		tween:Play()
		tween.Completed:Connect(function()
			if card.Parent then
				card:Destroy()
			end
		end)
	end)
end

function NotificationService:Destroy()
	if self._host then
		self._host:Destroy()
		self._host = nil
	end
	self._screenGui = nil
end

return NotificationService
