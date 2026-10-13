#!/usr/bin/env python3
"""Exercise the actual renderer DOM with a fake Studio bridge in Chromium.

Optional dependency: pip install playwright && python -m playwright install chromium
Run from anywhere: python tests/browser/smoke.py
"""
from __future__ import annotations

import os
import re
import shutil
from pathlib import Path

from playwright.sync_api import sync_playwright

PROJECT = Path(__file__).resolve().parents[2]
FIXTURES = Path(__file__).resolve().parent

def fixture_page():
    page = (PROJECT / "index.html").read_text(encoding="utf-8")
    page = re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]+>', "", page)
    page = page.replace('<script type="module" src="./renderer/app.js"></script>', "")
    css = "\n".join((PROJECT / f"renderer/{name}").read_text(encoding="utf-8")
                    for name in ("styles.css", "workspace.css"))
    return page.replace("</head>", f"<style>{css}</style></head>")


def fixture_modules():
    files = {
        "layout": PROJECT / "renderer/layout-state.mjs",
        "workspace": PROJECT / "renderer/workspace-ui.mjs",
        "tabgroups": PROJECT / "renderer/tab-groups.mjs",
        "monaco": FIXTURES / "mock-monaco.mjs",
        "worker": FIXTURES / "mock-worker.mjs",
        "icons": PROJECT / "renderer/icons.js",
        "completion": PROJECT / "renderer/luau-completion.mjs",
        "model": PROJECT / "renderer/explorer-model.mjs",
        "virtual": PROJECT / "renderer/virtual-window.mjs",
        "selection": PROJECT / "renderer/explorer-selection.mjs",
        "commands": PROJECT / "renderer/workbench-commands.mjs",
        "search": PROJECT / "renderer/place-search.mjs",
        "quickopen": PROJECT / "renderer/quick-open.mjs",
        "editorsync": PROJECT / "renderer/editor-sync.mjs",
        "searchworker": FIXTURES / "mock-search-worker.mjs",
    }
    modules = {name: path.read_text(encoding="utf-8") for name, path in files.items()}
    modules["limits"] = "export default " + (PROJECT / "shared/limits.json").read_text() + ";"
    return modules


IMPORTS = {
    "import { mountWorkspace } from './workspace-ui.mjs';": "workspace",
    "import { primaryTabIds } from './tab-groups.mjs';": "tabgroups",
    "import limits from '../shared/limits.json';": "limits",
    "import * as monaco from 'monaco-editor';": "monaco",
    "import EditorWorker from 'monaco-editor/editor/editor.worker?worker';": "worker",
    "import { icon } from './icons.js';": "icons",
    "import { findHierarchyCompletion, makeMonacoSuggestions } from './luau-completion.mjs';": "completion",
    "import { buildExplorerRows, uniqueRoots, isNodeInside, pathForNode } from './explorer-model.mjs';": "model",
    "import { calculateExplorerWindow } from './virtual-window.mjs';": "virtual",
    "import { selectOnPointer, selectOnSweep } from './explorer-selection.mjs';": "selection",
    "import { INSERT_GROUPS, moveTab, clipboardMutation } from './workbench-commands.mjs';": "commands",
    "import PlaceSearchWorker from './place-search.worker.mjs?worker';": "searchworker",
    "import { parseQuickOpenQuery, quickOpenMatches } from './quick-open.mjs';": "quickopen",
    "import { createDocumentState, recordLocalEdit, reconcileSource, canRestoreDraft } from './editor-sync.mjs';": "editorsync",
}


MOUNT_APP = """async ([modules, app, imports]) => {
  const blobs = {};
  for (const [key, source] of Object.entries(modules)) {
    blobs[key] = URL.createObjectURL(new Blob([source], {type:'text/javascript'}));
  }
  const workspace = modules.workspace.replace("from './layout-state.mjs'", "from '" + blobs.layout + "'");
  URL.revokeObjectURL(blobs.workspace);
  blobs.workspace = URL.createObjectURL(new Blob([workspace], {type:'text/javascript'}));
  // The selection module depends on the exact production Explorer model.
  const selection = modules.selection.replace(
    "from './explorer-model.mjs'", "from '" + blobs.model + "'");
  URL.revokeObjectURL(blobs.selection);
  blobs.selection = URL.createObjectURL(new Blob([selection], {type:'text/javascript'}));
  // The mock search worker runs the production pure search algorithm asynchronously.
  const searchworker = modules.searchworker.replace('__SEARCH_MODULE_URI__', blobs.search);
  URL.revokeObjectURL(blobs.searchworker);
  blobs.searchworker = URL.createObjectURL(new Blob([searchworker], {type:'text/javascript'}));
  for (const [snippet, key] of Object.entries(imports)) {
    if (!app.includes(snippet)) throw new Error('Missing renderer import: ' + snippet);
    app = app.replace(snippet, snippet.replace(/'[^']+';$/, "'" + blobs[key] + "';"));
  }
  app = app.replace("import './styles.css';", '').replace("import './workspace.css';", '');
  await import(URL.createObjectURL(new Blob([app], {type:'text/javascript'})));
}"""


