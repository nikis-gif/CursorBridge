#!/usr/bin/env python3
"""Editor safety regressions, exercised against the actual renderer in Chromium.

Only the Studio/Electron transport and Monaco are mocked; this is not a live
Roblox Studio integration test.
"""
from __future__ import annotations

from playwright.sync_api import sync_playwright
from smoke import PROJECT, FIXTURES, fixture_page, fixture_modules, IMPORTS, MOUNT_APP, launch_options


def mount(page, deferred_draft=False):
    bridge = (FIXTURES / 'bridge-mock.js').read_text(encoding='utf-8').replace(
        "new URLSearchParams(location.search).has('offline')", 'false')
    page.set_content(fixture_page(), wait_until='domcontentloaded')
    page.evaluate(bridge)
    page.evaluate("""() => {
      const store = new Map();
      window.__journal = store;
      window.__journalDraftCount = () => [...store.keys()].filter((key) => key.startsWith("cursor-bridge-safety-draft-v1:")).length;
      Object.defineProperty(window, 'localStorage', {configurable: true, value: {
        getItem: (key) => store.get(key) ?? null,
        setItem: (key, value) => store.set(key, value),
        removeItem: (key) => store.delete(key),
      }});
      window.__savedSources = [];
      window.__outbound = [];
      window.__cleared = [];
      window.cursorBridge.saveDraft = async (id, source) => {
        window.__savedSources.push({id, source}); return {ok:true};
      };
      window.cursorBridge.writeScript = async (id, source, revision) => {
        window.__outbound.push({id, source, revision});
        return {status: 'queued', revision};
      };
      window.cursorBridge.clearDraft = async (id, source, force) => {
        window.__cleared.push({id, source, force});return {ok:true};
      };
    }""")
    if deferred_draft:
        page.evaluate("""() => {
          window.__draftRequests = [];
          window.cursorBridge.getDraft = (id) => new Promise(resolve => {
            window.__draftRequests.push({id, resolve});
          });
        }""")
    page.evaluate(MOUNT_APP, [fixture_modules(),
        (PROJECT / 'renderer/app.js').read_text(encoding='utf-8'), IMPORTS])
    page.wait_for_selector('.tree-row[data-id="s1"]')


def open_node(page, node_id='s1'):
    page.locator(f'.tree-row[data-id="{node_id}"] .tree-name').click()
    assert page.locator('.tab.active').get_attribute('data-id') == node_id


def test_fast_typing_during_draft_lookup(page):
    mount(page, deferred_draft=True)
    open_node(page)
    page.wait_for_function('window.__draftRequests.length === 1')
    page.evaluate('window.__testEditSource("print(12345) -- new local change")')
    page.evaluate('window.__draftRequests.shift().resolve({source:"print(OLD)", savedAt:"2026-01-01T00:00:00Z"})')
    page.wait_for_timeout(170)
    assert page.evaluate('window.__testEditorSource()') == 'print(12345) -- new local change'
    assert page.locator('#syncIndicator').inner_text() == 'Unsynced local changes'
    assert page.evaluate('window.__journalDraftCount()') > 0
    assert any(item['source'].startswith('print(12345)') for item in page.evaluate('window.__savedSources'))


def test_studio_change_does_not_clobber_local_typing(page):
    mount(page)
    open_node(page)
    page.evaluate('window.__testEditSource("print(LOCAL)")')
    page.evaluate("""() => window.__emitServer({type:'upsert', origin:'studio', node: {
      id:'s1', name:'Main', parentId:'ws', className:'Script', isScript:true,
      revision:2, source:'print(STUDIO_EXTERNAL)'
    }})""")
    assert page.evaluate('window.__testEditorSource()') == 'print(LOCAL)'
    assert 'Conflict' in page.locator('#syncIndicator').inner_text()
    assert page.locator('#applyDraft').is_visible()
    page.wait_for_timeout(650)
    assert page.evaluate('window.__outbound.length') == 0, 'external conflict must block automatic overwrites'


def test_outgoing_ack_while_typing_newer_source(page):
    mount(page)
    open_node(page)
    page.evaluate('window.__testEditSource("print(FIRST)")')
    page.wait_for_function('window.__outbound.length === 1', timeout=4000)
    page.evaluate('window.__testEditSource("print(SECOND)")')
    page.evaluate("""() => window.__emitServer({type:'upsert',origin:'cursor',node: {
      id:'s1', name:'Main', parentId:'ws', className:'Script', isScript:true,
      revision:2, source:'print(FIRST)'
    }})""")
    assert page.evaluate('window.__testEditorSource()') == 'print(SECOND)'
    assert 'Conflict' not in page.locator('#syncIndicator').inner_text()
    page.wait_for_function('window.__outbound.some((item) => item.source === "print(SECOND)")', timeout=4000)
    page.evaluate("""() => window.__emitServer({type:'upsert',origin:'cursor',node: {
      id:'s1', name:'Main', parentId:'ws', className:'Script', isScript:true,
      revision:3, source:'print(SECOND)'
    }})""")
    assert page.evaluate('window.__testEditorSource()') == 'print(SECOND)'
    assert page.locator('#syncIndicator').inner_text() == 'Synced'
    page.wait_for_function('window.__journalDraftCount() === 0', timeout=3000)


def test_disconnection_persists_latest_source(page):
    mount(page)
    open_node(page)
    page.evaluate('window.__testEditSource("print(OFFLINE_RECOVERY)")')
    page.evaluate("""() => window.__emitServer({type:'status',status:{
      connected:false,ready:false,placeKey:'100-200',placeName:'Sample Place',pairingCode:'123456'
    }})""")
    assert page.locator('#explorerPane').is_hidden()
    assert page.locator('#codePanel').is_hidden()
    assert any(row['source'] == 'print(OFFLINE_RECOVERY)' for row in page.evaluate('window.__savedSources'))
    assert page.evaluate('window.__journalDraftCount()') > 0


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**launch_options())
        try:
            for scenario in [test_fast_typing_during_draft_lookup,
                             test_studio_change_does_not_clobber_local_typing,
                             test_outgoing_ack_while_typing_newer_source,
                             test_disconnection_persists_latest_source]:
                page = browser.new_page(viewport={'width': 1280, 'height': 800})
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                try:
                    scenario(page)
                    assert not errors, 'Uncaught renderer errors: '+repr(errors)
                    print('PASS', scenario.__name__)
                finally:
                    page.close()
        finally:
            browser.close()

if __name__ == '__main__':
    main()
