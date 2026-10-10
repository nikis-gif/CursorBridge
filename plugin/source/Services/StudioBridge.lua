--!strict

local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")
local ScriptEditorService = game:GetService("ScriptEditorService")

local Defaults = require(script.Parent.Parent.Config.Defaults)
local HierarchyMutations = require(script.Parent.HierarchyMutations)
local QuickApply = require(script.Parent.QuickApply)

local StudioBridge = {}
StudioBridge.__index = StudioBridge

local MANAGED_CLASSES: {[string]: boolean} = {
	Workspace = true,
	ReplicatedFirst = true,
	ReplicatedStorage = true,
	ServerScriptService = true,
	ServerStorage = true,
	StarterGui = true,
	StarterPack = true,
	StarterPlayer = true,
	Lighting = true,
	SoundService = true,
	Teams = true,
	Chat = true,
	TextChatService = true,
	Players = true,
	TestService = true,
	LocalizationService = true,
	MaterialService = true,
}

local function isScript(instance: Instance): boolean
	return instance:IsA("LuaSourceContainer")
end

local function getPlaceKey(): string
	return string.format("%s-%s", tostring(game.GameId), tostring(game.PlaceId))
end

function StudioBridge.new()
	local self = setmetatable({}, StudioBridge)
	self.StateChanged = Instance.new("BindableEvent")
	self._alive = true
	self._connected = false
	self._connecting = false
	self._token = nil :: string?
	self._sessionId = nil :: string?
	self._studioRunId = HttpService:GenerateGUID(false)
	self._placeKey = getPlaceKey()
	self._placeName = game.Name
	self._sequence = 0
	self._inFlightBatch = nil
	self._queue = {} :: {any}
	self._queueHead = 1
	self._sourceQueue = {} :: {[string]: Instance}
	self._results = {} :: {any}
	self._lastSources = {} :: {[string]: string}
	self._scriptIds = {} :: {string}
	self._auditIndex = 0
	self._handledOps = {} :: {[string]: boolean}
	self._instanceIds = setmetatable({}, { __mode = "k" }) :: {[Instance]: string}
	self._instances = {} :: {[string]: Instance}
	self._siblingOrder = setmetatable({}, { __mode = "k" }) :: {[Instance]: number}
	self._connections = {} :: {[string]: {RBXScriptConnection}}
	self._globalConnections = {} :: {RBXScriptConnection}
	self._status = "Disconnected"
	return self
end

function StudioBridge:_notify(status: string)
	self._status = status
	self.StateChanged:Fire(status)
end

function StudioBridge:_request(endpoint: string, body: any, token: string?): any
	local headers: {[string]: string} = {
		["Content-Type"] = "application/json",
		["X-Cursor-Bridge"] = "1",
	}
	if token then
		headers.Authorization = "Bearer " .. token
	end
	local succeeded, response = pcall(function()
		return HttpService:RequestAsync({
			Url = Defaults.ServerURL .. endpoint,
			Method = "POST",
			Headers = headers,
			Body = HttpService:JSONEncode(body),
		})
	end)
	if not succeeded then
		error("Local application unavailable: " .. tostring(response))
	end
	local decodedOK, decoded = pcall(function()
		return HttpService:JSONDecode(response.Body)
	end)
	if not decodedOK or typeof(decoded) ~= "table" then
		error("Cursor Bridge returned an invalid response.")
	end
	if not response.Success or decoded.ok ~= true then
		error(string.format("Bridge HTTP %s: %s", tostring(response.StatusCode), tostring(decoded.error)))
	end
	return decoded
end

function StudioBridge:_idFor(instance: Instance): string
	local existing = self._instanceIds[instance]
	if existing then
		-- Reparenting preserves identity, but removed mappings must be reattached.
		self._instances[existing] = instance
		return existing
	end
	local identifier = HttpService:GenerateGUID(false)
	self._instanceIds[instance] = identifier
	self._instances[identifier] = instance
	return identifier
end

function StudioBridge:_isManaged(instance: Instance): boolean
	local current: Instance? = instance
	while current and current.Parent and current.Parent ~= game do
		current = current.Parent
	end
	return current ~= nil and current.Parent == game and MANAGED_CLASSES[current.ClassName] == true
end

