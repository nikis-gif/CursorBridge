#!/usr/bin/env python3
"""Compact window, neutral chrome, theme migration, and English UI regressions."""
from __future__ import annotations
from playwright.sync_api import sync_playwright, expect
from smoke import launch_options
from built_renderer import mount_built, replace_code


def inside_viewport(page, selector):
    item = page.locator(selector)
    expect(item).to_be_visible()
    bounds = item.bounding_box()
    view = page.viewport_size
    assert bounds['width'] > 0 and bounds['height'] > 0, selector
    assert bounds['x'] >= -1 and bounds['y'] >= -1, (selector, bounds)
    assert bounds['x'] + bounds['width'] <= view['width'] + 1, (selector, bounds)
    assert bounds['y'] + bounds['height'] <= view['height'] + 1, (selector, bounds)


def test_compact_chrome(page):
    for width, height in ((1080, 700), (1000, 620), (840, 540), (720, 504)):
        page.set_viewport_size({'width': width, 'height': height})
        mount_built(page, offline=True)
        expect(page.locator('body')).to_have_attribute('data-theme', 'obsidian')
        expect(page.locator('#workspaceSummary')).to_be_hidden()
        expect(page.locator('#welcomeTitle')).to_have_text('Connect to Roblox Studio')
        expect(page.locator('#dashboardBrowse')).to_be_disabled()
        expect(page.locator('#dashboardSearch')).to_be_disabled()
        for selector in ('#pairingCard', '#copyCode', '#layoutToggle', '#themeToggle', '#sessionToggle'):
            inside_viewport(page, selector)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.locator('#dashboardCompose').click()
        expect(page.locator('#quickApplyConfirm')).to_be_disabled()
        for selector in ('#quickApplyDialog', '#quickApplyConfirm', '.qa-close'):
            inside_viewport(page, selector)
        page.keyboard.press('Escape')
        page.locator('#themeToggle').click()
        inside_viewport(page, '#themePanel')
        expect(page.locator('#themeOptions button').first).to_contain_text('Obsidian')
        assert 'Discord' not in page.locator('#themePanel').inner_text()
        page.keyboard.press('Escape')
        # Fresh page content must not accumulate listeners from previous mounts.
        page.goto('about:blank')


def test_theme_preference_migration(page):
    for stored, expected in (('discord', 'cursor'), ('obsidian', 'obsidian'), ('midnight', 'midnight'), ('__proto__', 'obsidian')):
        mount_built(page, offline=True, preferences={
            'cursor-bridge-theme': stored,
            'cursor-bridge-code-theme': stored,
        })
        expect(page.locator('body')).to_have_attribute('data-theme', expected)
        assert page.evaluate("localStorage.getItem('cursor-bridge-theme')") == expected
        code_theme = 'auto' if stored == '__proto__' else expected
        assert page.evaluate("localStorage.getItem('cursor-bridge-code-theme')") == code_theme
        page.locator('#themeToggle').click()
        expect(page.locator('#codeThemeSetting')).to_have_value(code_theme)
        assert 'Discord' not in page.locator('body').inner_text()
        page.goto('about:blank')


def test_compact_split_and_layout(page):
    page.set_viewport_size({'width': 840, 'height': 540})
    mount_built(page)
    expect(page.locator('#workspaceSummary')).to_be_visible()
    expect(page.locator('#dashboardScripts')).to_have_text('3')
    expect(page.locator('#tabs')).to_be_hidden()
    assert page.locator('#welcome .dashboard-action svg').count() == 0
    assert page.locator('.activity-rail button').count() == 6
    for node in page.locator('.tree-class svg').all():
        expect(node).to_have_attribute('stroke', 'currentColor')
    page.locator('.tree-row[data-id="s1"] .tree-name').click()
    page.locator('#splitEditor').click()
    inside_viewport(page, '#secondaryPane')
    for selector in ('#splitEditor', '#openStudio', '#viewBackups', '#closeSecondary'):
        inside_viewport(page, selector)
    replace_code(page, 'secondaryMonacoHost', 'print("COMPACT_EDIT")')
    page.wait_for_function('window.__outbound.length === 1')
    assert page.evaluate('window.__outbound[0].id') == 's1'
    expect(page.locator('#monacoHost .view-lines')).to_contain_text('COMPACT_EDIT')
    page.locator('#layoutToggle').click()
    page.locator('#dockRight').click()
    page.keyboard.press('Escape')
    expect(page.locator('body')).to_have_attribute('data-sidebar-side', 'right')
    for selector in ('#explorerPane', '#secondaryPane', '#splitEditor'):
        inside_viewport(page, selector)
    page.locator('#layoutToggle').click()
    page.locator('#resetLayout').click()
    page.keyboard.press('Escape')
    expect(page.locator('#secondaryPane')).to_be_hidden()
    expect(page.locator('#monacoHost .view-lines')).to_contain_text('COMPACT_EDIT')
    assert round(page.locator('#explorerPane').bounding_box()['width']) == 248
    assert page.evaluate('window.__outbound.length') == 1


def test_clamped_sidebar_resize(page):
    page.set_viewport_size({'width': 840, 'height': 540})
    mount_built(page, preferences={
        'cursor-bridge-workspace-v1': '{"sidebarWidth":460}'
    })
    before = page.locator('#explorerPane').bounding_box()['width']
    assert before < 460
    handle = page.locator('#resizeDivider').bounding_box()
    page.mouse.move(handle['x'] + handle['width']/2, handle['y'] + 60)
    page.mouse.down()
    page.mouse.move(handle['x'] + handle['width']/2 - 25, handle['y'] + 60, steps=5)
    page.mouse.up()
    after = page.locator('#explorerPane').bounding_box()['width']
    assert before - after > 20, (before, after)
    page.locator('#resizeDivider').focus()
    page.keyboard.press('ArrowLeft')
    assert page.locator('#explorerPane').bounding_box()['width'] < after - 10



def test_workspace_without_embedded_ai(page):
    """No ghost ChatGPT entry points, even after using the former shortcut."""
    for width, height in ((1080, 700), (840, 540), (720, 504)):
        page.set_viewport_size({'width': width, 'height': height})
        mount_built(page, offline=True)
        assert page.locator('#railAssistant').count() == 0
        assert page.locator('#aiPanel').count() == 0
        assert page.locator('.activity-rail button').count() == 6
        assert page.locator('#shortcutsDialog').count() <= 1
        expect(page.locator('#quickApplyLauncher')).to_be_visible()
        page.keyboard.press('Control+Shift+a')
        assert page.locator('#aiPanel').count() == 0
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        page.goto('about:blank')


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch(**launch_options())
        try:
            for test in (test_compact_chrome, test_theme_preference_migration, test_compact_split_and_layout, test_clamped_sidebar_resize, test_workspace_without_embedded_ai):
                page = browser.new_page(viewport={'width': 1080, 'height': 700})
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.on('dialog', lambda dialog: dialog.accept())
                try:
                    test(page)
                    assert not errors, str(errors)
                    print('PASS minimal UI:', test.__name__)
                finally:
                    page.close()
        finally:
            browser.close()


if __name__ == '__main__':
    main()
