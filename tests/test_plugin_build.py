"""Regression tests for Roblox XML plugin serialization."""

import copy
import importlib.util
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("build_plugin", ROOT / "scripts" / "build_plugin.py")
build_plugin = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(build_plugin)


class PluginBuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        build_plugin.main()
        cls.root = ET.parse(build_plugin.OUTPUT).getroot()

    def test_plugin_is_valid(self):
        build_plugin.validate_plugin(self.root)

    def test_every_shared_string_reference_has_a_definition(self):
        references = {p.text for p in self.root.findall(".//Properties/SharedString")}
        definitions = {p.get("md5") for p in self.root.findall("./SharedStrings/SharedString")}
        self.assertTrue(references)
        self.assertEqual(references, definitions)

    def test_missing_shared_strings_are_rejected(self):
        broken = copy.deepcopy(self.root)
        broken.remove(broken.find("SharedStrings"))
        with self.assertRaisesRegex(ValueError, "SharedStrings"):
            build_plugin.validate_plugin(broken)

    def test_script_contents_are_preserved(self):
        for item in self.root.findall(".//Item"):
            if item.get("class") not in {"Script", "ModuleScript"}:
                continue
            props = item.find("Properties")
            name = props.findtext("string[@name='Name']")
            source = props.findtext("ProtectedString[@name='Source']")
            if name == "Main":
                expected_file = ROOT / "plugin/source/Main.lua"
            else:
                expected_file = next((ROOT / "plugin/source").glob(f"*/{name}.lua"))
            self.assertEqual(expected_file.read_text(encoding="utf-8"), source)

    def test_explicit_empty_tags_are_used(self):
        data = build_plugin.OUTPUT.read_text(encoding="utf-8")
        self.assertIn("<SharedStrings>", data)
        self.assertIn("<null></null>", data)
        self.assertNotIn("<null />", data)


if __name__ == "__main__":
    unittest.main()


class CursorV2CompatibilityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        build_plugin.main()
        cls.root = ET.parse(build_plugin.OUTPUT).getroot()

    def test_structural_actions_are_delivered_to_studio(self):
        studio = (build_plugin.SOURCE / 'Services/StudioBridge.lua').read_text(encoding='utf-8')
        actions = (build_plugin.SOURCE / 'Services/HierarchyMutations.lua').read_text(encoding='utf-8')
        self.assertIn('command.type == "mutate"', studio)
        self.assertIn('function HierarchyMutations.Execute(', actions)
        self.assertIn('ScriptEditorService:GetEditorSource', actions)
        self.assertIn('before this command was queued', actions)
        self.assertIn('ChangeHistoryService:TryBeginRecording', actions)
        self.assertIn('destination:IsDescendantOf(target)', actions)

    def test_reference_module_hierarchy_is_present(self):
        model = self.root.find('Item')
        groups = {
            item.find('Properties').findtext("string[@name='Name']"): {
                child.find('Properties').findtext("string[@name='Name']")
                for child in item.findall('Item')
            }
            for item in model.findall('Item') if item.get('class') == 'Folder'
        }
        self.assertEqual(set(groups), set(build_plugin.MODULE_GROUPS))
        for group, modules in build_plugin.MODULE_GROUPS.items():
            self.assertEqual(groups[group], set(modules))

    def test_plugin_uses_floating_core_gui_not_dock_widget(self):
        window = (build_plugin.SOURCE / 'UI/BridgeWindow.lua').read_text(encoding='utf-8')
        self.assertIn('game:GetService("CoreGui")', window)
        self.assertIn('make("ScreenGui"', window)
        self.assertIn('Primitives.Corner', window)
        self.assertIn('GetCloseRequestedSignal', window)
        self.assertIn('GetVisibilityChangedSignal', window)
        self.assertIn('UserInputService:GetMouseLocation()', window)
        self.assertIn('ResizeGrip', window)
        self.assertNotIn('DockWidget', window)
        self.assertNotIn('CreateDockWidget', window)

    def test_cursor_icon_matches_toolbar_and_window(self):
        for path in ('Main.lua', 'UI/BridgeWindow.lua'):
            source = (build_plugin.SOURCE / path).read_text(encoding='utf-8')
            self.assertIn('rbxassetid://132318313203288', source)

    def test_shared_cursor_modules_have_required_contracts(self):
        source = build_plugin.SOURCE
        self.assertIn('function CursorShell.new(', (source / 'UI/CursorShell.lua').read_text())
        self.assertIn('function Primitives.Button(', (source / 'UI/Primitives.lua').read_text())
        self.assertIn('function Theme.ApplyPreset(', (source / 'UI/Theme.lua').read_text())
        self.assertIn('SettingsService.new(', (source / 'Controllers/BridgeController.lua').read_text())
        self.assertIn('CursorShell.new(', (source / 'Controllers/BridgeController.lua').read_text())

    def test_visibility_and_lifecycle_are_wired(self):
        main = (build_plugin.SOURCE / 'Main.lua').read_text(encoding='utf-8')
        ctrl = (build_plugin.SOURCE / 'Controllers/BridgeController.lua').read_text(encoding='utf-8')
        self.assertIn('controller:GetVisibilityChangedSignal()', main)
        self.assertIn('pluginContext.Unloading:Connect(', main)
        self.assertIn('RunService:IsRunning()', main)
        self.assertIn('window:SetVisible(not window:IsVisible())', ctrl)
        self.assertIn('service:Destroy()', ctrl)
