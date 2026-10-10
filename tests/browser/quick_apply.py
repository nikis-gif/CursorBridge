#!/usr/bin/env python3
"""Exercise the production Quick Apply UI against a deterministic bridge mock.

A browser test verifies events and interface behavior, not real Studio execution.
"""
from pathlib import Path
import os
from playwright.sync_api import sync_playwright
from smoke import PROJECT, FIXTURES, fixture_page, fixture_modules, IMPORTS, MOUNT_APP, launch_options

SEPARATOR = '=' * 50
BUNDLE = f'''{SEPARATOR}
SCRIPT: Main
PATH: game/Workspace/Main
STATUS: MODIFIED
{SEPARATOR}

--!strict
print("updated")

{SEPARATOR}
SCRIPT: MyModule
PATH: game/ServerScriptService/Systems/MyModule
STATUS: NEW
CLASS: ModuleScript
{SEPARATOR}

--!strict
return {{}}
'''

MOCK_API = r'''(() => {
  window.__quickCalls = [];
  window.cursorBridge.previewQuickApply = async (text, overrides) => {
    window.__quickCalls.push({kind:'preview',text,overrides});
    return {ok:true,token:'preview-token',placeName:'Sample Place',summary:{create:1,modify:1,unchanged:0,errors:0},errors:[],entries:[
      {index:0,name:'Main',path:'game/Workspace/Main',className:'Script',status:'MODIFIED',action:'modify',bytes:40,missingFolders:[]},
      {index:1,name:'MyModule',path:'game/ServerScriptService/Systems/MyModule',className:overrides[1]||'ModuleScript',
       status:'NEW',action:'create',bytes:28,missingFolders:['Systems'],duplicateName:false},
    ]};
  };
  window.cursorBridge.applyQuickApply = async token => {
    window.__quickCalls.push({kind:'apply',token});
    return {status:'queued',opId:'qa-1',count:2};
  };
})();'''


def main():
    source = (PROJECT/'renderer/app.js').read_text(encoding='utf-8')
    bridge = (FIXTURES/'bridge-mock.js').read_text(encoding='utf-8')
    bridge = bridge.replace("new URLSearchParams(location.search).has('offline')", 'false')
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**launch_options())
        try:
            page = browser.new_page(viewport={'width':1400,'height':900},device_scale_factor=1)
            errors = []
            page.on('pageerror', lambda error:errors.append(str(error)))
            page.on('dialog', lambda dialog: dialog.accept())
            page.set_content(fixture_page(),wait_until='domcontentloaded')
            page.evaluate(bridge)
            page.evaluate("""Object.defineProperty(window,'localStorage',{
              configurable:true,value:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}
            })""")
            page.evaluate(MOCK_API)
            page.evaluate(MOUNT_APP,[fixture_modules(),source,IMPORTS])
            page.wait_for_selector('.tree-row[data-id="s1"]')
            # Shortcut must work without navigating away from Monaco/editor.
            page.locator('.tree-row[data-id="s1"] .tree-name').click()
            page.keyboard.press('Control+l')
            assert page.locator('#quickApplyDialog').is_visible()
            page.locator('#quickApplyText').fill(BUNDLE)
            page.wait_for_function('window.__quickCalls.some(item=>item.kind==="preview")')
            assert page.locator('.qa-entry').count() == 2
            assert page.locator('#quickApplyConfirm').is_enabled()
            assert '1' in page.locator('.qa-summary').inner_text()
            # Script class can be overridden without modifying the original TXT.
            page.locator('.qa-entry-type').select_option('LocalScript')
            page.wait_for_function('window.__quickCalls.some(item=>item.overrides?.[1]==="LocalScript")')
            assert page.locator('.qa-entry-type').input_value() == 'LocalScript'
            if os.getenv('CURSOR_BRIDGE_CAPTURE_UI') == '1':
                output = PROJECT / 'docs' / 'quick-apply-preview.png'
                page.screenshot(path=str(output))
            page.locator('#quickApplyConfirm').click()
            page.wait_for_function('window.__quickCalls.some(item=>item.kind==="apply")')
            assert page.evaluate('window.__quickCalls.at(-1).token')=='preview-token'
            assert page.locator('#quickApplyConfirm').is_disabled()
            page.evaluate("""() => window.__emitServer({type:'quickApply',status:'applied',opId:'qa-1',count:2})""")
            assert page.locator('#quickApplyText').input_value()==''
            assert 'confirmed' in page.locator('#quickApplySummary').inner_text()
            # The action never runs while disconnected; imported text remains visible.
            page.evaluate("""() => window.__emitServer({type:'status',status:{
              connected:false,ready:false,pairingCode:'555444',placeName:'No place'
            }})""")
            page.locator('#quickApplyText').fill(BUNDLE)
            page.wait_for_timeout(400)
            assert page.locator('#quickApplyConfirm').is_disabled()
            assert 'Connect to a Roblox Studio' in page.locator('#quickApplySummary').inner_text()
            assert not errors, 'Renderer errors: '+repr(errors)
            print('PASS Quick Apply UI: Ctrl+L, TXT preview, type override, apply ACK, offline safety')
        finally:
            browser.close()


if __name__ == '__main__':
    main()
