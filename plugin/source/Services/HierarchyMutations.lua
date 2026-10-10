--!strict

-- All hierarchy mutations run in Roblox Studio, never on the mirrored desktop tree.
-- Optimistic metadata checks protect against edits from Explorer or other plugins.
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local HttpService = game:GetService("HttpService")
local ScriptEditorService = game:GetService("ScriptEditorService")
local RunService = game:GetService("RunService")

local HierarchyMutations = {}

local ALLOWED_CLASSES: {[string]: boolean} = {
	Script = true,
	LocalScript = true,
	ModuleScript = true,
	Folder = true,
	Model = true,
	Part = true,
	MeshPart = true,
	SpawnLocation = true,
	Attachment = true,
	Configuration = true,
	RemoteEvent = true,
	RemoteFunction = true,
	BindableEvent = true,
	BindableFunction = true,
	BoolValue = true,
	IntValue = true,
	NumberValue = true,
	StringValue = true,
	ObjectValue = true,
	ScreenGui = true,
	Frame = true,
	TextLabel = true,
	TextButton = true,
	ImageLabel = true,
	ImageButton = true,
	UIListLayout = true,
	UICorner = true,
	UIPadding = true,
	Sound = true,
	Animation = true,
}

local function scriptSource(target: Instance): string?
	if not target:IsA("LuaSourceContainer") then return nil end
	local ok, source = pcall(function()
		return ScriptEditorService:GetEditorSource(target :: LuaSourceContainer)
	end)
	if ok and typeof(source) == "string" then return source end
	return nil
end

local function updateSource(target: Instance, source: string): boolean
	local ok = pcall(function()
		ScriptEditorService:UpdateSourceAsync(target :: LuaSourceContainer, function(_current: string): string
			return source
		end)
	end)
	return ok
end

