--!strict

local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")
local ScriptEditorService = game:GetService("ScriptEditorService")

local Defaults = require(script.Parent.Parent.Config.Defaults)
local HierarchyMutations = require(script.Parent.HierarchyMutations)
local QuickApply = require(script.Parent.QuickApply)
local WireTransfer = require(script.Parent.WireTransfer)
local PathResolver = require(script.Parent.PathResolver)

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
	self._sourceIds = {} :: {string}
	self._sourceHead = 1
	self._scanQueue = {} :: {Instance}
	self._scanHead = 1
	self._scanQueued = setmetatable({}, { __mode = "k" }) :: {[Instance]: boolean}
	self._scanCount = 0
	self._scanReadySent = false
	self._scanDeferred = false
	self._pageSnapshots = {} :: {[string]: {children: {Instance}, createdAt: number}}
	self._results = {} :: {any}
	self._lastSources = {} :: {[string]: string}
	self._scriptIds = {} :: {string}
	self._auditIndex = 0
	self._handledOps = {} :: {[string]: boolean}
	self._commandQueue = {} :: {any}
	self._workerToken = nil :: any
	self._commandReceiver = WireTransfer.NewReceiver()
	self._commandReceipts = {} :: {[string]: number}
	self._wireFragments = nil :: {any}?
	self._wireHead = 1
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

function StudioBridge:_ensureAncestorsObserved(instance: Instance)
	local lineage = {}
	local parent: Instance? = instance.Parent
	while parent and parent ~= game do
		table.insert(lineage, parent)
		parent = parent.Parent
	end
	for index = #lineage, 1, -1 do
		local ancestor = lineage[index]
		local id = self:_idFor(ancestor)
		if not self._connections[id] then
			self:_observe(ancestor)
			self:_enqueueOperation({type = "upsert", node = self:_metadata(ancestor, false)})
		end
	end
end

function StudioBridge:_sourceChanged(instance: Instance)
	if not self._connected or not self:_isManaged(instance) then
		return
	end
	local identifier = self:_idFor(instance)
	if not self._connections[identifier] then
		-- An externally edited script can be outside the browsed tree; preserve its path.
		self:_ensureAncestorsObserved(instance)
		self:_observe(instance)
		self:_enqueueOperation({type = "upsert", node = self:_metadata(instance, false)})
	end
	if self._sourceQueue[identifier] == nil then
		table.insert(self._sourceIds, identifier)
	end
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
		hasChildren = not isScript(instance) and #instance:GetChildren() > 0,
	}
	if isScript(instance) then
		if includeSource then
			local source = self:_editorSource(instance)
			if source then
				result.source = source
				self._lastSources[result.id] = source
			else
				result.sourceAvailable = false
			end
		elseif self._lastSources[result.id] == nil then
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
			self:_ensureAncestorsObserved(instance)
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

-- Incremental breadth-first traversal. Large model scans must never hold the
-- transport queue, Studio editor, or frame scheduler hostage.
function StudioBridge:_enqueueScan(instance: Instance)
	if self._scanQueued[instance] or not self:_isManaged(instance) then return end
	self._scanQueued[instance] = true
	table.insert(self._scanQueue, instance)
end