function StudioBridge:_editorSource(instance: Instance): string?
	if not isScript(instance) then
		return nil
	end
	local success, source = pcall(function()
		return ScriptEditorService:GetEditorSource(instance :: LuaSourceContainer)
	end)
	if not success or typeof(source) ~= "string" then
		warn("[Cursor Bridge] Could not read script: " .. instance:GetFullName())
		return nil
	end
	if #source > Defaults.MaxScriptBytes then
		warn("[Cursor Bridge] Script exceeds the source size limit: " .. instance:GetFullName())
		return nil
	end
	return source
end

function StudioBridge:_enqueueOperation(op: any)
	if #self._queue - self._queueHead > Defaults.MaxPendingOperations then
		self:_notify("Queue limit reached; disconnecting to avoid memory exhaustion.")
		self:Disconnect(false)
		return
	end
	table.insert(self._queue, op)
end

function StudioBridge:_sourceChanged(instance: Instance)
	if not self._connected or not self:_isManaged(instance) then
		return
	end
	local identifier = self:_idFor(instance)
	self._sourceQueue[identifier] = instance
end

function StudioBridge:_indexSiblingOrder(parent: Instance)
	for index, child in parent:GetChildren() do
		self._siblingOrder[child] = index
	end
end

function StudioBridge:_metadata(instance: Instance, includeSource: boolean): any
	local parent = instance.Parent
	if parent and self._siblingOrder[instance] == nil then
		self:_indexSiblingOrder(parent)
	end
	local result: any = {
		siblingOrder = self._siblingOrder[instance] or 1,
		id = self:_idFor(instance),
		parentId = parent == game and "game" or (if parent then self:_idFor(parent) else "game"),
		name = instance.Name,
		className = instance.ClassName,
	}
	if isScript(instance) and includeSource then
		local source = self:_editorSource(instance)
		if source then
			result.source = source
			self._lastSources[result.id] = source
		else
			result.sourceAvailable = false
		end
	end
	return result
end

