--!strict

local Defaults = require(script.Parent.Parent.Config.Defaults)
local PathResolver = {}

-- Resolve only the requested paths against Studio, not the partially paged mirror.
-- This function never creates an Instance or changes its source.
function PathResolver.Resolve(command: any, managed: (Instance) -> boolean,
	metadata: (Instance, boolean) -> any, observe: (Instance) -> (),
	canContinue: () -> boolean): any
	local result: any = {type = "resolvedPaths", opId = command.opId, nodes = {}, errors = {}}
	if typeof(command.paths) ~= "table" or #command.paths > Defaults.MaxQuickApplyScripts then
		error("Invalid path resolution request.")
	end
	local positions: {[string]: number} = {}
	local sourceBytes = 0
	local cache: {[Instance]: {[string]: {Instance}}} = {}
	local function matches(parent: Instance, name: string): {Instance}
		if not cache[parent] then cache[parent] = {} end
		if cache[parent][name] then return cache[parent][name] end
		local found: {Instance} = {}
		for index, child in parent:GetChildren() do
			if child.Name == name and child.Parent == parent then
				table.insert(found, child)
				if #found >= 2 then break end
			end
			if index % 512 == 0 then
				task.wait()
				if not canContinue() then error("Session changed during path resolution.") end
			end
		end
		cache[parent][name] = found
		return found
	end
	local function include(instance: Instance, withSource: boolean)
		observe(instance)
		local node = metadata(instance, withSource)
		local position = positions[node.id]
		if position then
			if withSource and result.nodes[position].source == nil then
				sourceBytes += #(node.source or "")
				result.nodes[position] = node
			end
		else
			sourceBytes += #(node.source or "")
			table.insert(result.nodes, node)
			positions[node.id] = #result.nodes
		end
		if sourceBytes > Defaults.MaxQuickApplyBytes then error("Existing destination sources exceed 16 MiB. Split the bundle.") end
	end
	for _, path in command.paths do
		if not canContinue() then error("Session changed during path resolution.") end
		if typeof(path.segments) ~= "table" or #path.segments < 2 or #path.segments > 30 then error("Invalid path segments.") end
		local okay, problem = pcall(function()
			local parent: Instance = game
			for index, component in path.segments do
				if typeof(component) ~= "string" or #component < 1 or #component > 400 then error("Invalid path component.") end
				local found = matches(parent, component)
				local leaf = index == #path.segments
				if #found == 0 then
					if index == 1 then error("Roblox service was not found: " .. component) end
					if path.status == "NEW" then break end
					error("MODIFIED destination was not found: " .. component .. ". Nothing was created.")
				end
				if #found > 1 and not (leaf and path.status == "NEW") then error("Ambiguous path: multiple instances named " .. component .. ".") end
				local target = found[1]
				if not managed(target) or target.Parent ~= parent then error("Path changed or is outside managed services.") end
				include(target, leaf and path.status == "MODIFIED")
				parent = target
			end
		end)
		if not okay then table.insert(result.errors, {index = path.index, message = tostring(problem)}) end
		task.wait()
	end
	return result
end
return PathResolver