function StudioBridge:_scanLoop()
	local sessionId = self._sessionId
	local nextProgress = 0
	while self._alive and self._connected and self._sessionId == sessionId and self._scanHead <= #self._scanQueue do
		local queued = #self._queue - self._queueHead + 1
		if queued >= Defaults.MaxQueuedScanOperations or self._inFlightBatch ~= nil then
			task.wait(0.06)
			continue
		end
		local count = 0
		local sliceStart = os.clock()
		while self._scanHead <= #self._scanQueue and count < Defaults.ScanSliceSize do
			if (#self._queue - self._queueHead + 1) >= Defaults.MaxQueuedScanOperations then break end
			local instance = self._scanQueue[self._scanHead]
			self._scanHead += 1
			self._scanQueued[instance] = nil
			if self:_isManaged(instance) and instance.Parent then
				local id = self:_idFor(instance)
				if not self._connections[id] then
					if self._scanCount >= Defaults.MaxAutomaticNodes then
						self._scanDeferred = true
						self:_enqueueOperation({type = "scanPaused", count = self._scanCount})
						self._scanQueue = {}
						self._scanHead = 1
						return
					end
					self:_observe(instance)
					self:_enqueueOperation({ type = "upsert", node = self:_metadata(instance, false) })
					self._scanCount += 1
					if isScript(instance) then self:_sourceChanged(instance) end
				end
				local children = instance:GetChildren()
				if #children > Defaults.MaxAutomaticSiblings then
					-- Large sibling lists are paged on demand; do not enqueue them all.
					self._scanDeferred = true
				else
					for index, child in children do
						self._siblingOrder[child] = index
						self:_enqueueScan(child)
					end
				end
			end
			count += 1
			if os.clock() - sliceStart > 0.009 then break end
		end
		if not self._scanReadySent then
			self._scanReadySent = true
			self:_enqueueOperation({type = "ready"})
		end
		if os.clock() >= nextProgress then
			self:_enqueueOperation({type = "scanProgress", count = self._scanCount})
			nextProgress = os.clock() + Defaults.ScanProgressInterval
		end
		task.wait(0.02)
	end
	if self._alive and self._connected and self._sessionId == sessionId then
		if not self._scanReadySent then self:_enqueueOperation({type = "ready"}) end
		self:_enqueueOperation({type = if self._scanDeferred then "scanPaused" else "scanComplete",
			count = self._scanCount})
		self._scanQueue = {}
		self._scanHead = 1
		self._scanQueued = setmetatable({}, { __mode = "k" }) :: {[Instance]: boolean}
	end
end

function StudioBridge:_watchChanges()
	table.insert(self._globalConnections, game.DescendantAdded:Connect(function(instance: Instance)
		if not self._connected or not self:_isManaged(instance) then
			return
		end
		local parent = instance.Parent
		if not parent then return end
		if parent == game then
			if not MANAGED_CLASSES[instance.ClassName] then return end
		elseif not self._connections[self._instanceIds[parent] or ""] then
			-- An unexpanded subtree is discovered when the user opens it.
			return
		end
		local id = self:_idFor(instance)
		self:_observe(instance)
		self:_enqueueOperation({ type = "upsert", node = self:_metadata(instance, false) })
		if isScript(instance) then self:_sourceChanged(instance) end
		local parentId = if parent == game then "game" else self:_idFor(parent)
		if parentId ~= "game" then
			self:_enqueueOperation({ type = "upsert", node = self:_metadata(parent, false) })
		end
	end))
	table.insert(self._globalConnections, game.DescendantRemoving:Connect(function(instance: Instance)
		local id = self._instanceIds[instance]
		-- DescendantRemoving also fires for each descendant; never allocate an entire removed subtree.
		task.defer(function()
			if not self._connected then return end
			if self:_isManaged(instance) then
				-- Reparented within the place: keep stable ids and descendant watchers.
				self:_ensureAncestorsObserved(instance)
				if id then self:_enqueueOperation({ type = "upsert", node = self:_metadata(instance, false) }) end
				return
			end
			if id and self._connections[id] then
				self:_enqueueOperation({ type = "remove", id = id })
			end
			self:_unwatch(instance)
			-- Other observed descendants are removed by their own callbacks.
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
	local read = 0
	while self._sourceHead <= #self._sourceIds and read < Defaults.MaxSourcesPerCycle do
		local id = self._sourceIds[self._sourceHead]
		self._sourceHead += 1
		local instance = self._sourceQueue[id]
		self._sourceQueue[id] = nil
		if instance and instance.Parent and self:_isManaged(instance) then
			local source = self:_editorSource(instance)
			if source and source ~= self._lastSources[id] then
				self._lastSources[id] = source
				self:_enqueueOperation({ type = "source", id = id, source = source })
			end
		end
		read += 1
	end
	if self._sourceHead > #self._sourceIds then
		self._sourceIds = {}
		self._sourceHead = 1
	end
end

function StudioBridge:_auditChanges()
	if #self._scriptIds == 0 then return end
	for _ = 1, math.min(Defaults.SourceAuditCount, #self._scriptIds) do
		self._auditIndex = (self._auditIndex % #self._scriptIds) + 1
		local id = self._scriptIds[self._auditIndex]
		local instance = self._instances[id]
		if instance and self:_isManaged(instance) then
			local source = self:_editorSource(instance)
			if source and source ~= self._lastSources[id] then
				self:_sourceChanged(instance)
			end
		end
	end
end

function StudioBridge:_nextBatch(): {any}?
	self:_flushSources()
	local ops: {any} = {}
	local bytes = 4096
	while #ops < Defaults.MaxOperationsPerBatch do
		local op: any = nil
		local origin = ""
		if self._wireFragments then
			op = self._wireFragments[self._wireHead]
			origin = "wire"
		elseif #self._results > 0 then
			op = self._results[1]
			origin = "result"
		elseif self._queueHead <= #self._queue then
			op = self._queue[self._queueHead]
			origin = "queue"
		else break end
		local encoded = HttpService:JSONEncode(op)
		if origin ~= "wire" and #encoded > Defaults.ChunkBytes then
			self._wireFragments = WireTransfer.Encode(op)
			self._wireHead = 1
			if origin == "result" then table.remove(self._results, 1) else self._queueHead += 1 end
			continue
		end
		if bytes + #encoded + 1 > Defaults.MaxBatchBytes then break end
		table.insert(ops, op)
		bytes += #encoded + 1
		if origin == "wire" then
			self._wireHead += 1
			if self._wireHead > #self._wireFragments then self._wireFragments = nil end
		elseif origin == "result" then table.remove(self._results, 1)
		else self._queueHead += 1 end
	end
	if self._queueHead > #self._queue then self._queue = {}; self._queueHead = 1 end
	return if #ops > 0 then ops else nil
end

function StudioBridge:_sendNextBatch()
	local sessionId = self._sessionId
	local ops = self._inFlightBatch or self:_nextBatch() or {}
	self._inFlightBatch = if #ops > 0 then ops else nil
	local sequence = self._sequence + (if #ops > 0 then 1 else 0)
	local receipts = {}
	for id, nextPart in self._commandReceipts do table.insert(receipts, {id = id, next = nextPart}) end
	-- Empty exchanges are authenticated heartbeats, independent of keyboard input.
	local data = self:_request("/v2/exchange", {sequence = sequence, ops = ops, receipts = receipts}, self._token)
	if sessionId ~= self._sessionId or not self._connected then return end
	if data.receivedSequence ~= sequence then error("The server did not acknowledge the expected batch.") end
	self._sequence = sequence
	self._inFlightBatch = nil
	for _, op in ops do
		if op.type == "commandDone" then
			self._handledOps[op.opId] = nil
			self._commandReceiver.completed[op.opId] = nil
		end
	end
	for _, receipt in data.receiptAcks or {} do
		if self._commandReceipts[receipt.id] == receipt.next then self._commandReceipts[receipt.id] = nil end
	end
	for _, command in data.commands do
		if command.type == "wireChunk" then
			local completed, nextPart = WireTransfer.Accept(self._commandReceiver, command)
			self._commandReceipts[command.id] = nextPart
			if completed then self:_queueCommand(completed) end
		else self:_queueCommand(command) end
	end
end

function StudioBridge:_queueCommand(command: any)
	if typeof(command) ~= "table" or typeof(command.opId) ~= "string" or self._handledOps[command.opId] then return end
	self._handledOps[command.opId] = true
	if command.type == "resolvePaths" then
		self._latestPathRequest = command.opId
		for index = #self._commandQueue, 1, -1 do
			local previous = self._commandQueue[index]
			if previous.type == "resolvePaths" then
				table.remove(self._commandQueue, index)
				self:_enqueueOperation({type = "commandDone", opId = previous.opId})
			end
		end
	end
	table.insert(self._commandQueue, command)
	if self._workerToken and not self._workerToken.done then return end
	local worker = {done = false}
	self._workerToken = worker
	local sessionId = self._sessionId
	-- Editor operations may yield. Their worker must never hold the heartbeat loop.
	task.spawn(function()
		while self._alive and self._connected and self._sessionId == sessionId and #self._commandQueue > 0 do
			local nextCommand = table.remove(self._commandQueue, 1)
			local succeeded, problem = pcall(function() self:_applyCommand(nextCommand) end)
			if self._sessionId ~= sessionId or not self._connected then break end
			if not succeeded then
				local reply: any = {type = "result", opId = nextCommand.opId, id = nextCommand.scriptId, status = "error"}
				if nextCommand.type == "resolvePaths" then
					reply = {type = "resolvedPaths", opId = nextCommand.opId, error = tostring(problem)}
				elseif nextCommand.type == "quickApply" then
					reply = {type = "quickApplyResult", opId = nextCommand.opId, status = "error", results = {{index = -1, message = tostring(problem)}}}
				elseif nextCommand.type == "mutate" then
					reply = {type = "mutationResult", opId = nextCommand.opId, status = "error", results = {}}
				elseif nextCommand.type == "loadSource" then
					reply = {type = "sourceUnavailable", id = nextCommand.scriptId}
				elseif nextCommand.type == "listChildren" then
					reply = {type = "childrenPage", opId = nextCommand.opId, parentId = nextCommand.parentId, offset = nextCommand.offset, invalidated = true}
				end
				table.insert(self._results, reply)
				warn("[Cursor Bridge] Command failed: " .. tostring(problem))
			end
			-- The operation result must precede deduplication-cache cleanup.
			self:_enqueueOperation({type = "commandDone", opId = nextCommand.opId})
		end
		worker.done = true
	end)
end

function StudioBridge:_applyCommand(command: any)
	local commandSessionId = self._sessionId
	local function canContinue(): boolean
		return self._alive and self._connected and self._sessionId == commandSessionId
			and not RunService:IsRunning() and getPlaceKey() == self._placeKey
			and (command.type ~= "resolvePaths" or self._latestPathRequest == command.opId)
	end
	if command.type == "resolvePaths" then
		local reply = PathResolver.Resolve(command,
			function(target: Instance): boolean return self:_isManaged(target) end,
			function(target: Instance, withSource: boolean): any return self:_metadata(target, withSource) end,
			function(target: Instance) self:_observe(target) end, canContinue)
		if canContinue() then table.insert(self._results, reply) end
		return
	end
	if command.type == "quickApply" then
		local reply = QuickApply.Execute(command, self._instances,
			function(target: Instance): boolean return self:_isManaged(target) end,
			function(target: Instance): string return self:_idFor(target) end, canContinue)
		if canContinue() then
			table.insert(self._results, reply)
			for _, entry in command.entries do
				if entry.action == "modify" and entry.scriptId then
					local target = self._instances[entry.scriptId]
					if target then self:_sourceChanged(target) end
				end
			end
		end
		return
	end
	if command.type == "listChildren" then
		local parent = self._instances[command.parentId]
		if not parent or not parent.Parent or not self:_isManaged(parent) then
			self:_enqueueOperation({type = "childrenPage", opId = command.opId,
				parentId = command.parentId, offset = command.offset, total = 0,
				children = {}, invalidated = true})
			return
		end
		local offset = command.offset
		if typeof(offset) ~= "number" or offset < 0 or offset % 1 ~= 0 then return end
		local snapshot = self._pageSnapshots[command.parentId]
		if offset == 0 or not snapshot then
			if offset ~= 0 then
				self:_enqueueOperation({type = "childrenPage", opId = command.opId,
					parentId = command.parentId, offset = offset, total = 0,
					children = {}, invalidated = true})
				return
			end
			snapshot = {children = parent:GetChildren(), createdAt = os.clock()}
			self._pageSnapshots[command.parentId] = snapshot
		end
		-- Bound temporary full-sibling arrays: they should not accumulate in long
		-- Studio sessions with many expanded high-cardinality folders.
		snapshot.createdAt = os.clock()
		local active = 0
		local oldestId: string? = nil
		local oldestAt = math.huge
		for key, entry in self._pageSnapshots do
			if os.clock() - entry.createdAt > 600 and key ~= command.parentId then
				self._pageSnapshots[key] = nil
			else
				active += 1
				if key ~= command.parentId and entry.createdAt < oldestAt then
					oldestAt = entry.createdAt
					oldestId = key
				end
			end
		end
		if active > 8 and oldestId then self._pageSnapshots[oldestId] = nil end
		local children = snapshot.children
		local last = math.min(#children, offset + Defaults.ChildrenPageSize)
		local page = {}
		for index = offset + 1, last do
			local child = children[index]
			if child.Parent == parent then
				self._siblingOrder[child] = index
				self:_observe(child)
				table.insert(page, self:_metadata(child, false))
			end
		end
		self:_enqueueOperation({type = "childrenPage", opId = command.opId,
			parentId = command.parentId, offset = offset, nextOffset = last,
			total = #children, children = page})
		if last >= #children then self._pageSnapshots[command.parentId] = nil end
		return
	end
	if command.type == "loadSource" then
		local target = self._instances[command.scriptId]
		if target and target.Parent and isScript(target) and self:_isManaged(target) then
			local source = self:_editorSource(target)
			if source then
				self._lastSources[command.scriptId] = source
				self:_enqueueOperation({type = "source", id = command.scriptId, source = source})
			else
				self:_enqueueOperation({type = "sourceUnavailable", id = command.scriptId})
			end
		else
			self:_enqueueOperation({type = "sourceUnavailable", id = command.scriptId})
		end
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
		if canContinue() then table.insert(self._results, result) end
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
					if currentSource ~= command.expectedSource or not canContinue() then return nil end
					updated = true
					return command.newSource
				end)
			end)
			if not canContinue() then return end
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
	if canContinue() then table.insert(self._results, result) end
end

function StudioBridge:_syncLoop()
	local failures = 0
	local nextAudit, nextLog, nextCleanup = 0, 0, 0
	local sessionId = self._sessionId
	while self._alive and self._connected and self._sessionId == sessionId do
		if RunService:IsRunning() or getPlaceKey() ~= self._placeKey then
			self:_notify("Place changed or Play Test started. Session released.")
			self:Disconnect(true)
			return
		end
		local succeeded, err = pcall(function()
			if os.clock() >= nextAudit then
				self:_auditChanges()
				nextAudit = os.clock() + Defaults.SourceAuditInterval
			end
			if os.clock() >= nextCleanup then
				for id, page in self._pageSnapshots do
					if os.clock() - page.createdAt > 600 then self._pageSnapshots[id] = nil end
				end
				nextCleanup = os.clock() + 60
			end
			self:_sendNextBatch()
		end)
		if not self._alive or not self._connected or self._sessionId ~= sessionId then return end
		local delaySeconds: number
		if succeeded then
			failures = 0
			if self._status ~= "Connected" then self:_notify("Connected") end
			local busy = self._inFlightBatch ~= nil or self._wireFragments ~= nil
				or self._queueHead <= #self._queue or #self._results > 0
				or self._sourceHead <= #self._sourceIds or self._scanHead <= #self._scanQueue
				or next(self._commandReceipts) ~= nil or (self._workerToken and not self._workerToken.done)
			delaySeconds = if busy then Defaults.ActivePollInterval else Defaults.IdlePollInterval
		else
			failures = math.min(failures + 1, 1000)
			local message = tostring(err)
			if string.find(message, "Bridge HTTP 401", 1, true) then
				local resumed, result = pcall(function()
					return self:_request("/v2/resume", {studioRunId = self._studioRunId, placeKey = self._placeKey}, self._token)
				end)
				if resumed then self:_adoptSession(result); return
				elseif string.find(tostring(result), "Bridge HTTP 403", 1, true)
					or string.find(tostring(result), "Bridge HTTP 409", 1, true) then
					self:Disconnect(false)
					self:_notify("Session authorization ended. Pair again to continue.")
					return
				end
			end
			local rateLimited = string.find(string.lower(message), "requests exceeded limit", 1, true) ~= nil
				or string.find(message, "429", 1, true) ~= nil
			if os.clock() >= nextLog then
				warn("[Cursor Bridge] " .. message)
				self:_notify(if rateLimited then "Studio HTTP budget exhausted; retrying automatically..."
					else "Connection interrupted; retrying automatically...")
				nextLog = os.clock() + 60
			end
			-- Transient network failure is not user inactivity. Explicit session
			-- revocation still stops retries; an unknown edit is never reapplied.
			delaySeconds = math.min(Defaults.MaximumRetryDelay,
				Defaults.InitialRetryDelay * (2 ^ math.min(failures - 1, 6)))
		end
		task.wait(delaySeconds)
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
			protocolVersion = Defaults.ProtocolVersion,
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
	if result.protocolVersion ~= Defaults.ProtocolVersion then
		pcall(function() self:_request("/v1/disconnect", {}, result.token) end)
		return false, "Update the Windows app and Studio plugin together to v0.2.9 or later."
	end
	self:_adoptSession(result)
	return true, "Pairing completed."
end

function StudioBridge:_adoptSession(result: any)
	local previousWorker = self._workerToken
	self:Disconnect(false)
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
	self._sourceIds = {}
	self._sourceHead = 1
	self._results = {}
	self._handledOps = {}
	self._commandQueue = {}
	self._workerToken = nil
	self._commandReceiver = WireTransfer.NewReceiver()
	self._commandReceipts = {}
	self._wireFragments = nil
	self._wireHead = 1
	self._scanQueue = {}
	self._scanHead = 1
	self._scanQueued = setmetatable({}, { __mode = "k" }) :: {[Instance]: boolean}
	self._scanCount = 0
	self._scanReadySent = false
	self._scanDeferred = false
	self._pageSnapshots = {}
	self:_enqueueOperation({ type = "reset" })
	self:_enqueueOperation({ type = "scanBegin" })
	local sessionId = self._sessionId
	task.spawn(function() self:_syncLoop() end)
	task.spawn(function()
		while previousWorker and not previousWorker.done do
			if self._sessionId ~= sessionId or not self._connected then return end
			task.wait(0.1)
		end
		if self._sessionId ~= sessionId or not self._connected then return end
		self:_watchChanges()
		self:_indexSiblingOrder(game)
		for _, root in game:GetChildren() do
			if MANAGED_CLASSES[root.ClassName] then
				self:_observe(root)
				self:_enqueueOperation({type = "upsert", node = self:_metadata(root, false)})
				self:_enqueueScan(root)
			end
		end
		-- The Explorer is usable as soon as roots are acknowledged. Deep branches
		-- are discoverable through listChildren regardless of the auto-index budget.
		self:_enqueueOperation({type = "ready"})
		self._scanReadySent = true
		task.spawn(function() self:_scanLoop() end)
		self:_notify("Indexing place hierarchy in the background...")
	end)
end

function StudioBridge:IsConnected(): boolean
	return self._connected == true
end

function StudioBridge:Disconnect(notifyServer: boolean?)
	local token = self._token
	self._connected = false
	self._token = nil
	self._sessionId = nil
	self._handledOps = {}
	self._commandQueue = {}
	self._commandReceiver = WireTransfer.NewReceiver()
	self._commandReceipts = {}
	self._wireFragments = nil
	self._wireHead = 1
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
	self._sourceIds = {}
	self._sourceHead = 1
	self._scanQueue = {}
	self._scanHead = 1
	self._pageSnapshots = {}
	self._scanQueued = setmetatable({}, { __mode = "k" }) :: {[Instance]: boolean}
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
