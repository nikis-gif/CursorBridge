--!strict

-- Shared settings contract used by the other Cursor V2 plugins.
local Defaults = {
	Version = 2,
	Appearance = {
		Theme = "Obsidian",
		ReduceMotion = false,
		Animations = true,
		Density = "Comfortable",
	},
	Behavior = {
		ConfirmDestructiveActions = true,
		RestoreSession = true,
		ShowTooltips = true,
	},
	Product = {
		Name = "Cursor Bridge V2",
		Version = "0.2.6",
	},
	Advanced = {
		DebugLogging = false,
	},
	Session = {
		Favorites = {},
		RecentActions = {},
	},

	-- Bridge-specific transport settings. These keys are not user-editable.
	ServerURL = "http://127.0.0.1:38471",
	PollInterval = 0.18, -- Legacy setting retained for plugin compatibility.
	ActivePollInterval = 0.55,
	IdlePollInterval = 1.5,
	SourceAuditInterval = 2.0,
	InitialRetryDelay = 2.0,
	MaximumRetryDelay = 30.0,
	MaxBatchBytes = 700 * 1024,
	MaxScriptBytes = 256 * 1024,
	MaxOperationsPerBatch = 75,
	MaxPendingOperations = 30000,
	MaxNodes = 20000,
	MaxNetworkFailures = 10,
}

return table.freeze(Defaults)
