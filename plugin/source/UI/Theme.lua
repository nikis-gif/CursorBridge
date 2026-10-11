--!strict

-- Cursor V2 semantic design tokens.
-- Every plugin consumes this exact contract so visual behavior stays consistent.
local Theme: {[string]: any} = {}

local BASE: {[string]: Color3} = {
	Background = Color3.fromRGB(9, 10, 12),
	Surface = Color3.fromRGB(14, 15, 18),
	SurfaceRaised = Color3.fromRGB(19, 20, 24),
	SurfaceHover = Color3.fromRGB(25, 27, 32),
	SurfaceActive = Color3.fromRGB(31, 33, 39),
	SurfaceSelected = Color3.fromRGB(37, 40, 47),
	SurfaceDisabled = Color3.fromRGB(18, 19, 22),
	Overlay = Color3.fromRGB(7, 8, 10),
	GradientTop = Color3.fromRGB(22, 23, 27),
	GradientBottom = Color3.fromRGB(16, 17, 20),
	Border = Color3.fromRGB(53, 56, 64),
	BorderSoft = Color3.fromRGB(35, 38, 44),
	BorderStrong = Color3.fromRGB(77, 81, 91),
	Text = Color3.fromRGB(242, 243, 245),
	TextMuted = Color3.fromRGB(165, 169, 178),
	TextFaint = Color3.fromRGB(104, 109, 120),
	TextDisabled = Color3.fromRGB(73, 77, 86),
	Focus = Color3.fromRGB(228, 231, 237),
	Accent = Color3.fromRGB(235, 237, 241),
	AccentHover = Color3.fromRGB(255, 255, 255),
	AccentSoft = Color3.fromRGB(49, 52, 60),
	AccentFaint = Color3.fromRGB(28, 30, 35),
	AccentText = Color3.fromRGB(12, 13, 16),
	Secondary = Color3.fromRGB(146, 151, 162),
	SecondarySoft = Color3.fromRGB(40, 43, 50),
	Ring = Color3.fromRGB(225, 228, 234),
	Success = Color3.fromRGB(101, 189, 132),
	Danger = Color3.fromRGB(224, 102, 112),
	Warning = Color3.fromRGB(219, 169, 85),
	Timeline = Color3.fromRGB(10, 11, 13),
	TimelineGrid = Color3.fromRGB(31, 34, 39),
	TimelineGridStrong = Color3.fromRGB(53, 57, 65),
	TimelineRow = Color3.fromRGB(17, 18, 21),
	TimelineRowAlt = Color3.fromRGB(14, 15, 18),
	Keyframe = Color3.fromRGB(218, 221, 227),
	KeyframeSelected = Color3.fromRGB(255, 255, 255),
	Playhead = Color3.fromRGB(238, 240, 244),
	Hover = Color3.fromRGB(25, 27, 32),
	Selection = Color3.fromRGB(67, 71, 82),
	AxisX = Color3.fromRGB(224, 84, 90),
	AxisY = Color3.fromRGB(87, 183, 116),
	AxisZ = Color3.fromRGB(85, 128, 216),
	EaseLinear = Color3.fromRGB(222, 224, 228),
	EaseConstant = Color3.fromRGB(128, 130, 136),
	EaseSine = Color3.fromRGB(120, 158, 190),
	EaseQuad = Color3.fromRGB(183, 158, 112),
	EaseCubic = Color3.fromRGB(194, 135, 103),
	EaseQuart = Color3.fromRGB(150, 130, 170),
	EaseQuint = Color3.fromRGB(177, 124, 151),
	EaseExponential = Color3.fromRGB(192, 108, 99),
	EaseCircular = Color3.fromRGB(105, 164, 153),
	EaseBack = Color3.fromRGB(132, 117, 175),
	EaseBounce = Color3.fromRGB(135, 164, 107),
	EaseElastic = Color3.fromRGB(105, 162, 176),
}

