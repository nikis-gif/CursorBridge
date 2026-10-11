#!/usr/bin/env python3
"""Production UI with a simulated bridge: large TXT and async recovery races."""
from playwright.sync_api import sync_playwright
from smoke import PROJECT, FIXTURES, fixture_page, fixture_modules, IMPORTS, MOUNT_APP, launch_options


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(**launch_options())
        try:
            page = browser.new_page(viewport={"width": 1400, "height": 900})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.set_content(fixture_page())
            bridge = (FIXTURES/'bridge-mock.js').read_text().replace("new URLSearchParams(location.search).has('offline')", 'false')
            page.evaluate(bridge)
            page.evaluate("""() => {
              Object.defineProperty(window,'localStorage',{configurable:true,value:{
                getItem:()=>null,setItem:()=>{throw Error('Quota exceeded');},removeItem:()=>{}}});
              window.__previews=[];
              window.cursorBridge.previewQuickApply=(text)=>new Promise(resolve=>window.__previews.push({text,resolve}));
            }""")
            page.evaluate(MOUNT_APP,[fixture_modules(),(PROJECT/'renderer/app.js').read_text(),IMPORTS])
            page.wait_for_selector('.tree-row')
            page.keyboard.press('Control+l')
            page.evaluate("""() => {const f=document.getElementById('quickApplyText');
              f.value='--!strict\\n'+'x'.repeat(6*1024*1024);f.dispatchEvent(new Event('input',{bubbles:true}));}""")
            page.wait_for_function('window.__previews.length===1')
            assert page.evaluate('window.__savedQuickApplyInput.length') > 6*1024*1024
            assert '16 MiB' in page.locator('#quickApplySize').inner_text()
            assert not page.locator('#quickApplyConfirm').is_enabled()
            page.evaluate("""() => window.__emitServer({type:'status',status:{connected:true,ready:true,
              placeKey:'100-200',placeName:'Sample Place',scanIndexed:999}})""")
            page.wait_for_timeout(400)
            assert page.evaluate('window.__previews.length') == 1
            page.locator('#quickApplyText').fill('newer text')
            page.evaluate("""() => window.__previews[0].resolve({ok:true,token:'stale',placeName:'Test',
              errors:[],entries:[],summary:{create:1,modify:0,unchanged:0,errors:0}})""")
            page.wait_for_timeout(100)
            assert not page.locator('#quickApplyConfirm').is_enabled()
            page.wait_for_function('window.__previews.length===2')
            page.evaluate("""() => window.__emitServer({type:'status',status:{connected:true,ready:false,
              recovering:true,placeKey:'100-200',placeName:'Sample Place'}})""")
            assert 'Reconnecting' in page.locator('#welcomeTitle').inner_text()
            assert page.locator('#explorerPane').is_hidden()
            assert page.locator('#quickApplyText').input_value() == 'newer text'
            count = page.evaluate('window.__previews.length')
            page.evaluate("""() => {const f=document.getElementById('quickApplyText');
              f.value='x'.repeat(16*1024*1024+1);f.dispatchEvent(new Event('input',{bubbles:true}));}""")
            page.wait_for_function("document.getElementById('quickApplySummary').innerText.includes('exceeds 16 MiB')", timeout=10000)
            assert page.evaluate('window.__previews.length') == count
            page.evaluate("""() => window.__emitServer({type:'status',status:{connected:true,ready:true,
              protocolVersion:1,placeKey:'100-200',placeName:'Sample Place'}})""")
            assert 'Update your Studio plugin' in page.locator('#welcomeTitle').inner_text()
            assert page.locator('#explorerPane').is_hidden()
            assert not errors, errors
            print('PASS 6 MiB TXT with full localStorage, stale preview guard, quiet progress, recovery, 16 MiB boundary')
        finally:
            browser.close()


if __name__ == '__main__':
    main()
