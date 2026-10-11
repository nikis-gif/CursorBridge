--!strict

local ChangeHistoryService = game:GetService("ChangeHistoryService")
local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")
local ScriptEditorService = game:GetService("ScriptEditorService")

local QuickApply = {}

local Defaults = require(script.Parent.Parent.Config.Defaults)
local MAX_ENTRIES = Defaults.MaxQuickApplyScripts
local MAX_SCRIPT_BYTES = Defaults.MaxScriptBytes
local ALLOWED_SCRIPT_CLASSES: {[string]: boolean} = {
	Script = true,
	LocalScript = true,
	ModuleScript = true,
}

type Entry = {
	index: number,
	action: string,
	name: string,
	className: string,
	source: string,
	scriptId: string?,
	expectedSource: string?,
	anchorId: string?,
	missingFolders: {string}?,
	guards: {{id: string, parentId: string, name: string, className: string}},
}

type ExistingChange = {scriptObject: LuaSourceContainer, oldSource: string, writtenSource: string}

local function sourceFor(instance: Instance): string?
	if not instance:IsA("LuaSourceContainer") then return nil end
	local succeeded, source = pcall(function()
		return ScriptEditorService:GetEditorSource(instance :: LuaSourceContainer)
	end)
	if succeeded and typeof(source) == "string" then return source end
	return nil
end

local function validName(value: any): boolean
	return typeof(value) == "string" and #value >= 1 and #value <= 100
		and string.match(value, "%S") ~= nil and string.match(value, "[%c/]") == nil
end

local function writeSource(target: LuaSourceContainer, source: string, expected: string,
	canContinue: (() -> boolean)?): (boolean, boolean)
	local didApply = false
	local succeeded = pcall(function()
		ScriptEditorService:UpdateSourceAsync(target, function(current: string): string?
			if current ~= expected or (canContinue and not canContinue()) then return nil end
			didApply = true
			return source
		end)
	end)
	return succeeded and didApply and sourceFor(target) == source, didApply
end

local function findMatchingChild(parent: Instance, name: string): (Instance?, number)
	local found: Instance? = nil
	local count = 0
	for _, child in parent:GetChildren() do
		if child.Name == name then
			count += 1
			found = child
		end
	end
	return found, count
end

local function verifyGuards(guards: any, instances: {[string]: Instance}, managed: (Instance) -> boolean): boolean
	if typeof(guards) ~= "table" or #guards < 1 or #guards > 30 then return false end
	for _, meta in guards do
		if typeof(meta) ~= "table" or typeof(meta.id) ~= "string" then return false end
		local target = instances[meta.id]
		if not target or not managed(target) or target.Name ~= meta.name or target.ClassName ~= meta.className then
			return false
		end
		if meta.parentId == "game" then
			if target.Parent ~= game then return false end
		elseif target.Parent ~= instances[meta.parentId] then
			return false
		end
		if not target.Parent then return false end
		local unique, count = findMatchingChild(target.Parent, target.Name)
		if count ~= 1 or unique ~= target then return false end
	end
	return true
end

