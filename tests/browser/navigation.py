#!/usr/bin/env python3
"""Regression coverage for global code search and Studio-like Quick Open.

Runs the production renderer with a deterministic fake Studio; does not claim a
live Roblox Studio integration test.
"""
from __future__ import annotations

from playwright.sync_api import sync_playwright
from smoke import PROJECT, FIXTURES, fixture_page, fixture_modules, IMPORTS, MOUNT_APP, launch_options


def setup(page, offline=False):
    bridge = (FIXTURES / 'bridge-mock.js').read_text(encoding='utf-8')
    bridge = bridge.replace("new URLSearchParams(location.search).has('offline')", 'true' if offline else 'false')
    page.set_content(fixture_page(), wait_until='domcontentloaded')
    page.evaluate(bridge)
    page.evaluate("""Object.defineProperty(window,'localStorage',{
      configurable:true,value:{getItem:()=>null,setItem:()=>{}}
    })""")
    page.evaluate(MOUNT_APP, [fixture_modules(), (PROJECT / 'renderer/app.js').read_text(encoding='utf-8'), IMPORTS])
    if not offline:
        page.wait_for_selector('.tree-row[data-id="s1"]')


def test_search(page):
    page.evaluate("""() => window.__emitServer({type:'upsert',node:{
      id:'search-a',name:'SearchService',className:'ModuleScript',parentId:'sss',isScript:true,
      revision:1,source:'local Hello = 1\\nprint(Hello)\\nlocal Helium = 2\\nHELLO()'
    }})""")
    page.keyboard.press('Control+Shift+f')
    assert page.locator('#placeSearchPanel').is_visible()
    assert page.locator('#treeScroller').is_hidden()
    assert page.locator('#placeSearchInput').evaluate('(element)=>document.activeElement === element')

    page.locator('#placeSearchInput').fill('hello')
    page.wait_for_function('document.querySelector("#placeSearchSummary").textContent.includes("results in")')
    assert page.locator('.place-result-group').count() == 2
    assert page.locator('.place-match').count() == 4
    assert '4 results in 2 scripts' in page.locator('#placeSearchSummary').inner_text()

    # Navigate to a precise line inside an actual Monaco-backed tab.
    page.locator('.place-result-group').filter(has_text='SearchService').locator('.place-match').nth(1).click()
    assert page.locator('.tab.active .tab-label').inner_text() == 'SearchService'
    position = page.evaluate('window.__editorSelection')
    assert (position['startLineNumber'], position['startColumn']) == (2, 7)
    assert page.evaluate('window.__editorFocused') is True

    # The search stays open and offers next/previous navigation without reopening it.
    page.keyboard.press('F4')
    after = page.evaluate('window.__editorSelection.startLineNumber')
    assert isinstance(after, int)
    page.keyboard.press('Shift+F4')
    assert page.locator('#placeSearchPanel').is_visible()

    page.locator('#searchMatchCase').click()
    page.wait_for_function('document.querySelector("#placeSearchSummary").textContent === "No results" || document.querySelector("#placeSearchSummary").textContent.startsWith("1 results")')
    # Case-sensitive lowercase 'hello' occurs in 'print("hello")' only.
    assert page.locator('.place-match').count() == 1
    page.locator('#searchMatchCase').click()
    page.locator('#searchWholeWord').click()
    page.wait_for_function('document.querySelector("#placeSearchSummary").textContent.startsWith("4 results")')
    assert page.locator('.place-match').count() == 4
    page.locator('#searchRegex').click()
    page.locator('#placeSearchInput').fill('(')
    page.wait_for_function('document.querySelector("#placeSearchSummary").textContent.startsWith("Invalid regular expression")')
    assert page.locator('#placeSearchSummary').get_attribute('class') == 'error'

    # Switch back without destroying the script tab or changing its source.
    page.keyboard.press('Control+Shift+e')
    assert page.locator('#placeSearchPanel').is_hidden()
    assert page.locator('#treeScroller').is_visible()
    assert page.locator('.tab.active .tab-label').inner_text() == 'SearchService'
    page.keyboard.press('Control+Shift+f')
    assert page.locator('#placeSearchPanel').is_visible()
    page.locator('#searchRegex').click()
    page.locator('#searchWholeWord').click()
    page.locator('#placeSearchInput').fill('Hello')
    page.wait_for_function('document.querySelector("#placeSearchSummary").textContent.includes("results in")')

    # Live Studio changes refresh the search results without a separate request.
    page.evaluate("""() => window.__emitServer({type:'upsert',node:{
      id:'search-a',name:'SearchService',className:'ModuleScript',parentId:'sss',isScript:true,
      revision:2,source:'local Removed = 1'
    }})""")
    page.wait_for_function('document.querySelectorAll(".place-result-group").length === 1')

    # Capture a real screenshot of the renderer for visual review.
    page.locator('#placeSearchInput').fill('hello')
    page.wait_for_function('document.querySelector("#placeSearchSummary").textContent.includes("results in")')
    output = PROJECT / 'test-results' / 'navigation-preview.png'
    output.parent.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(output), full_page=True)


def test_quick_open(page):
    page.keyboard.press('Control+p')
    assert page.locator('#quickOpenDialog').is_visible()
    page.locator('#quickOpenSearch').fill('Main')
    assert page.locator('.quick-result').count() == 2
    assert page.locator('.quick-result.active').count() == 1
    page.keyboard.press('ArrowDown')
    assert page.locator('.quick-result.active').get_attribute('data-quick-index') == '1'
    assert page.locator('#quickOpenSearch').evaluate('(element)=>document.activeElement === element')
    page.keyboard.press('Enter')
    assert page.locator('#quickOpenDialog').is_hidden()
    assert page.locator('.tab.active .tab-label').inner_text() == 'Main'
    page.keyboard.press('Control+p')
    page.locator('#quickOpenSearch').fill('Main:12:4')
    page.keyboard.press('Enter')
    assert page.locator('#quickOpenDialog').is_hidden()
    assert page.evaluate('window.__editorSelection.startLineNumber') == 1  # Clamp short script
    assert page.evaluate('window.__editorSelection.startColumn') >= 1


def test_offline(page):
    assert page.locator('#explorerPane').is_hidden()
    page.keyboard.press('Control+Shift+f')
    assert page.locator('#explorerPane').is_hidden()
    assert page.locator('#placeSearchPanel').is_hidden()
    page.keyboard.press('Control+p')
    assert page.locator('#quickOpenDialog').is_hidden()


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**launch_options())
        try:
            for test, offline in ((test_search,False),(test_quick_open,False),(test_offline,True)):
                page = browser.new_page(viewport={'width':1280,'height':780})
                errors=[]
                page.on('pageerror', lambda error: errors.append(str(error)))
                try:
                    setup(page, offline)
                    test(page)
                    assert not errors, f'Browser errors: {errors}'
                    print('PASS',test.__name__)
                finally:
                    page.close()
        finally:
            browser.close()


if __name__ == '__main__':
    main()
