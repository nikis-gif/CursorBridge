#!/usr/bin/env python3
"""100k-instance Chromium Explorer stress test with mocked Studio messages."""
from playwright.sync_api import sync_playwright
from smoke import PROJECT, FIXTURES, fixture_page, fixture_modules, IMPORTS, MOUNT_APP, launch_options


def main():
    source = (PROJECT / 'renderer/app.js').read_text(encoding='utf8')
    bridge = (FIXTURES / 'bridge-mock.js').read_text(encoding='utf8').replace(
        "new URLSearchParams(location.search).has('offline')", 'false')
    with sync_playwright() as p:
        browser = p.chromium.launch(**launch_options())
        try:
            page = browser.new_page(viewport={'width':1440,'height':870})
            errors = []
            page.on('pageerror',lambda error: errors.append(str(error)))
            page.set_content(fixture_page(),wait_until='domcontentloaded')
            page.evaluate(bridge)
            page.evaluate("""Object.defineProperty(window,'localStorage',{
                configurable:true,value:{getItem:()=>null,setItem:()=>{}}
            })""")
            page.evaluate(MOUNT_APP,[fixture_modules(),source,IMPORTS])
            page.wait_for_selector('.tree-row[data-id="ws"]')
            page.evaluate("""() => {
                const events = [];
                for(let i=0;i<100000;i++) {
                  events.push({type:'upsert', node:{id:'huge-'+i,
                    parentId:'ws',name:'Part'+i,className:'Part',isScript:false,
                    siblingOrder:i+10}});
                }
                window.__emitServer({type:'batch',events});
            }""")
            page.wait_for_function("document.querySelector('#instanceStat').textContent.includes('100,007')",timeout=45000)
            mounted = page.locator('.tree-row').count()
            assert mounted < 160, f'virtualization failed: mounted={mounted}'
            first_scroll_height=page.locator('#treeScroller').evaluate('(element)=>element.scrollHeight')
            assert first_scroll_height > 2000000, first_scroll_height
            page.locator('#treeScroller').evaluate('(element)=>element.scrollTop=element.scrollHeight')
            page.wait_for_selector('.tree-row[data-id="huge-99999"]',timeout=12000)
            page.locator('.tree-row[data-id="huge-99999"] .tree-name').click()
            assert page.locator('.tree-row[data-id="huge-99999"]').get_attribute('aria-selected') == 'true'
            assert not errors, 'Renderer errors: '+repr(errors)
            print(f'PASS 100,007 instances: {mounted} initial rendered rows, scroll last instance, select')
        finally:
            browser.close()

if __name__ == '__main__':
    main()