local PRESETS: {[string]: {[string]: Color3}} = {
	Cursor = {
		Background = Color3.fromRGB(30, 31, 34),
		Surface = Color3.fromRGB(49, 51, 56),
		SurfaceRaised = Color3.fromRGB(43, 45, 49),
		SurfaceHover = Color3.fromRGB(64, 66, 73),
		SurfaceActive = Color3.fromRGB(56, 58, 64),
		SurfaceSelected = Color3.fromRGB(63, 65, 71),
		SurfaceDisabled = Color3.fromRGB(38, 40, 44),
		Overlay = Color3.fromRGB(23, 24, 27),
		GradientTop = Color3.fromRGB(54, 57, 66),
		GradientBottom = Color3.fromRGB(43, 45, 49),
		Border = Color3.fromRGB(67, 69, 76),
		BorderSoft = Color3.fromRGB(57, 59, 65),
		BorderStrong = Color3.fromRGB(100, 104, 126),
		Text = Color3.fromRGB(242, 243, 245),
		TextMuted = Color3.fromRGB(181, 185, 194),
		TextFaint = Color3.fromRGB(148, 153, 163),
		TextDisabled = Color3.fromRGB(100, 104, 114),
		Focus = Color3.fromRGB(214, 217, 224),
		Accent = Color3.fromRGB(221, 223, 228),
		AccentHover = Color3.fromRGB(244, 245, 247),
		AccentSoft = Color3.fromRGB(63, 65, 71),
		AccentFaint = Color3.fromRGB(38, 40, 44),
		AccentText = Color3.fromRGB(20, 21, 24),
		Secondary = Color3.fromRGB(214, 217, 224),
		SecondarySoft = Color3.fromRGB(43, 45, 50),
		Success = Color3.fromRGB(105, 217, 176),
		Warning = Color3.fromRGB(232, 191, 128),
		Danger = Color3.fromRGB(242, 139, 151),
		Ring = Color3.fromRGB(214, 217, 224),
		Selection = Color3.fromRGB(63, 65, 71),
	},
	Graphite = {},
	Midnight = {
		Background = Color3.fromRGB(7, 10, 15),
		Surface = Color3.fromRGB(11, 15, 22),
		SurfaceRaised = Color3.fromRGB(16, 21, 30),
		SurfaceHover = Color3.fromRGB(22, 29, 40),
		SurfaceActive = Color3.fromRGB(29, 37, 51),
		SurfaceSelected = Color3.fromRGB(35, 45, 61),
		Border = Color3.fromRGB(48, 59, 77),
		BorderSoft = Color3.fromRGB(31, 39, 52),
		BorderStrong = Color3.fromRGB(72, 87, 112),
		Text = Color3.fromRGB(239, 243, 250),
		TextMuted = Color3.fromRGB(158, 170, 190),
		TextFaint = Color3.fromRGB(96, 110, 132),
		Accent = Color3.fromRGB(197, 216, 255),
		AccentHover = Color3.fromRGB(225, 235, 255),
		AccentSoft = Color3.fromRGB(43, 56, 78),
		AccentFaint = Color3.fromRGB(22, 30, 43),
		AccentText = Color3.fromRGB(11, 16, 24),
		Secondary = Color3.fromRGB(126, 151, 188),
		SecondarySoft = Color3.fromRGB(34, 46, 63),
		Ring = Color3.fromRGB(197, 216, 255),
		Timeline = Color3.fromRGB(8, 11, 16),
		TimelineGrid = Color3.fromRGB(26, 34, 46),
		TimelineGridStrong = Color3.fromRGB(46, 58, 76),
		TimelineRow = Color3.fromRGB(14, 19, 27),
		TimelineRowAlt = Color3.fromRGB(11, 15, 22),
		Playhead = Color3.fromRGB(207, 222, 255),
		Selection = Color3.fromRGB(58, 72, 96),
	},
	Obsidian = {
		Background = Color3.fromRGB(4, 4, 5),
		Surface = Color3.fromRGB(8, 8, 10),
		SurfaceRaised = Color3.fromRGB(13, 13, 16),
		SurfaceHover = Color3.fromRGB(20, 20, 24),
		SurfaceActive = Color3.fromRGB(27, 27, 32),
		SurfaceSelected = Color3.fromRGB(34, 34, 40),
		SurfaceDisabled = Color3.fromRGB(11, 11, 13),
		Overlay = Color3.fromRGB(2, 2, 3),
		Border = Color3.fromRGB(48, 48, 55),
		BorderSoft = Color3.fromRGB(28, 28, 33),
		BorderStrong = Color3.fromRGB(79, 79, 89),
		Text = Color3.fromRGB(248, 248, 249),
		TextMuted = Color3.fromRGB(176, 176, 183),
		TextFaint = Color3.fromRGB(105, 105, 115),
		Accent = Color3.fromRGB(250, 250, 251),
		AccentHover = Color3.fromRGB(255, 255, 255),
		AccentSoft = Color3.fromRGB(48, 48, 55),
		AccentFaint = Color3.fromRGB(22, 22, 26),
		AccentText = Color3.fromRGB(6, 6, 8),
		Secondary = Color3.fromRGB(145, 145, 153),
		SecondarySoft = Color3.fromRGB(37, 37, 43),
		Ring = Color3.fromRGB(245, 245, 247),
		Timeline = Color3.fromRGB(5, 5, 6),
		TimelineGrid = Color3.fromRGB(24, 24, 28),
		TimelineGridStrong = Color3.fromRGB(45, 45, 51),
		TimelineRow = Color3.fromRGB(11, 11, 13),
		TimelineRowAlt = Color3.fromRGB(8, 8, 10),
	},
	Monochrome = {
		Background = Color3.fromRGB(10, 10, 10),
		Surface = Color3.fromRGB(16, 16, 16),
		SurfaceRaised = Color3.fromRGB(22, 22, 22),
		SurfaceHover = Color3.fromRGB(30, 30, 30),
		SurfaceActive = Color3.fromRGB(38, 38, 38),
		SurfaceSelected = Color3.fromRGB(45, 45, 45),
		Border = Color3.fromRGB(58, 58, 58),
		BorderSoft = Color3.fromRGB(39, 39, 39),
		BorderStrong = Color3.fromRGB(86, 86, 86),
		Text = Color3.fromRGB(245, 245, 245),
		TextMuted = Color3.fromRGB(169, 169, 169),
		TextFaint = Color3.fromRGB(108, 108, 108),
		Accent = Color3.fromRGB(236, 236, 236),
		AccentHover = Color3.fromRGB(255, 255, 255),
		AccentSoft = Color3.fromRGB(53, 53, 53),
		AccentFaint = Color3.fromRGB(29, 29, 29),
		AccentText = Color3.fromRGB(12, 12, 12),
		Secondary = Color3.fromRGB(148, 148, 148),
		SecondarySoft = Color3.fromRGB(43, 43, 43),
		Ring = Color3.fromRGB(236, 236, 236),
	},
	Aurora = {
		Background = Color3.fromRGB(7, 10, 13),
		Surface = Color3.fromRGB(12, 16, 20),
		SurfaceRaised = Color3.fromRGB(18, 23, 29),
		SurfaceHover = Color3.fromRGB(24, 32, 39),
		SurfaceActive = Color3.fromRGB(31, 40, 49),
		SurfaceSelected = Color3.fromRGB(38, 49, 59),
		Border = Color3.fromRGB(47, 65, 74),
		BorderSoft = Color3.fromRGB(31, 44, 51),
		BorderStrong = Color3.fromRGB(66, 96, 105),
		Text = Color3.fromRGB(239, 247, 247),
		TextMuted = Color3.fromRGB(158, 181, 182),
		TextFaint = Color3.fromRGB(95, 120, 122),
		Accent = Color3.fromRGB(116, 232, 214),
		AccentHover = Color3.fromRGB(151, 245, 231),
		AccentSoft = Color3.fromRGB(35, 75, 73),
		AccentFaint = Color3.fromRGB(18, 39, 39),
		AccentText = Color3.fromRGB(7, 20, 20),
		Secondary = Color3.fromRGB(157, 132, 232),
		SecondarySoft = Color3.fromRGB(48, 40, 75),
		Ring = Color3.fromRGB(130, 236, 218),
		Playhead = Color3.fromRGB(130, 236, 218),
		Selection = Color3.fromRGB(40, 91, 87),
	},
	Rainbow = {
		-- The editor stays dark. Only semantic accents animate.
		Background = Color3.fromRGB(8, 9, 11),
		Surface = Color3.fromRGB(13, 14, 17),
		SurfaceRaised = Color3.fromRGB(19, 20, 24),
		SurfaceHover = Color3.fromRGB(26, 27, 32),
		SurfaceActive = Color3.fromRGB(33, 34, 40),
		SurfaceSelected = Color3.fromRGB(40, 41, 48),
		Border = Color3.fromRGB(55, 58, 66),
		BorderSoft = Color3.fromRGB(36, 38, 44),
		BorderStrong = Color3.fromRGB(82, 86, 96),
		Accent = Color3.fromRGB(255, 105, 135),
		AccentHover = Color3.fromRGB(255, 137, 163),
		AccentSoft = Color3.fromRGB(79, 39, 52),
		AccentFaint = Color3.fromRGB(41, 23, 29),
		AccentText = Color3.fromRGB(12, 13, 15),
		Secondary = Color3.fromRGB(102, 196, 236),
		SecondarySoft = Color3.fromRGB(34, 57, 68),
		Ring = Color3.fromRGB(255, 137, 163),
		Playhead = Color3.fromRGB(255, 105, 135),
		Selection = Color3.fromRGB(82, 43, 55),
		KeyframeSelected = Color3.fromRGB(255, 181, 91),
	},
}

