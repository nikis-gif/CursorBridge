#!/usr/bin/env python3
"""Exercise marquee, clipboard, tabs and quick open in real headless Chromium.

Browser is fed the production renderer and a deterministic simulated Studio.
No claims are made about a live Roblox Studio session.
"""
from __future__ import annotations

from pathlib import Path
import os
import re
from playwright.sync_api import sync_playwright
from smoke import (PROJECT, FIXTURES, fixture_page, fixture_modules, IMPORTS,
                   MOUNT_APP, launch_options)


def launch_mock(page):
    source = (PROJECT / 'renderer/app.js').read_text(encoding='utf-8')
    bridge = (FIXTURES / 'bridge-mock.js').read_text(encoding='utf-8')
    bridge = bridge.replace('new URLSearchParams(location.search).has(\'offline\')', 'false')
    page.set_content(fixture_page(),wait_until='domcontentloaded')
    page.evaluate(bridge)
    page.evaluate("""Object.defineProperty(window,'localStorage',{
      configurable:true,value:{getItem:()=>null,setItem:()=>{}}
    })""")
    page.evaluate(MOUNT_APP,[fixture_modules(),source,IMPORTS])
    page.wait_for_selector('.tree-row[data-id="s1"]')


def test_workbench(page):
    # A click must immediately open a script and create a real tab.
    page.locator('.tree-row[data-id="s1"] .tree-name').click()
    page.locator('.tree-row[data-id="s3"] .tree-name').click()
    tabs = page.locator('.tab[data-id]')
    assert tabs.count() == 2
    assert page.locator('.tab.active').get_attribute('data-id') == 's3'

    # Dragging a tab across other tabs must alter its order and preserve the editor.
    page.locator('.tab[data-id="s3"]').drag_to(page.locator('.tab[data-id="s1"]'))
    order = page.locator('.tab[data-id]').evaluate_all('(els)=>els.map((el)=>el.dataset.id)')
    assert order == ['s3','s1'], f'wrong dragged tab order: {order}'
    assert page.locator('.tab.active').get_attribute('data-id') == 's3'

    # Close and reopen without confusing identical sibling names.
    page.keyboard.press('Control+w')
    assert page.locator('.tab.active').get_attribute('data-id') == 's1'
    page.keyboard.press('Control+Shift+t')
    assert page.locator('.tab.active').get_attribute('data-id') == 's3'

    # Quick open is independent from the Explorer tree and supports hierarchy paths.
    page.keyboard.press('Control+p')
    assert page.locator('#quickOpenDialog').is_visible()
    page.locator('#quickOpenSearch').fill('Main')
    assert page.locator('.quick-result').count() == 2
    page.locator('.quick-result').first.click()
    assert page.locator('#quickOpenDialog').is_hidden()
    assert page.locator('.tab.active').get_attribute('data-id') in ('s1','s2')

    # Keyboard clipboard is an instance operation, not text sent to Monaco.
    page.locator('.tree-row[data-id="s1"] .tree-name').click()
    page.keyboard.press('Control+c')
    page.keyboard.press('Control+v')
    assert page.evaluate('window.__mutations.at(-1).action') == 'duplicate'
    assert page.evaluate('window.__mutations.at(-1).parentId') == 'ws'
    assert page.evaluate('window.__mutations.at(-1).ids') == ['s1']

    # Cut and Paste Into yields reparenting rather than destructive deletion.
    page.keyboard.press('Control+x')
    page.locator('.tree-row[data-id="folder"] .tree-name').click()
    page.keyboard.press('Control+Shift+v')
    assert page.evaluate('window.__mutations.at(-1).action') == 'move'
    assert page.evaluate('window.__mutations.at(-1).parentId') == 'folder'

    # Marquee begins in empty Explorer space, selects intersecting rows, and is neutral.
    scroller = page.locator('#treeScroller').bounding_box()
    s1 = page.locator('.tree-row[data-id="s1"]').bounding_box()
    s3 = page.locator('.tree-row[data-id="s3"]').bounding_box()
    start_x = scroller['x'] + scroller['width'] - 24
    start_y = min(scroller['y']+scroller['height']-45, max(s1['y'],s3['y'])+85)
    end_y = min(s1['y'], s3['y']) + 6
    page.mouse.move(start_x,start_y)
    page.mouse.down()
    page.mouse.move(start_x-110,end_y,steps=12)
    assert page.locator('#marquee').is_visible()
    page.mouse.up()
    assert page.locator('#marquee').is_hidden()
    assert page.locator('.tree-row.selected').count() >= 2

    # Dense places still expose an empty marquee gutter even with no blank rows.
    extra_nodes = [dict(id=f'ext-{index}', name=f'System{index:03d}',
                        className='Folder', parentId='ws', isScript=False,
                        siblingOrder=index+10)
                   for index in range(110)]
    page.evaluate('nodes => window.__emitServer({type:"batch",events:nodes.map(node=>({type:"upsert",node}))})',extra_nodes)
    page.wait_for_function('document.querySelectorAll(".tree-row").length > 100')
    page.locator('#treeScroller').evaluate('(element)=>element.scrollTop=0')
    view = page.locator('#treeScroller').bounding_box()
    gutter_x = view['x'] + view['width'] - 12
    start_y = view['y'] + 125
    page.mouse.move(gutter_x,start_y)
    page.mouse.down()
    page.mouse.move(gutter_x-110,start_y+130,steps=12)
    assert page.locator('#marquee').is_visible()
    page.mouse.up()
    assert page.locator('.tree-row.selected').count() >= 4

    # Independent code styling and font settings must apply without crashing.
    page.locator('#themeToggle').click()
    page.locator('#fontSizeSetting').fill('16')
    page.locator('#fontSizeSetting').dispatch_event('change')
    page.locator('#wordWrapSetting').check()
    page.locator('#codeThemeSetting').select_option('aurora')
    assert page.locator('#themePanel').is_visible()
    page.locator('#themeToggle').click()


def main():
    with sync_playwright() as playwright:
        browser=playwright.chromium.launch(**launch_options())
        try:
            page=browser.new_page(viewport={'width':1440,'height':870})
            errors=[]
            page.on('pageerror',lambda error: errors.append(str(error)))
            launch_mock(page)
            test_workbench(page)
            assert not errors, 'Renderer exceptions: ' + str(errors)
            if os.getenv('CURSOR_BRIDGE_CAPTURE_UI') == '1':
                output = PROJECT / 'test-results' / 'workbench-preview.png'
                output.parent.mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(output), full_page=True)
            print('PASS professional workbench: drag tabs, quick open, clipboard, marquee, themes')
        finally:
            browser.close()


if __name__ == '__main__':
    main()
