#!/usr/bin/env python3
"""Workspace layout and shared-document regressions with the REAL built Monaco."""
from __future__ import annotations
import json
import os
from playwright.sync_api import sync_playwright, expect
from smoke import PROJECT, launch_options
from built_renderer import mount_built, replace_code


def open_script(page, ident='s1'):
    page.locator(f'.tree-row[data-id="{ident}"] .tree-name').click()
    expect(page.locator('.tab.active')).to_have_attribute('data-id', ident)


def synced(page, count):
    page.wait_for_function('(count) => window.__outbound.length === count', arg=count)
    expect(page.locator('#secondarySync')).to_have_text('Synced')
    assert 'warning' not in (page.locator('#secondarySync').get_attribute('class') or '')


def test_shared_document(page):
    mount_built(page)
    open_script(page)
    page.locator('#splitEditor').click()
    expect(page.locator('#secondaryPane')).to_be_visible()
    assert page.locator('.monaco-editor').count() == 2
    replace_code(page, 'secondaryMonacoHost', 'print("SHARED_SECONDARY")')
    synced(page, 1)
    expect(page.locator('#monacoHost .view-lines')).to_contain_text('SHARED_SECONDARY')
    expect(page.locator('#secondaryMonacoHost .view-lines')).to_contain_text('SHARED_SECONDARY')
    assert page.evaluate('window.__outbound[0].id') == 's1'
    # Independent cursors and scroll positions on the same shared model.
    page.keyboard.press('Control+Home')
    page.keyboard.press('ArrowRight')
    expect(page.locator('#secondaryCursor')).to_have_text('Ln 1, Col 2')
    page.locator('#monacoHost .view-lines').click(position={'x':110, 'y':10})
    page.keyboard.press('Control+End')
    expect(page.locator('#secondaryCursor')).to_have_text('Ln 1, Col 2')
    # Changing the main tab cannot reroute a secondary edit to the wrong id.
    open_script(page, 's2')
    replace_code(page, 'secondaryMonacoHost', 'print("PINNED_S1")')
    synced(page, 2)
    assert page.evaluate('window.__outbound[1].id') == 's1'
    expect(page.locator('#monacoHost .view-lines')).to_contain_text('two')
    # Undo in one view updates the shared model and still uses one write pipeline.
    page.keyboard.press('Control+z')
    page.wait_for_timeout(650)
    assert page.evaluate('window.__outbound.at(-1).id') == 's1'
    # Closing a view does not close, dispose or overwrite the main document.
    page.keyboard.press('Control+w')
    expect(page.locator('#secondaryPane')).to_be_hidden()
    expect(page.locator('.tab.active')).to_have_attribute('data-id', 's2')
    expect(page.locator('#monacoHost .view-lines')).to_contain_text('two')


def test_conflict_and_session_cleanup(page):
    mount_built(page)
    open_script(page)
    page.locator('#splitEditor').click()
    page.evaluate('window.__autoAck = false')
    replace_code(page, 'secondaryMonacoHost', 'print("PROTECTED_LOCAL")')
    page.evaluate("""() => window.__emitServer({type:'upsert',origin:'studio',node:{
      ...window.__mockNodes.find(item=>item.id==='s1'),revision:2,source:'print("EXTERNAL")',pending:false}})""")
    expect(page.locator('#secondarySync')).to_contain_text('Conflict')
    expect(page.locator('#secondaryReview')).to_be_visible()
    expect(page.locator('#monacoHost .view-lines')).to_contain_text('PROTECTED_LOCAL')
    page.wait_for_timeout(600)
    assert page.evaluate('window.__outbound.length') == 0, 'a split view must not bypass conflicts'
    assert page.evaluate('window.__savedSources.some(item=>item.source.includes("PROTECTED_LOCAL"))')
    page.evaluate("""() => window.__emitServer({type:'status',status:{
      connected:false,ready:false,pairingCode:'123456',placeKey:'100-200'}})""")
    expect(page.locator('#secondaryPane')).to_be_hidden()
    expect(page.locator('#codePanel')).to_be_hidden()
    expect(page.locator('#welcome')).to_be_visible()
    page.evaluate("window.__emitServer({type:'reset'})")
    assert page.locator('.tab[data-id]').count() == 0