local LEGACY_ALIASES = {
	-- Migrate the previous default only; retain other explicitly saved palettes.
	Discord = "Obsidian",
	Amethyst = "Aurora",
	Ember = "Obsidian",
}

Theme.PresetNames = table.freeze({"Obsidian", "Cursor", "Graphite", "Midnight", "Monochrome", "Aurora", "Rainbow"})
Theme.ActivePreset = "Obsidian"
Theme.ReduceMotion = false
Theme.AnimationsEnabled = true

Theme.RadiusSmall = 4
Theme.RadiusMedium = 6
Theme.RadiusLarge = 8
Theme.RadiusXLarge = 10
Theme.ControlHeight = 26
Theme.Spacing4 = 4
Theme.Spacing8 = 8
Theme.Spacing12 = 12
Theme.Spacing16 = 16
Theme.Spacing24 = 24
Theme.Spacing32 = 32
-- Compatibility tokens used by existing V1-derived layout code.
Theme.Spacing2 = 2
Theme.Spacing6 = 6
Theme.MotionFast = 0.10
Theme.MotionNormal = 0.16
Theme.MotionPanel = 0.20
Theme.LayerBase = 1
Theme.LayerFloating = 100
Theme.LayerMenu = 170
Theme.LayerTooltip = 500

local function refreshAliases()
	Theme.SurfaceSecondary = Theme.SurfaceRaised
	Theme.TextPrimary = Theme.Text
	Theme.TextSecondary = Theme.TextMuted
	Theme.AccentSecondary = Theme.Secondary
	Theme.Error = Theme.Danger
	Theme.Hover = Theme.SurfaceHover
	Theme.Selected = Theme.SurfaceSelected
	Theme.Disabled = Theme.SurfaceDisabled
