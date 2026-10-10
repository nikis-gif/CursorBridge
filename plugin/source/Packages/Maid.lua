--!strict

export type Task = RBXScriptConnection | Instance | (() -> ())

local Maid = {}
Maid.__index = Maid

export type Maid = typeof(setmetatable({
	_tasks = {} :: {Task},
}, Maid))

function Maid.new(): Maid
	return setmetatable({
		_tasks = {},
	}, Maid)
end

function Maid.Give(self: Maid, task: Task): Task
	table.insert(self._tasks, task)
	return task
end

function Maid.Cleanup(self: Maid)
	for index = #self._tasks, 1, -1 do
		local task = self._tasks[index]
		self._tasks[index] = nil

		if typeof(task) == "RBXScriptConnection" then
			(task :: RBXScriptConnection):Disconnect()
		elseif typeof(task) == "Instance" then
			(task :: Instance):Destroy()
		else
			(task :: () -> ())()
		end
	end
end

function Maid.Destroy(self: Maid)
	self:Cleanup()
end

return Maid
