"""Load the real Vite bundle and real Monaco without network or Electron.

Only asset URLs/CSP in the test document are adapted to in-memory blobs.
The production app and Monaco are not replaced. The Studio bridge is a fixture.
"""
from __future__ import annotations
import base64
import mimetypes
import re
from pathlib import Path
from smoke import PROJECT, FIXTURES


def data_uri(path: Path) -> str:
    mime = mimetypes.guess_type(str(path))[0] or 'application/octet-stream'
    return f'data:{mime};base64,' + base64.b64encode(path.read_bytes()).decode('ascii')


def mount_built(page, *, offline=False, preferences=None, ai_fixture=False):
    dist = PROJECT / 'dist-renderer'
    if not (dist / 'index.html').exists():
        raise RuntimeError('Run npm run build before the real Monaco regression suite.')
    html = (dist / 'index.html').read_text(encoding='utf-8')
    entry = re.search(r'<script[^>]+src="([^"]+)"', html)[1]
    html = re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]+>', '', html)
    html = re.sub(r'<script[^>]+src="[^"]+"[^>]*></script>', '', html)
    html = re.sub(r'<link[^>]+rel="stylesheet"[^>]*>', '', html)
    css = '\n'.join(p.read_text(encoding='utf-8') for p in (dist / 'assets').glob('*.css'))
    for font in (dist / 'assets').glob('*.ttf'):
        css = css.replace('./' + font.name, data_uri(font))
    html = html.replace('</head>', '<style>' + css + '</style></head>')
    html = html.replace('./CursorIcon.png', data_uri(dist / 'CursorIcon.png'))
    source = (dist / entry.removeprefix('./')).read_text(encoding='utf-8')
    workers = {p.name: p.read_text(encoding='utf-8') for p in (dist / 'assets').glob('*worker*.js')}
    page.set_content(html, wait_until='domcontentloaded')
    page.evaluate((FIXTURES / 'bridge-mock.js').read_text(encoding='utf-8').replace(
        "new URLSearchParams(location.search).has('offline')", 'true' if offline else 'false'))
    page.evaluate("""initial => {
      const store = new Map(Object.entries(initial || {}));
      window.__fixtureStorage = store;
      Object.defineProperty(window, 'localStorage', { configurable:true, value: {
        getItem: key => store.get(key) ?? null,
        setItem: (key, value) => store.set(key, value),
        removeItem: key => store.delete(key),
      }});
      window.__outbound = []; window.__savedSources = []; window.__autoAck = true;
      window.cursorBridge.saveDraft = async (id, source) => { window.__savedSources.push({id, source}); };
      window.cursorBridge.writeScript = async (id, source, revision) => {
        window.__outbound.push({id, source, revision});
        if (window.__autoAck) setTimeout(() => {
          const node = window.__mockNodes.find(item => item.id === id);
          Object.assign(node, {source, revision:revision+1, pending:false});
          window.__emitServer({type:'upsert',origin:'cursor',node:{...node}});
        }, 15);
        return {status:'queued'};
      };
    }""", preferences or {})
    if ai_fixture:
        page.evaluate("""() => {
          const initial = [
            {placeKey:'100-200',name:'Sample Place',chats:[],memories:[],snippets:[]},
            {placeKey:'historic-place',name:'Previous Place',chats:[],memories:[],snippets:[]},
          ];
          const projects = new Map(initial.map(project => [project.placeKey, project]));
          const clone = value => structuredClone(value);
          window.__aiSent = [];
          window.__aiCreateStarted = false;
          window.__releaseAiCreate = null;
          Object.assign(window.cursorBridge, {
            aiListProjects: async () => [...projects.values()].map(p => ({placeKey:p.placeKey,name:p.name})),
            aiEnsureProject: async (key,name) => clone(projects.get(key) || {placeKey:key,name,chats:[],memories:[],snippets:[]}),
            aiNewChat: async (key) => {
              window.__aiCreateStarted = true;
              await new Promise(resolve => { window.__releaseAiCreate = resolve; });
              const project = projects.get(key);
              const id = 'chat-' + key;
              project.chats.unshift({id,title:'New chat',messages:[],createdAt:new Date().toISOString()});
              return {...clone(project),result:id};
            },
            aiAccountStatus: async () => ({connected:true,displayName:'Test account',secureStorage:true}),
            aiModels: async () => [{id:'allowed',name:'Authorized model'}],
            aiSend: async (request) => {
              window.__aiSent.push(clone(request));
              const chat = projects.get(request.placeKey).chats.find(c => c.id === request.chatId);
              chat.messages.push({role:'user',content:request.text,id:'user-1'});
              chat.messages.push({role:'assistant',content:'Response',id:'assistant-1'});
              return {ok:true,reply:'Response'};
            },
            aiOpenUsage: async () => {},
          });
        }""")
    page.evaluate("""async ([source, workers]) => {
      for (const [name, content] of Object.entries(workers)) {
        const url = URL.createObjectURL(new Blob([content], {type:'text/javascript'}));
        source = source.replaceAll('`' + name + '`,import.meta.url', '`' + url + '`,import.meta.url');
      }
      await import(URL.createObjectURL(new Blob([source], {type:'text/javascript'})));
    }""", [source, workers])
    if not offline:
        page.wait_for_selector('.tree-row[data-id="s1"]')
    page.wait_for_timeout(100)


def replace_code(page, host: str, source: str):
    page.locator(f'#{host} .view-lines').click(position={'x': 100, 'y': 10})
    page.keyboard.press('Control+a')
    # Keyboard.type exercises native EditContext as well as legacy textarea Monaco.
    page.keyboard.type(source)
    page.keyboard.press('Escape')