end

function Theme.GetColorSnapshot(): {[string]: Color3}
	local snapshot: {[string]: Color3} = {}
	for key, value in Theme do
		if typeof(value) == "Color3" then
			snapshot[key] = value
		end
	end
	return snapshot
end

function Theme.GetActivePreset(): string
	return Theme.ActivePreset
end

function Theme.IsAnimatedPreset(name: string?): boolean
	return name == "Rainbow"
end

function Theme.ApplyRainbowHue(hue: number)
	if Theme.ActivePreset ~= "Rainbow" then
		return
	end

	local wrapped = hue % 1
	local accent = Color3.fromHSV(wrapped, 0.72, 1)
	local accentHover = Color3.fromHSV((wrapped + 0.025) % 1, 0.58, 1)
	local secondary = Color3.fromHSV((wrapped + 0.53) % 1, 0.52, 0.94)
	Theme.Accent = accent
	Theme.AccentHover = accentHover
	Theme.AccentSoft = accent:Lerp(Theme.SurfaceRaised, 0.70)
	Theme.AccentFaint = accent:Lerp(Theme.Background, 0.86)
	Theme.Focus = accent
	Theme.Ring = accentHover
	Theme.Secondary = secondary
	Theme.SecondarySoft = secondary:Lerp(Theme.SurfaceRaised, 0.76)
	Theme.Playhead = accent
	Theme.Selection = accent:Lerp(Theme.Surface, 0.58)
	Theme.KeyframeSelected = Color3.fromHSV((wrapped + 0.13) % 1, 0.62, 1)
	refreshAliases()
end

function Theme.ApplyPreset(name: string?): string
	local requested = name or "Obsidian"
	local presetName = LEGACY_ALIASES[requested] or requested
	if PRESETS[presetName] == nil then
		presetName = "Obsidian"
	end

	for key, value in BASE do
		Theme[key] = value
	end
	for key, value in PRESETS[presetName] do
		Theme[key] = value
	end
	Theme.ActivePreset = presetName
	refreshAliases()
	return presetName
end

Theme.ApplyPreset("Obsidian")

return Theme