local function fingerprint(source: string): string
	local a = 1
	local b = 0
	for index = 1, #source do
		a = (a + string.byte(source, index)) % 65521
		b = (b + a) % 65521
	end
	return tostring(b * 65536 + a) .. ":" .. tostring(#source)
end

local function validName(name: any): boolean
	return typeof(name) == "string" and #name >= 1 and #name <= 100
		and string.match(name, "%S") ~= nil and string.match(name, "[%c]") == nil
end

local function verifyTarget(target: Instance?, metadata: any, managed: (Instance) -> boolean): (boolean, string)
	if not target or not target.Parent then return false, "Instance no longer exists." end
	if target.Parent == game then return false, "Built-in services are protected." end
	if not managed(target) then return false, "Instance is outside the mirrored DataModel." end
	if target.Name ~= metadata.name or target.ClassName ~= metadata.className then
		return false, "Instance was renamed or replaced in Studio."
	end
	return true, ""
end

local function verifyParent(parent: Instance?, snapshot: any, instances: {[string]: Instance}, managed: (Instance) -> boolean): (boolean, string)
	if not parent or not managed(parent) then return false, "Destination is no longer available." end
	if parent.Name ~= snapshot.name or parent.ClassName ~= snapshot.className then
		return false, "Destination changed in Studio."
	end
	local currentParent = parent.Parent
	if (snapshot.parentId == "game" and currentParent ~= game)
		or (snapshot.parentId ~= "game" and instances[snapshot.parentId] ~= currentParent) then
		return false, "Destination moved in Studio."
	end
	return true, ""
end

local function cloneWithCurrentSources(target: Instance, destination: Instance): (boolean, string, Instance?)
	if not target.Archivable then return false, "Instance is not Archivable." end
	local originals = {target}
	for _, child in target:GetDescendants() do table.insert(originals, child) end
	local sources: {[number]: string} = {}
	for index, original in originals do
		if original:IsA("LuaSourceContainer") then
			local source = scriptSource(original)
			if source == nil then return false, "Cannot read a script in the duplicate." end
			sources[index] = source
		end
	end
	local copy = target:Clone()
	if not copy then return false, "Studio rejected the clone." end
	-- Roblox Studio permits siblings with identical names; Clone preserves the name.
	copy.Name = target.Name
	copy.Parent = destination
	local copies = {copy}
	for _, child in copy:GetDescendants() do table.insert(copies, child) end
	if #copies ~= #originals then
		copy:Destroy()
		return false, "Clone excluded non-Archivable descendants."
	end
	for index, source in sources do
		local clonedScript = copies[index]
		if not clonedScript:IsA("LuaSourceContainer") then
			copy:Destroy()
			return false, "Clone structure differs from the original."
		end
		-- Avoid unnecessary writes when Studio already cloned the editor contents.
		if scriptSource(clonedScript) ~= source and not updateSource(clonedScript, source) then
			copy:Destroy()
			return false, "Could not preserve an unsaved Studio script in the duplicate."
		end
	end
	return true, "", copy
end

function HierarchyMutations.Execute(command: any, instances: {[string]: Instance}, managed: (Instance) -> boolean, idFor: (Instance) -> string): any
	local results = {}
	if RunService:IsRunning() then
		return {type = "mutationResult", opId = command.opId, status = "error", results = {
			{id = "", status = "error", message = "Stop Play Test before editing the DataModel."},
		}}
	end
	local action = command.action
	if not ({create = true, rename = true, duplicate = true, move = true, delete = true})[action] then
		return {type = "mutationResult", opId = command.opId, status = "error", results = {}}
	end
	local destination: Instance? = nil
	if action == "create" or action == "move" or (action == "duplicate" and command.destination ~= nil) then
		local metadata = command.destination
		if typeof(metadata) ~= "table" then
			return {type = "mutationResult", opId = command.opId, status = "error", results = {}}
		end
		destination = instances[metadata.id]
		local ok, reason = verifyParent(destination, metadata, instances, managed)
		if not ok then
			return {type = "mutationResult", opId = command.opId, status = "conflict", results = {{id = metadata.id, status = "conflict", message = reason}}}
		end
	end
	if (action == "create" or action == "rename") and not validName(command.name) then
		return {type = "mutationResult", opId = command.opId, status = "error", results = {}}
	end
 	if action == "delete" then
		-- A backup is only safe if every current Studio source matches the
		-- backed-up source snapshot before this command was queued.
		if typeof(command.protectedScripts) ~= "table" or #command.protectedScripts > 200 then
			return {type = "mutationResult", opId = command.opId, status = "error", results = {}}
		end
		for _, expected in command.protectedScripts do
			local target = instances[expected.id]
			local latest = if target then scriptSource(target) else nil
			if latest == nil or fingerprint(latest) ~= expected.fingerprint then
				return {type = "mutationResult", opId = command.opId, status = "conflict",
					results = {{ id = expected.id, status = "conflict", message = "Source changed since backup. Nothing was deleted." }} }
			end
		end
	end
	-- Verify the complete requested selection before changing anything. A single
	-- stale node must not accidentally cause a partial multi-delete or multi-move.
	if action ~= "create" then
		if typeof(command.targets) ~= "table" or #command.targets < 1 or #command.targets > 50 then
			return {type = "mutationResult", opId = command.opId, status = "error", results = {}}
		end
		for _, metadata in command.targets do
			local target = instances[metadata.id]
			local valid, reason = verifyTarget(target, metadata, managed)
			if valid and target then
				if target.Parent ~= instances[metadata.parentId] then
					valid, reason = false, "Instance moved in Studio."
				elseif action == "move" and destination and (destination == target or destination:IsDescendantOf(target)) then
					valid, reason = false, "Cannot move into a descendant."
				end
			end
			if not valid then
				return {type = "mutationResult", opId = command.opId, status = "conflict", results = {
					{id = metadata.id, status = "conflict", message = reason},
				}}
			end
		end
	end
	local historyId: string? = nil
	local began, historyResult = pcall(function()
		return ChangeHistoryService:TryBeginRecording("CursorBridge_" .. HttpService:GenerateGUID(false), "Cursor Bridge: " .. action)
	end)
	if began then historyId = historyResult end

	if action == "create" then
		if not ALLOWED_CLASSES[command.className] then
			table.insert(results, {id = command.destination.id, status = "error", message = "Creation class not allowed."})
		else
			local createdId = command.destination.id
			local ok, errorMessage = pcall(function()
				local created = Instance.new(command.className)
				created.Name = command.name
				-- Match Studio's Insert Object behavior: allow repeated sibling names
				-- and keep the new LuaSourceContainer's native source template.
				-- UpdateSourceAsync is not required for creating a fresh Script.
				created.Parent = destination
				createdId = idFor(created)
			end)
			table.insert(results, {id = createdId, status = if ok then "applied" else "error", message = if ok then "Created" else tostring(errorMessage)})
		end
	else
		local targets = command.targets
		if typeof(targets) == "table" and #targets <= 50 then
			for _, metadata in targets do
				local target = instances[metadata.id]
				local valid, reason = verifyTarget(target, metadata, managed)
				if valid and target and metadata.parentId ~= "game" then
					local expectedParent = instances[metadata.parentId]
					if target.Parent ~= expectedParent then
						valid, reason = false, "Instance moved in Studio."
					end
				end
				if valid and target and action == "move" then
					if destination == target or (destination and destination:IsDescendantOf(target)) then
						valid, reason = false, "Cannot move into a descendant."
					end
				end
				if not valid then
					table.insert(results, {id = metadata.id, status = "conflict", message = reason})
				elseif target then
					local affectedId = metadata.id
					local ok, message = pcall(function()
						if action == "rename" then
							target.Name = command.name
						elseif action == "delete" then
							target:Destroy()
						elseif action == "move" then
							target.Parent = destination
						elseif action == "duplicate" then
							local duplicated, copyError, copy = cloneWithCurrentSources(target, (destination or target.Parent) :: Instance)
							if not duplicated then error(copyError) end
							if copy then affectedId = idFor(copy) end
						end
					end)
					table.insert(results, {id = affectedId, status = if ok then "applied" else "error", message = if ok then "" else tostring(message)})
				end
			end
		end
	end

	if historyId then
		pcall(function()
			ChangeHistoryService:FinishRecording(historyId :: string, Enum.FinishRecordingOperation.Commit)
		end)
	end
	local succeeded = 0
	local conflicted = 0
	for _, result in results do
		if result.status == "applied" then succeeded += 1 end
		if result.status == "conflict" then conflicted += 1 end
	end
	local status = if succeeded == #results and succeeded > 0 then "applied"
		else (if succeeded > 0 then "partial" else (if conflicted > 0 then "conflict" else "error"))
	return {type = "mutationResult", opId = command.opId, status = status, results = results}
end

return HierarchyMutations
