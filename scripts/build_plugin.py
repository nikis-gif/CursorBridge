#!/usr/bin/env python3
"""Build and validate the local Roblox Studio plugin in Roblox XML format."""

from __future__ import annotations

import copy
import sys
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "plugin" / "source"
TEMPLATES = ROOT / "plugin" / "templates" / "templates.xml"
OUTPUT = ROOT / "CursorBridgeV2.rbxmx"

# Studio-written templates reference the empty shared-string value for Tags,
# ModelMeshData and SlimHash. Every such reference must have a matching entry
# in the root SharedStrings table, or Studio may reject the entire model.
EMPTY_SHARED_STRING_KEY = "yuZpQdnvvUBOTYh1jqZ2cA=="
SHARED_STRING_CONTENTS = {EMPTY_SHARED_STRING_KEY: ""}

MODULE_GROUPS = {
    "Packages": ("Maid",),
    "UI": ("Theme", "Primitives", "CursorShell", "BridgeWindow"),
    "Services": ("StudioBridge", "HierarchyMutations", "QuickApply"),
    "Controllers": ("BridgeController",),
    "Core": (
        "CommandService", "ShortcutService", "SettingsService",
        "NotificationService", "ThemeService", "Logger",
    ),
    "Config": ("Defaults",),
}


def set_property(item: ET.Element, name: str, value: str) -> None:
    properties = item.find("Properties")
    if properties is None:
        raise ValueError(f'Missing Properties for {item.get("class")}')
    for prop in properties:
        if prop.get("name") == name:
            prop.text = value
            return
    raise ValueError(f'Missing expected property {name} for {item.get("class")}')


def build_item(templates: dict[str, ET.Element], item_type: str, name: str, source: str | None = None) -> ET.Element:
    item = copy.deepcopy(templates[item_type])
    item.attrib.pop("template", None)
    item.set("referent", f"RBX{uuid.uuid4().hex.upper()}")
    set_property(item, "Name", name)
    if item_type in ("Script", "ModuleScript"):
        set_property(item, "ScriptGuid", "{" + str(uuid.uuid4()).upper() + "}")
    if source is not None:
        set_property(item, "Source", source)
    return item


def add_shared_strings(root: ET.Element) -> None:
    references = {
        (prop.text or "").strip()
        for prop in root.findall(".//Properties/SharedString")
    }
    unknown = references - SHARED_STRING_CONTENTS.keys()
    if unknown:
        raise ValueError("Missing shared-string payloads: " + ", ".join(sorted(unknown)))

    table = ET.SubElement(root, "SharedStrings")
    for reference in sorted(references):
        ET.SubElement(table, "SharedString", md5=reference).text = SHARED_STRING_CONTENTS[reference]


def validate_plugin(root: ET.Element, expected_sources: dict[str, str] | None = None) -> None:
    if root.tag != "roblox" or root.get("version") != "4":
        raise ValueError("Invalid Roblox XML document root or version")

    models = root.findall("Item")
    if len(models) != 1 or models[0].get("class") != "Model":
        raise ValueError("Expected one root Model containing the plugin")

    instances = root.findall(".//Item")
    referents = [item.get("referent") for item in instances]
    if any(not ref or ref == "null" for ref in referents) or len(referents) != len(set(referents)):
        raise ValueError("Duplicate, empty, or reserved instance referent")

    tables = root.findall("SharedStrings")
    if len(tables) != 1:
        raise ValueError("Expected exactly one root SharedStrings table")
    definitions = [entry.get("md5") for entry in tables[0].findall("SharedString")]
    if any(not key for key in definitions) or len(definitions) != len(set(definitions)):
        raise ValueError("Duplicate or empty shared-string definition")
    references = [
        (prop.text or "").strip()
        for prop in root.findall(".//Properties/SharedString")
    ]
    if not set(references).issubset(definitions):
        raise ValueError("Unresolved shared-string property reference")

    actual_sources = {}
    guids = []
    for item in instances:
        props = item.find("Properties")
        if props is None:
            raise ValueError("Item is missing its Properties element")
        if item.get("class") in ("Script", "ModuleScript"):
            name = props.findtext("string[@name='Name']")
            source = props.findtext("ProtectedString[@name='Source']")
            guid = props.findtext("string[@name='ScriptGuid']")
            if name is None or source is None or guid is None:
                raise ValueError("Script is missing Name, Source or ScriptGuid")
            if name in actual_sources:
                raise ValueError("Duplicate script name in plugin")
            actual_sources[name] = source
            guids.append(guid)
    if len(guids) != len(set(guids)):
        raise ValueError("Duplicate ScriptGuid")
    if expected_sources is not None and actual_sources != expected_sources:
        raise ValueError("Script source mismatch after XML serialization")


def main() -> None:
    templates_tree = ET.parse(TEMPLATES)
    templates = {element.get("template"): element for element in templates_tree.getroot()}
    if set(templates) != {"Model", "Folder", "Script", "ModuleScript"}:
        raise ValueError("The Studio plugin templates are incomplete")

    root = ET.Element("roblox", {
        "xmlns:xmime": "http://www.w3.org/2005/05/xmlmime",
        "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
        "xsi:noNamespaceSchemaLocation": "http://www.roblox.com/roblox.xsd",
        "version": "4",
    })
    ET.SubElement(root, "Meta", name="ExplicitAutoJoints").text = "true"
    ET.SubElement(root, "External").text = "null"
    ET.SubElement(root, "External").text = "nil"

    source_files = {"Main": (SOURCE / "Main.lua").read_text(encoding="utf-8")}
    model = build_item(templates, "Model", "CursorBridgeV2")
    model.append(build_item(templates, "Script", "Main", source_files["Main"]))
    for group_name, names in MODULE_GROUPS.items():
        group = build_item(templates, "Folder", group_name)
        for name in names:
            source = (SOURCE / group_name / f"{name}.lua").read_text(encoding="utf-8")
            source_files[name] = source
            group.append(build_item(templates, "ModuleScript", name, source))
        model.append(group)
    root.append(model)
    add_shared_strings(root)
    validate_plugin(root, source_files)

    ET.indent(root, space="  ")
    # Some Roblox XML model readers require explicit open/close tags for
    # empty Content and SharedString elements rather than self-closing tags.
    ET.ElementTree(root).write(OUTPUT, encoding="utf-8", xml_declaration=True, short_empty_elements=False)
    serialized_root = ET.parse(OUTPUT).getroot()
    validate_plugin(serialized_root, source_files)
    print(f"Built and verified: {OUTPUT} ({OUTPUT.stat().st_size:,} bytes)")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        sys.exit(f"Plugin build error: {error}")
