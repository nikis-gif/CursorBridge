#!/usr/bin/env python3
"""Validate the real virtual Explorer while Roblox pages a very large folder."""
from playwright.sync_api import sync_playwright
from smoke import PROJECT, FIXTURES, fixture_page, fixture_modules, IMPORTS, MOUNT_APP, launch_options


def main():
    app = (PROJECT / 'renderer/app.js').read_text(encoding='utf8')
    mock = (FIXTURES / 'bridge-mock.js').read_text(encoding='utf8').replace(
        "new URLSearchParams(location.search).has('offline')", 'false')
    with sync_playwright() as p:
        browser=p.chromium.launch(**launch_options())
        try:
            page=browser.new_page(viewport={'width':1300,'height':810})
            errors=[]
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.set_content(fixture_page(),wait_until='domcontentloaded')
            page.evaluate(mock)
            page.evaluate("""() => {
              window.__requests = [];
              window.__mockNodes = [{id:'ws',name:'Workspace',parentId:'game',className:'Workspace',isScript:false,hasChildren:true}];
              window.cursorBridge.getState = async () => ({
                status:{connected:true,ready:true,onDemand:true,scanComplete:false,
                  indexing:false,nodeCount:1,placeKey:'999-999',placeName:'Huge Place'},
                childPages:{},nodes:window.__mockNodes
              });
              window.cursorBridge.requestChildren = async (id) => {
                window.__requests.push(id); return {status:'loading'};
              };
            }""")
            page.evaluate('''Object.defineProperty(window, 'localStorage', {configurable:true,value:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}})''')
            page.evaluate(MOUNT_APP,[fixture_modules(),app,IMPORTS])
            page.wait_for_selector('.tree-row[data-id="ws"]')
            page.wait_for_function('window.__requests.length === 1')
            assert page.locator('.tree-page-action').count()==1
            assert page.locator('.tree-page-action').inner_text()=='Loading children…'
            children=[{'type':'upsert','node':{'id':f'p{i}','name':f'Part{i}','parentId':'ws',
               'className':'Part','isScript':False,'hasChildren':False,'siblingOrder':i+1}} for i in range(150)]
            page.evaluate('(events) => window.__emitServer({type:"batch",events})',children+[
                {'type':'childrenPage','parentId':'ws','offset':150,'total':600000,'complete':False}])
            page.wait_for_function("document.querySelector('#explorerSummary').textContent.includes('151 indexed')")
            assert page.locator('.tree-row').count()<140
            page.locator('#treeScroller').evaluate('(element) => element.scrollTop=element.scrollHeight')
            page.wait_for_selector('.tree-page-action')
            assert '599,850 remaining' in page.locator('.tree-page-action').inner_text()
            page.locator('#treeScroller').evaluate('(element) => element.scrollTop=element.scrollHeight')
            page.locator('.tree-page-action').click()
            page.wait_for_function('window.__requests.length===2')
            page.wait_for_function("document.querySelector('.tree-page-action')?.textContent === 'Loading children…'")
            # Disconnect must remove virtual rows, not leave stale huge-place content.
            page.evaluate("""() => window.__emitServer({type:'status',status:{connected:false,ready:false,pairingCode:'995599'}})""")
            assert page.locator('#explorerPane').is_hidden()
            assert page.locator('.tree-row').count()==0
            assert not errors,errors
            print('PASS demand-paged Explorer: 600,000 siblings, only 150 initially loaded, no stale offline tree')
        finally:
            browser.close()

if __name__=='__main__':main()