local function preflight(entries: {Entry}, instances: {[string]: Instance}, managed: (Instance) -> boolean): (boolean, string)
	if RunService:IsRunning() then return false, "Stop Play Test before applying scripts." end
	if #entries < 1 or #entries > MAX_ENTRIES then return false, "Invalid script count." end
	for _, entry in entries do
		if not ALLOWED_SCRIPT_CLASSES[entry.className] or not validName(entry.name)
			or typeof(entry.source) ~= "string" or #entry.source > MAX_SCRIPT_BYTES
			or string.sub(entry.source, 1, 9) ~= "--!strict" then
			return false, "Invalid script type, name, or source."
		end
		if not verifyGuards(entry.guards, instances, managed) then
			return false, "A hierarchy path changed in Studio. No scripts were applied."
		end
		if entry.action == "modify" then
			local target = if entry.scriptId then instances[entry.scriptId] else nil
			if not target or target.ClassName ~= entry.className or target.Name ~= entry.name then
				return false, "The modification destination changed."
			end
			if typeof(entry.expectedSource) ~= "string" or sourceFor(target) ~= entry.expectedSource then
				return false, "Studio source changed since the preview. Nothing was applied."
			end
		elseif entry.action == "create" then
			local anchor = if entry.anchorId then instances[entry.anchorId] else nil
			if not anchor or anchor ~= instances[entry.guards[#entry.guards].id] then
				return false, "The creation destination changed."
			end
			if typeof(entry.missingFolders) ~= "table" or #entry.missingFolders > 28 then
				return false, "Invalid folder path."
			end
			local parent = anchor
			for _, name in entry.missingFolders do
				if not validName(name) then return false, "Invalid folder name." end
				local child, matches = findMatchingChild(parent, name)
				if matches ~= 0 then
					return false, "A missing folder appeared after preview. Review the bundle again."
				end
				-- A later segment cannot be checked until the missing parent is created.
				break
			end
		else
			return false, "Invalid Quick Apply action."
		end
	end
	return true, ""
end

function QuickApply.Execute(command: any, instances: {[string]: Instance}, managed: (Instance) -> boolean,
	idFor: (Instance) -> string, canContinue: () -> boolean): any
	local entries = command.entries :: {Entry}
	local result = {type = "quickApplyResult", opId = command.opId, status = "error", results = {}}
	if typeof(entries) ~= "table" then
		table.insert(result.results, {index = -1, status = "error", message = "Invalid bundle."})
		return result
	end
	local valid, reason = preflight(entries, instances, managed)
	if not valid then
		result.status = "conflict"
		table.insert(result.results, {index = -1, status = "conflict", message = reason})
		return result
	end
	local began, recording = pcall(function()
		return ChangeHistoryService:TryBeginRecording("CursorBridge_QuickApply_" .. HttpService:GenerateGUID(false), "Cursor Bridge: Quick Apply")
	end)
	if not began or typeof(recording) ~= "string" then
		table.insert(result.results, {index = -1, status = "error", message = "Studio could not start undo recording."})
		return result
	end

	local created: {Instance} = {}
	local updated: {ExistingChange} = {}
	local appliedResults = {}
	local succeeded, failure = pcall(function()
		for _, entry in entries do
			if not canContinue() or not verifyGuards(entry.guards, instances, managed) then
				error("The Studio session or destination changed during Quick Apply.")
			end
			if entry.action == "modify" then
				local target = instances[entry.scriptId :: string] :: LuaSourceContainer
				local original = entry.expectedSource :: string
				local wrote, attempted = writeSource(target, entry.source, original, function(): boolean
					return canContinue() and verifyGuards(entry.guards, instances, managed)
				end)
				if attempted then
					table.insert(updated, {scriptObject = target, oldSource = original, writtenSource = entry.source})
				end
				if not wrote then
					error("Studio refused to update " .. entry.name .. ".")
				end
			else
				local parent = instances[entry.anchorId :: string]
				for _, folderName in (entry.missingFolders :: {string}) do
					if not canContinue() then error("Studio disconnected while creating folders.") end
					local child, matches = findMatchingChild(parent, folderName)
					if matches == 0 then
						local folder = Instance.new("Folder")
						folder.Name = folderName
						folder.Parent = parent
						table.insert(created, folder)
						idFor(folder)
						parent = folder
					elseif matches == 1 and child and child:IsA("Folder") then
						parent = child
					else
						error("Destination folder became ambiguous while applying scripts.")
					end
				end
				local object = Instance.new(entry.className) :: LuaSourceContainer
				object.Name = entry.name
				object.Parent = parent
				table.insert(created, object)
				idFor(object)
				local original = sourceFor(object)
				if original == nil or (original ~= entry.source and not writeSource(object, entry.source, original, canContinue)) then
					error("Studio refused to initialize " .. entry.name .. ".")
				end
			end
			table.insert(appliedResults, {index = entry.index, status = "applied", message = "Applied in Studio."})
		end
	end)

	if succeeded and not canContinue() then
		succeeded = false
		failure = "The Studio session ended before committing the changes."
	end
	if succeeded then
		local finished = pcall(function()
			ChangeHistoryService:FinishRecording(recording :: string, Enum.FinishRecordingOperation.Commit)
		end)
		if finished then
			result.status = "applied"
			result.results = appliedResults
			return result
		end
		failure = "Studio could not commit undo history."
	end

	-- Preserve the previous editor sources even if an individual Studio write fails.
	-- Cancel the single undo recording after best-effort local cleanup.
	local rollbackOkay = true
	for index = #updated, 1, -1 do
		local change = updated[index]
		local current = sourceFor(change.scriptObject)
		if current == change.writtenSource then
			local restored = writeSource(change.scriptObject, change.oldSource, change.writtenSource)
			rollbackOkay = rollbackOkay and restored
		elseif current ~= change.oldSource then
			-- Do not overwrite a concurrent Studio edit while rolling back.
			rollbackOkay = false
		end
	end
	for index = #created, 1, -1 do
		local object = created[index]
		local deleted = pcall(function() object:Destroy() end)
		rollbackOkay = rollbackOkay and deleted
	end
	local canceled = pcall(function()
		ChangeHistoryService:FinishRecording(recording :: string, Enum.FinishRecordingOperation.Cancel)
	end)
	rollbackOkay = rollbackOkay and canceled
	result.status = if rollbackOkay then "rolled-back" else "partial"
	result.results = {{index = -1, status = result.status,
		message = if rollbackOkay then "Changes were rolled back: " .. tostring(failure)
			else "Rollback could not be verified. Inspect Studio and recovery backups: " .. tostring(failure)}}
	return result
end

return QuickApply