def launch_options():
    override = os.environ.get("CURSOR_BRIDGE_CHROMIUM_PATH")
    candidate = override or shutil.which("chromium")
    return {"headless": True, "executable_path": candidate} if candidate else {"headless": True}


def assert_offline(page):
    assert page.locator("#explorerPane").is_hidden()
    assert page.locator(".tree-row").count() == 0
    assert page.locator("#codePanel").is_hidden()
    assert page.locator("#pairingCode").inner_text() == "432987"


def assert_online(page):
    page.wait_for_selector('.tree-row[data-id="s1"]')
    original_top = page.locator("#treeScroller").bounding_box()["y"]

    page.locator('.tree-row[data-id="s1"] .tree-name').click()
    assert page.locator("#codePanel").is_visible()
    assert page.locator(".tab.active .tab-label").inner_text() == "Main"

    page.locator('.tree-row[data-id="s2"] .tree-name').click(modifiers=["Control"])
    assert page.locator(".tree-row.selected").count() == 2
    assert page.locator("#explorerSummary").inner_text() == "2 selected"
    assert abs(page.locator("#treeScroller").bounding_box()["y"] - original_top) < 1

    page.locator('.tree-row[data-id="s3"] .tree-name').click(modifiers=["Shift"])
    assert page.locator(".tree-row.selected").count() == 2

    page.locator('.tree-row[data-id="ws"] .tree-name').click()
    for i in range(2):
        page.locator("#newNode").click()
        assert page.locator("#insertMenu").is_visible()
        page.locator("#insertMenu").get_by_text("Script", exact=True).click()
        assert page.evaluate("window.__mutations.length") == i + 1
    assert page.evaluate("window.__mutations[0].name") == "Script"
    assert page.evaluate("window.__mutations[1].name") == "Script"
    assert page.evaluate("window.__mutations[0].parentId") == "ws"

    page.evaluate("""() => {
      window.__emitServer({type:'mutation', opId:'mut-2', action:'create',
        status:'applied', results:[{id:'new-script-1', status:'applied'}]});
      window.__emitServer({type:'upsert', node:{id:'new-script-1', name:'Script',
        className:'Script', parentId:'ws', isScript:true, revision:1,
        source:'print(10)'}});
    }""")
    page.wait_for_timeout(100)
    assert page.locator(".tab.active .tab-label").inner_text() == "Script"

    page.evaluate("""() => window.__emitServer({type:'status', status:{
      connected:false, ready:false, pairingCode:'191919', placeName:'Sample Place',
      placeKey:'100-200'}})""")
    assert page.locator("#explorerPane").is_hidden()
    assert page.locator("#codePanel").is_hidden()
    assert page.locator("#welcome").is_visible()
    assert page.locator("#pairingCode").inner_text() == "191919"


def main():
    source = (PROJECT / "renderer/app.js").read_text(encoding="utf-8")
    bridge = (FIXTURES / "bridge-mock.js").read_text(encoding="utf-8").replace(
        "new URLSearchParams(location.search).has('offline')",
        "window.__offlineMode === true",
    )
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**launch_options())
        try:
            for offline in (True, False):
                page = browser.new_page(viewport={"width": 1280, "height": 800})
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                try:
                    page.set_content(fixture_page(), wait_until="domcontentloaded")
                    page.evaluate("window.__offlineMode = " + ("true" if offline else "false"))
                    page.evaluate(bridge)
                    # about:blank does not provide persistent storage in every Chromium build.
                    page.evaluate("""Object.defineProperty(window, 'localStorage', {
                      configurable:true, value:{getItem:()=>null, setItem:()=>{}}
                    })""")
                    page.evaluate(MOUNT_APP, [fixture_modules(), source, IMPORTS])
                    page.wait_for_timeout(150)
                    assert not errors, "Uncaught renderer errors: " + repr(errors)
                    (assert_offline if offline else assert_online)(page)
                    assert not errors, "Uncaught renderer errors: " + repr(errors)
                    print("PASS", "disconnected Explorer" if offline else "Explorer mouse and create actions")
                finally:
                    page.close()
        finally:
            browser.close()


if __name__ == "__main__":
    main()
