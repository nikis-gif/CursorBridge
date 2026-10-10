--!strict

local RunService = game:GetService("RunService")

-- Imported plugin models must not execute as ordinary game scripts.
if RunService:IsRunning() then
	return
end

local pluginContext: Plugin? = plugin
if pluginContext == nil then
	return
end

local Root = script.Parent
local PLUGIN_ICON = "rbxassetid://132318313203288"

local toolbar = pluginContext:CreateToolbar("Cursor Bridge V2")
local button = toolbar:CreateButton(
	"CursorBridgeV2Toggle",
	"Open Cursor Bridge V2",
	PLUGIN_ICON,
	"Bridge V2"
)
button.ClickableWhenViewportHidden = true

local controller: any = nil
local visibilityConnection: RBXScriptConnection? = nil
local initializing = false
local alive = true

local function reportFailure(stage: string, message: any)
	warn(string.format("[Cursor Bridge V2] %s failed:\n%s", stage, tostring(message)))
end

local function destroyController()
	if visibilityConnection then
		visibilityConnection:Disconnect()
		visibilityConnection = nil
	end

	if controller then
		local activeController = controller
		controller = nil
		local ok, err = xpcall(function()
			activeController:Destroy()
		end, debug.traceback)
		if not ok then
			reportFailure("shutdown", err)
		end
	end

	button:SetActive(false)
end

local function initializeController(): boolean
	if RunService:IsRunning() or initializing then
		return false
	end
	if controller then
		return true
	end

	initializing = true
	local builtController: any = nil
	local ok, err = xpcall(function()
		local BridgeController = require(Root.Controllers.BridgeController)
		builtController = BridgeController.new(pluginContext :: Plugin)
	end, debug.traceback)
	if not ok or not builtController then
		initializing = false
		reportFailure("bootstrap", err)
		return false
	end

	if RunService:IsRunning() then
		initializing = false
		builtController:Destroy()
		return false
	end

	controller = builtController
	visibilityConnection = controller:GetVisibilityChangedSignal():Connect(function(visible: boolean)
		button:SetActive(visible)
	end)

	local started, startErr = xpcall(function()
		controller:Start()
	end, debug.traceback)
	initializing = false
	if not started then
		reportFailure("startup", startErr)
		destroyController()
		return false
	end
	return true
end

button.Click:Connect(function()
	if RunService:IsRunning() or not initializeController() then
		return
	end

	local ok, err = xpcall(function()
		controller:Toggle()
	end, debug.traceback)
	if not ok then
		reportFailure("toggle", err)
	end
end)

-- Match the other Cursor V2 plugins: release all UI and connections for Play Test.
task.spawn(function()
	while alive do
		if RunService:IsRunning() and controller ~= nil then
			destroyController()
		end
		task.wait(0.1)
	end
end)

pluginContext.Unloading:Connect(function()
	alive = false
	destroyController()
end)
