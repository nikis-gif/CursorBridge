--!strict

-- Shared settings contract used by the other Cursor V2 plugins.
local Defaults = {
	Version = 2,
	Appearance = {
		Theme = "Discord",
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
		Version = "0.3.0",
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
	PollInterval = 0.18, -- Legacy plugin compatibility.
	ActivePollInterval = 0.55,
	IdlePollInterval = 1.5,
	SourceAuditInterval = 5.0,
	SourceAuditCount = 4,
	InitialRetryDelay = 2.0,
	MaximumRetryDelay = 30.0,
	ScanSliceSize = 96,
	MaxAutomaticNodes = 8000,
	MaxAutomaticSiblings = 800,
	ChildrenPageSize = 150,
	MaxQueuedScanOperations = 900,
	MaxSourcesPerCycle = 10,
	ScanProgressInterval = 1.5,
	MaxBatchBytes = 700 * 1024,
	MaxScriptBytes = 2 * 1024 * 1024,
	MaxQuickApplyBytes = 16 * 1024 * 1024,
	MaxQuickApplyScripts = 128,
	MaxTransferBytes = 64 * 1024 * 1024,
	ChunkBytes = 64 * 1024,
	ProtocolVersion = 2,
	MaxOperationsPerBatch = 350,
	MaxPendingOperations = 30000,
	MaxNodes = 250000,
	MaxNetworkFailures = 10,
}

return table.freeze(Defaults)