def test_layout_and_persistence(page):
    mount_built(page)
    open_script(page)
    page.keyboard.press('Control+Backslash')
    expect(page.locator('#secondaryPane')).to_be_visible()
    # Arrow-key resizing is available alongside dragging, including reversed docking.
    page.locator('#layoutToggle').click()
    page.locator('#dockRight').click()
    expect(page.locator('body')).to_have_attribute('data-sidebar-side','right')
    page.keyboard.press('Escape')
    before = page.locator('#explorerPane').bounding_box()
    editor = page.locator('#editorArea').bounding_box()
    assert before['x'] > editor['x']
    page.locator('#resizeDivider').focus()
    page.keyboard.press('ArrowLeft')
    assert page.locator('#explorerPane').bounding_box()['width'] > before['width']
    page.keyboard.press('Control+b')
    expect(page.locator('#explorerPane')).to_be_hidden()
    page.keyboard.press('Control+b')
    expect(page.locator('#explorerPane')).to_be_visible()
    page.keyboard.press('Control+Shift+Backslash')
    expect(page.locator('#editorArea')).to_have_attribute('data-split-direction', 'horizontal')
    first, second = page.locator('#primaryPane').bounding_box(), page.locator('#secondaryPane').bounding_box()
    assert second['y'] > first['y'] + first['height']
    page.locator('#layoutToggle').click()
    page.locator('#reduceMotionSetting').check()
    saved = page.evaluate('Object.fromEntries(window.__fixtureStorage)')
    assert json.loads(saved['cursor-bridge-workspace-v1'])['reduceMotion']
    page.keyboard.press('Escape')
    # An instance drag must not become an editor/panel drag.
    page.evaluate("""() => {
      const transfer=new DataTransfer();transfer.setData('application/x-cursor-bridge-nodes','["s1"]');
      document.querySelector('.tree-row[data-id="s1"]').dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}));
    }""")
    assert page.locator('body').get_attribute('data-workspace-drag') is None
    page.evaluate("document.dispatchEvent(new DragEvent('dragend',{bubbles:true}))")
    # Separate page mount, saved layout only: code/model state is never serialized as layout.
    restored = page.context.browser.new_page(viewport=page.viewport_size)
    try:
        mount_built(restored,preferences=saved)
        expect(restored.locator('body')).to_have_attribute('data-sidebar-side','right')
        expect(restored.locator('body')).to_have_attribute('data-reduce-motion','true')
        expect(restored.locator('#editorArea')).to_have_attribute('data-split-direction','horizontal')
        assert restored.locator('.tab[data-id]').count() == 0
    finally:
        restored.close()


def test_drag_targets_and_removal(page):
    mount_built(page)
    open_script(page)
    page.evaluate("""() => {
      const transfer=new DataTransfer();
      document.querySelector('#explorerDragHandle').dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}));
      document.querySelector('.workspace-drop[data-kind="panel"][data-side="right"]').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer}));
    }""")
    expect(page.locator('body')).to_have_attribute('data-sidebar-side','right')
    page.evaluate("""() => {
      const transfer=new DataTransfer();
      document.querySelector('.tab[data-id="s1"]').dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}));
      document.querySelector('.workspace-drop[data-kind="tab"][data-direction="horizontal"]').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer}));
      document.dispatchEvent(new DragEvent('dragend',{bubbles:true}));
    }""")
    expect(page.locator('#secondaryPane')).to_be_visible()
    expect(page.locator('#editorArea')).to_have_attribute('data-split-direction','horizontal')
    page.evaluate("window.__emitServer({type:'remove',ids:['s1']})")
    expect(page.locator('#secondaryPane')).to_be_hidden()
    assert page.locator('.tab[data-id]').count() == 0


def test_minimum_size_and_themes(page):
    page.set_viewport_size({'width':1000,'height':680})
    mount_built(page,offline=True)
    expect(page.locator('#pairingCode')).to_have_text('432987')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.locator('#themeToggle').click()
    for theme in ('graphite','midnight','aurora','obsidian','discord'):
        page.locator('#themeOptions .theme-option').filter(has_text=theme.title()).click()
        expect(page.locator('body')).to_have_attribute('data-theme',theme)
        page.locator('#themeToggle').click()
    page.keyboard.press('Escape')
    assert page.locator('#pairingCard').bounding_box()['width'] > 300
    page.locator('#dashboardCompose').click()
    expect(page.locator('#quickApplyDialog')).to_be_visible()
    expect(page.locator('#quickApplyConfirm')).to_be_disabled()
    rect = page.locator('#quickApplyDialog').bounding_box()
    assert rect['x'] >= 0 and rect['x']+rect['width'] <= 1001
    assert rect['y'] >= 0 and rect['y']+rect['height'] <= 681


def main():
    with sync_playwright() as pw:
        browser=pw.chromium.launch(**launch_options())
        try:
            for test in (test_shared_document,test_conflict_and_session_cleanup,test_layout_and_persistence,
                         test_drag_targets_and_removal,test_minimum_size_and_themes):
                page=browser.new_page(viewport={'width':1440,'height':900})
                errors=[]
                page.on('pageerror',lambda error:errors.append(str(error)))
                page.on('dialog',lambda dialog:dialog.accept())
                try:
                    test(page)
                    assert not errors, str(errors)
                    print('PASS real Monaco:',test.__name__)
                finally: page.close()
        finally: browser.close()


if __name__=='__main__':main()