function StudioBridge:_unwatch(instance: Instance)
	local id = self._instanceIds[instance]
	if not id then
		return
	end
	local connections = self._connections[id]
	if connections then
		for _, connection in connections do
			connection:Disconnect()
		end
	end
	self._connections[id] = nil
	if isScript(instance) then
		local index = table.find(self._scriptIds, id)
		if index then
			table.remove(self._scriptIds, index)
			self._auditIndex = math.min(self._auditIndex, #self._scriptIds)
		end
	end
	self._sourceQueue[id] = nil
	self._instances[id] = nil
	self._lastSources[id] = nil
end

function StudioBridge:_observe(instance: Instance)
	if not self:_isManaged(instance) then
		return
	end
	local id = self:_idFor(instance)
	if self._connections[id] then
		return
	end
	local connections: {RBXScriptConnection} = {}
	table.insert(connections, instance:GetPropertyChangedSignal("Name"):Connect(function()
		if self._connected and self:_isManaged(instance) then
			self:_enqueueOperation({ type = "upsert", node = self:_metadata(instance, false) })
		end
	end))
	-- Parent changes within the DataModel are not guaranteed to fire a game-level
	-- descendant event. Capture moves independently to retain exact hierarchy.
	table.insert(connections, instance:GetPropertyChangedSignal("Parent"):Connect(function()
		if not self._connected then return end
		if self:_isManaged(instance) then
			local parent = instance.Parent
			if parent then self:_indexSiblingOrder(parent) end
			self:_enqueueOperation({ type = "upsert", node = self:_metadata(instance, false) })
		else
			self:_enqueueOperation({ type = "remove", id = id })
		end
	end))
	if isScript(instance) then
		table.insert(self._scriptIds, id)
		local ok, signal = pcall(function()
			return instance:GetPropertyChangedSignal("Source")
		end)
		if ok then
			table.insert(connections, signal:Connect(function()
				self:_sourceChanged(instance)
			end))
		end
	end
	self._connections[id] = connections
end

function StudioBridge:_watchChanges()
	table.insert(self._globalConnections, game.DescendantAdded:Connect(function(instance: Instance)
		if not self._connected or not self:_isManaged(instance) then
			return
		end
		local parent = instance.Parent
		if parent then self:_indexSiblingOrder(parent) end
		local function track(target: Instance)
			local id = self:_idFor(target)
			if self._connections[id] then return end
			self:_observe(target)
			self:_enqueueOperation({ type = "upsert", node = self:_metadata(target, true) })
		end
		track(instance)
		for _, descendant in instance:GetDescendants() do track(descendant) end
	end))
	table.insert(self._globalConnections, game.DescendantRemoving:Connect(function(instance: Instance)
		local id = self._instanceIds[instance]
		local descendants = instance:GetDescendants()
		task.defer(function()
			if not self._connected then return end
			if self:_isManaged(instance) then
				-- Reparented within the place: keep stable ids and descendant watchers.
				if id then self:_enqueueOperation({ type = "upsert", node = self:_metadata(instance, false) }) end
				return
			end
			if id and self._connections[id] then
				self:_enqueueOperation({ type = "remove", id = id })
			end
			self:_unwatch(instance)
			for _, descendant in descendants do self:_unwatch(descendant) end
		end)
	end))
	table.insert(self._globalConnections, ScriptEditorService.TextDocumentDidChange:Connect(function(document: ScriptDocument)
		local ok, instance = pcall(function()
			return document:GetScript()
		end)
		if ok and instance and self:_isManaged(instance) then
			self:_sourceChanged(instance)
		end
	end))
	table.insert(self._globalConnections, ScriptEditorService.TextDocumentDidOpen:Connect(function(document: ScriptDocument)
		local ok, instance = pcall(function()
			return document:GetScript()
		end)
		if ok and instance then self:_sourceChanged(instance) end
	end))
	table.insert(self._globalConnections, ScriptEditorService.TextDocumentDidClose:Connect(function(document: ScriptDocument)
		local ok, instance = pcall(function()
			return document:GetScript()
		end)
		if ok and instance then self:_sourceChanged(instance) end
	end))
end

function StudioBridge:_flushSources()
	for id, instance in self._sourceQueue do
		self._sourceQueue[id] = nil
		if instance.Parent and self:_isManaged(instance) then
			local source = self:_editorSource(instance)
			if source and source ~= self._lastSources[id] then
				self._lastSources[id] = source
				self:_enqueueOperation({ type = "source", id = id, source = source })
			end
		end
	end
end

function StudioBridge:_auditChanges()
	if #self._scriptIds == 0 then return end
	for _ = 1, math.min(20, #self._scriptIds) do
		self._auditIndex = (self._auditIndex % #self._scriptIds) + 1
		local id = self._scriptIds[self._auditIndex]
		local instance = self._instances[id]
		if instance and self:_isManaged(instance) then
			local source = self:_editorSource(instance)
			if source and source ~= self._lastSources[id] then
				self._sourceQueue[id] = instance
			end
		end
	end
end

function StudioBridge:_nextBatch(): {any}?
	self:_flushSources()
	if self._queueHead > #self._queue and #self._results == 0 then
		return nil
	end
	local ops: {any} = {}
	local bytes = 2
	-- Results must precede observer notifications to avoid false write conflicts.
	while #self._results > 0 and #ops < Defaults.MaxOperationsPerBatch do
		local op = self._results[1]
		local encoded = HttpService:JSONEncode(op)
		if #ops > 0 and bytes + #encoded > Defaults.MaxBatchBytes then break end
		table.insert(ops, table.remove(self._results, 1))
		bytes += #encoded + 1
	end
	while self._queueHead <= #self._queue and #ops < Defaults.MaxOperationsPerBatch do
		local op = self._queue[self._queueHead]
		local encoded = HttpService:JSONEncode(op)
		if #ops > 0 and bytes + #encoded > Defaults.MaxBatchBytes then break end
		table.insert(ops, op)
		self._queueHead += 1
		bytes += #encoded + 1
	end
	if self._queueHead > #self._queue then
		self._queue = {}
		self._queueHead = 1
	end
	return ops
end

function StudioBridge:_sendNextBatch()
	local ops = self._inFlightBatch or self:_nextBatch()
	if not ops or #ops == 0 then return end
	self._inFlightBatch = ops
	local sequence = self._sequence + 1
	local data = self:_request("/v1/changes", { sequence = sequence, ops = ops }, self._token)
	if data.receivedSequence ~= sequence then
		error("The server did not acknowledge the expected batch.")
	end
	self._sequence = sequence
	self._inFlightBatch = nil
end

function StudioBridge:_applyCommand(command: any)
	if typeof(command) ~= "table" or typeof(command.opId) ~= "string" then return end
	if self._handledOps[command.opId] then return end
	self._handledOps[command.opId] = true
	if command.type == "quickApply" then
		local commandSessionId = self._sessionId
		-- An AI bundle can contain several yielding script-editor writes.
		-- Run it separately so heartbeat polling stays responsive.
		task.spawn(function()
			local ok, reply = pcall(function()
				return QuickApply.Execute(command, self._instances, function(target: Instance)
					return self:_isManaged(target)
				end, function(target: Instance)
					return self:_idFor(target)
				end, function(): boolean
					return self._alive and self._connected and self._sessionId == commandSessionId
						and not RunService:IsRunning() and getPlaceKey() == self._placeKey
				end)
			end)
			if not ok then
				reply = {type = "quickApplyResult", opId = command.opId, status = "error",
					results = {{index = -1, status = "error", message = tostring(reply)}}}
			end
			if self._alive and self._connected then
				table.insert(self._results, reply)
				for _, entry in command.entries do
					if entry.action == "modify" and entry.scriptId then
						local target = self._instances[entry.scriptId]
						if target then self:_sourceChanged(target) end
					end
				end
			end
		end)
		return
	end
	if command.type == "mutate" then
		local ok, result = pcall(function()
			return HierarchyMutations.Execute(command, self._instances, function(target: Instance)
				return self:_isManaged(target)
			end, function(target: Instance)
				return self:_idFor(target)
			end)
		end)
		if not ok then
			result = { type = "mutationResult", opId = command.opId, status = "error",
				results = {{ id = "", status = "error", message = tostring(result) }} }
		end
		table.insert(self._results, result)
		return
	end
	local instance = self._instances[command.scriptId]
	local result: any = { type = "result", opId = command.opId, id = command.scriptId, status = "error" }
	if not instance or not instance.Parent or not isScript(instance) then
		result.status = "missing"
	elseif command.type == "open" then
		local success, opened, message = pcall(function()
			return ScriptEditorService:OpenScriptDocumentAsync(instance :: LuaSourceContainer, {})
		end)
		result.status = if success and opened then "applied" else "error"
		if result.status == "error" then warn("[Cursor Bridge] Open failed: " .. tostring(message)) end
	elseif command.type == "write" and typeof(command.expectedSource) == "string" and typeof(command.newSource) == "string" then
		local before = self:_editorSource(instance)
		if before ~= command.expectedSource then
			result.status = "conflict"
			result.source = before
		elseif #command.newSource > Defaults.MaxScriptBytes then
			result.status = "error"
		else
			local updated = false
			local succeeded, message = pcall(function()
				ScriptEditorService:UpdateSourceAsync(instance :: LuaSourceContainer, function(currentSource: string): string?
					if currentSource ~= command.expectedSource then return nil end
					updated = true
					return command.newSource
				end)
			end)
			local after = self:_editorSource(instance)
			if succeeded and updated and after == command.newSource then
				result.status = "applied"
				result.source = after
				self._lastSources[command.scriptId] = after
				self._sourceQueue[command.scriptId] = nil
			else
				result.status = if succeeded then "conflict" else "error"
				result.source = after
				warn("[Cursor Bridge] Studio edit not applied: " .. tostring(message))
			end
		end
	end
	table.insert(self._results, result)
end

function StudioBridge:_syncLoop()
	local failures = 0
	while self._alive and self._connected do
		if RunService:IsRunning() or getPlaceKey() ~= self._placeKey or game.Name ~= self._placeName then
			self:_notify("Place changed or Play Test started. Session released.")
			self:Disconnect(true)
			return
		end
		local succeeded, err = pcall(function()
			self:_auditChanges()
			self:_sendNextBatch()
			local poll = self:_request("/v1/poll", {}, self._token)
			for _, command in poll.commands do
				self:_applyCommand(command)
			end
		end)
		-- The plugin may unload while a local HTTP request is in flight.
		if not self._alive or not self._connected then
			return
		end
		if succeeded then
			failures = 0
			if self._status ~= "Connected" then self:_notify("Connected") end
		else
			failures += 1
			if failures == 1 or failures % 3 == 0 then
				warn("[Cursor Bridge] " .. tostring(err))
				self:_notify("Network interruption: reconnecting...")
			end
			if failures >= Defaults.MaxNetworkFailures then
				self:_notify("Disconnected: network/session expired. Re-pair to continue.")
				self:Disconnect(false)
				return
			end
		end
		task.wait(Defaults.PollInterval)
	end
end

function StudioBridge:Connect(pairingCode: string): (boolean, string)
	if not self._alive then
		return false, "Bridge plugin was shut down."
	end
	if self._connected or self._connecting then
		return false, "A connection is already active."
	end
	if not string.match(pairingCode, "^%d%d%d%d%d%d$") then
		return false, "Enter the six-digit code from the Windows app."
	end
	if RunService:IsRunning() then
		return false, "Stop Play Test before pairing."
	end
	self._connecting = true
	self:_notify("Pairing...")
	local succeeded, result = pcall(function()
		return self:_request("/v1/pair", {
			code = pairingCode,
			studioRunId = self._studioRunId,
			placeKey = getPlaceKey(),
			placeName = game.Name,
		}, nil)
	end)
	self._connecting = false
	if not self._alive then
		-- A pairing request may complete after Studio unloads the plugin.
		if succeeded and typeof(result) == "table" and typeof(result.token) == "string" then
			task.spawn(function()
				pcall(function() self:_request("/v1/disconnect", {}, result.token) end)
			end)
		end
		return false, "Bridge plugin was shut down during pairing."
	end
	if not succeeded then
		self:_notify("Connection failed: " .. tostring(result))
		return false, tostring(result)
	end
	self._connected = true
	self._token = result.token
	self._sessionId = result.sessionId
	self._placeKey = getPlaceKey()
	self._placeName = game.Name
	self._sequence = 0
	self._inFlightBatch = nil
	self._queue = {}
	self._queueHead = 1
	self._sourceQueue = {}
	self._results = {}
	self._handledOps = {}
	self:_enqueueOperation({ type = "reset" })
	self:_watchChanges()
	-- Start the network heartbeat before scanning potentially large places.
	task.spawn(function()
		self:_syncLoop()
	end)
	local count = 0
	self:_indexSiblingOrder(game)
	for _, root in game:GetChildren() do
		if not self._alive or not self._connected then
			return false, "Bridge was disconnected during indexing."
		end
		if MANAGED_CLASSES[root.ClassName] then
			self:_observe(root)
			self:_enqueueOperation({ type = "upsert", node = self:_metadata(root, true) })
			count += 1
			for _, descendant in root:GetDescendants() do
				if not self._alive or not self._connected then
					return false, "Bridge was disconnected during indexing."
				end
				if count >= Defaults.MaxNodes then
					warn("[Cursor Bridge] Maximum instance count reached. Explorer is incomplete.")
					break
				end
				self:_observe(descendant)
				self:_enqueueOperation({ type = "upsert", node = self:_metadata(descendant, true) })
				count += 1
				if count % 200 == 0 then task.wait() end
			end
		end
		if count >= Defaults.MaxNodes then break end
	end
	self:_enqueueOperation({ type = "ready" })
	self:_notify(string.format("Indexing %d instances...", count))
	return true, "Pairing completed."
end

function StudioBridge:IsConnected(): boolean
	return self._connected == true
end

function StudioBridge:Disconnect(notifyServer: boolean?)
	local token = self._token
	self._connected = false
	self._token = nil
	self._sessionId = nil
	for _, connection in self._globalConnections do connection:Disconnect() end
	self._globalConnections = {}
	for _, connections in self._connections do
		for _, connection in connections do connection:Disconnect() end
	end
	self._connections = {}
	self._instances = {}
	self._siblingOrder = setmetatable({}, { __mode = "k" }) :: {[Instance]: number}
	self._instanceIds = setmetatable({}, { __mode = "k" }) :: {[Instance]: string}
	self._lastSources = {}
	self._scriptIds = {}
	self._auditIndex = 0
	self._queue = {}
	self._queueHead = 1
	self._sourceQueue = {}
	self._results = {}
	self._inFlightBatch = nil
	if notifyServer and token then
		task.spawn(function()
			pcall(function() self:_request("/v1/disconnect", {}, token) end)
		end)
	end
	self:_notify("Disconnected")
end

function StudioBridge:Destroy()
	self._alive = false
	self:Disconnect(true)
	self.StateChanged:Destroy()
end

return StudioBridge
