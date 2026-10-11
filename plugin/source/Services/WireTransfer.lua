--!strict

local HttpService = game:GetService("HttpService")
local Defaults = require(script.Parent.Parent.Config.Defaults)
local WireTransfer = {}

local function checksum(text: string): number
	local a, b = 1, 0
	for start = 1, #text, 5552 do
		for index = start, math.min(start + 5551, #text) do
			a += string.byte(text, index)
			b += a
		end
		a %= 65521
		b %= 65521
	end
	return b * 65536 + a
end

function WireTransfer.Encode(value: any): {any}
	local body = HttpService:JSONEncode(value)
	if #body > Defaults.MaxTransferBytes then error("Encoded operation exceeds 64 MiB. Split the bundle.") end
	local parts: {string} = {}
	local start = 1
	while start <= #body do
		local finish = math.min(start + Defaults.ChunkBytes - 1, #body)
		while finish < #body do
			local byte = string.byte(body, finish + 1)
			if byte < 128 or byte >= 192 then break end
			finish -= 1
		end
		table.insert(parts, string.sub(body, start, finish))
		start = finish + 1
	end
	local id = HttpService:GenerateGUID(false)
	local digest = checksum(body)
	local chunks = {}
	for index, data in parts do
		table.insert(chunks, {type = "wireChunk", id = id, index = index - 1,
			count = #parts, bytes = #body, checksum = digest, data = data})
	end
	return chunks
end

function WireTransfer.NewReceiver(): any
	return {active = nil, completed = {}}
end

function WireTransfer.Accept(receiver: any, chunk: any): (any?, number)
	if typeof(chunk.id) ~= "string" or #chunk.id < 1 or #chunk.id > 120
		or typeof(chunk.index) ~= "number" or chunk.index % 1 ~= 0 or chunk.index < 0
		or typeof(chunk.count) ~= "number" or chunk.count % 1 ~= 0 or chunk.count < 1 or chunk.count > 2048
		or chunk.index >= chunk.count or typeof(chunk.bytes) ~= "number" or chunk.bytes % 1 ~= 0
		or chunk.bytes < 1 or chunk.bytes > Defaults.MaxTransferBytes
		or typeof(chunk.data) ~= "string" or #chunk.data > Defaults.ChunkBytes
		or typeof(chunk.checksum) ~= "number" or chunk.checksum % 1 ~= 0
		or chunk.checksum < 0 or chunk.checksum > 4294967295 then error("Invalid command fragment.") end
	if receiver.completed[chunk.id] then return nil, receiver.completed[chunk.id] end
	-- The authenticated server may supersede an unfinished read-only preview.
	-- A new transfer can replace it only at fragment zero; no partial command runs.
	if receiver.active and receiver.active.id ~= chunk.id and chunk.index == 0 then
		receiver.active = nil
	end
	if not receiver.active then
		if chunk.index ~= 0 then error("Command transfer must start at zero.") end
		receiver.active = {id = chunk.id, count = chunk.count, bytes = chunk.bytes,
			checksum = chunk.checksum, parts = {}, received = 0}
	end
	local active = receiver.active
	if active.id ~= chunk.id or active.count ~= chunk.count or active.bytes ~= chunk.bytes
		or active.checksum ~= chunk.checksum then error("Command transfer identity changed.") end
	if chunk.index < #active.parts then
		if active.parts[chunk.index + 1] ~= chunk.data then error("Retried command fragment changed.") end
		return nil, #active.parts
	end
	if chunk.index ~= #active.parts then error("Out-of-order command fragment.") end
	active.received += #chunk.data
	if active.received > active.bytes then error("Command exceeds declared size.") end
	table.insert(active.parts, chunk.data)
	if #active.parts < active.count then return nil, #active.parts end
	local body = table.concat(active.parts)
	if #body ~= active.bytes or checksum(body) ~= active.checksum then error("Command checksum mismatch.") end
	local value = HttpService:JSONDecode(body)
	if typeof(value) ~= "table" or value.type == "wireChunk" then error("Invalid transferred command.") end
	receiver.active = nil
	receiver.completed[chunk.id] = chunk.count
	return value, chunk.count
end
return WireTransfer
