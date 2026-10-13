import { icon } from './icons.js';
import { projectKeyForPlace } from './place-project-key.mjs';
import './ai-panel.css';

// Lightweight, isolated AI surface. No direct HTTP requests or credentials in renderer.
export function mountAssistant({ api, getStatus, getSelectedContext, toast }) {
  const rail = document.createElement('button');
  rail.type = 'button'; rail.id = 'railAssistant'; rail.className = 'rail-button';
  rail.title = 'AI projects (Ctrl+Shift+A)'; rail.setAttribute('aria-label', 'AI projects');
  rail.setAttribute('aria-pressed', 'false');
  rail.innerHTML = `${icon('Chat')}<span class="rail-tooltip">AI projects</span>`;
  document.querySelector('.activity-rail .rail-spacer').before(rail);

  const pane = document.createElement('aside');
  pane.id = 'aiPanel'; pane.className = 'ai-panel'; pane.hidden = true;
  pane.setAttribute('aria-label', 'AI project conversations');
  pane.innerHTML = `
    <header class="ai-heading">
      <div class="ai-heading-title"><span class="ai-eyebrow">WORKSPACE</span><strong>Project conversations</strong></div>
      <button type="button" class="ai-icon" id="aiClose" title="Close (Ctrl+Shift+A)" aria-label="Close AI panel">${icon('close')}</button>
    </header>
    <div class="ai-project-row">
      <label class="ai-field-label" for="aiPlace">PLACE PROJECT</label>
      <select id="aiPlace" title="Previously connected Places"></select>
    </div>
    <div class="ai-auth-row">
      <div class="ai-auth-status"><span id="aiLoginStatus">ChatGPT not connected</span><small id="aiAuthDetail">Use your own account and plan</small></div>
      <button class="ai-subtle-button" type="button" id="aiLogin">Connect</button>
    </div>
    <div class="ai-model-row"><label for="aiModel">Model</label><select id="aiModel" disabled><option value="">Sign in to load models</option></select>
      <button type="button" class="ai-usage-link" id="aiUsage" title="Open ChatGPT usage settings">Usage</button>
    </div>
    <nav class="ai-tabs" aria-label="Project views">
      <button type="button" data-view="chats" aria-pressed="true">Chats</button>
      <button type="button" data-view="memories" aria-pressed="false">Memory</button>
      <button type="button" data-view="snippets" aria-pressed="false">Saved code</button>
    </nav>
    <div class="ai-view ai-chat-view" id="aiChatsView">
      <div class="ai-thread-heading"><span>CONVERSATIONS</span><button type="button" id="aiNewChat" class="ai-text-action">${icon('plus', 13)} New chat</button></div>
      <div class="ai-threads" id="aiThreads" aria-label="Saved conversations"></div>
      <div class="ai-message-list" id="aiMessages" role="log" aria-live="polite" aria-label="Conversation"></div>
      <form class="ai-compose" id="aiCompose">
        <label class="ai-field-label" for="aiPrompt">MESSAGE</label>
        <textarea id="aiPrompt" rows="3" placeholder="Ask about this Place or write Luau code…" maxlength="32000"></textarea>
        <div class="ai-compose-footer">
          <label class="ai-context-choice" title="Only include the selected script if you enable this option"><input type="checkbox" id="aiIncludeScript" /> Script context</label>
          <div class="ai-compose-actions">
            <button type="button" class="ai-icon" id="aiDictate" title="Dictate using the system speech service" aria-label="Dictate message">${icon('mic', 16)}</button>
            <button type="submit" class="ai-primary" id="aiSubmit">Send ${icon('arrow-up', 14)}</button>
          </div>
        </div>
        <small class="ai-footnote" id="aiRequestStatus">Ctrl+Enter to send. History is local; prompts go to OpenAI.</small>
      </form>
    </div>
    <div class="ai-view ai-settings-view" id="aiMemoriesView" hidden>
      <p class="ai-descriptor">Project notes are saved locally and included in later conversations for this Place.</p>
      <form class="ai-inline-form" id="aiMemoryForm"><textarea id="aiMemoryText" rows="3" placeholder="Architecture notes, conventions or decisions…" maxlength="5000"></textarea><button class="ai-primary" type="submit">Save note</button></form>
      <div id="aiMemoryList" class="ai-entries"></div>
    </div>
    <div class="ai-view ai-settings-view" id="aiSnippetsView" hidden>
      <p class="ai-descriptor">Code saved from responses remains available when Studio is offline. Nothing is applied automatically.</p>
      <div id="aiSnippetList" class="ai-entries"></div>
    </div>`;
  document.querySelector('.workbench').append(pane);
  const $ = id => pane.querySelector(`#${id}`);
  const supported = typeof api?.aiListProjects === 'function' && typeof api?.aiAccountStatus === 'function';
  const state = { open: false, view: 'chats', placeKey: null, placeName: '', project: null, projects: [], chatId: null,
    account: null, models: [], selectedModel: '', sending: false, partial: '', requestChatId: null, changeId: 0 };
  const cleanup = [];
  let streamFrame = 0;
  const scheduleMessageRender = () => {
    if (!streamFrame) streamFrame = requestAnimationFrame(() => { streamFrame = 0; renderMessages(); });
  };
  const on = (node, event, fn) => { node.addEventListener(event, fn); cleanup.push(() => node.removeEventListener(event, fn)); };
  const uiError = error => { $('aiRequestStatus').textContent = error?.message || String(error); toast(error?.message || String(error), true); };
  const empty = (text) => { const el = document.createElement('p'); el.className = 'ai-empty'; el.textContent = text; return el; };
  const button = (label, action, title = label) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'ai-text-action'; b.textContent = label; b.title = title; b.addEventListener('click', action); return b; };

  function toggle(force = !state.open) {
    state.open = Boolean(force); pane.hidden = !state.open;
    rail.setAttribute('aria-pressed', String(state.open));
    if (state.open) { if (supported) refreshModels(); $('aiPrompt').focus(); }
  }
  function renderPlaces() {
    const select = $('aiPlace'); select.replaceChildren();
    if (!state.projects.length) { const o = new Option('Connect a Place to start', ''); select.add(o); return; }
    for (const p of state.projects) select.add(new Option(p.name || p.placeKey, p.placeKey));
    if (state.placeKey && state.projects.some(p => p.placeKey === state.placeKey)) select.value = state.placeKey;
  }
  function renderAccount() {
    const a = state.account;
    $('aiLoginStatus').textContent = a?.connected ? (a.displayName || a.email || 'ChatGPT connected') : 'ChatGPT not connected';
    $('aiAuthDetail').textContent = a?.connected ? (a.email || 'ChatGPT plan permission granted') :
      a?.error ? String(a.error).slice(0, 180) : a?.secureStorage === false ? 'Secure storage is unavailable' : 'Sign in with your ChatGPT account';
    $('aiLogin').textContent = a?.connected ? 'Sign out' : a?.pending ? 'Opening…' : 'Connect';
    $('aiLogin').disabled = !supported || Boolean(a?.pending || (a && !a.secureStorage));
    $('aiSubmit').disabled = state.sending || !a?.connected || !state.selectedModel;
    const select = $('aiModel'); select.replaceChildren();
    if (!state.models.length) select.add(new Option(a?.connected ? 'No models available' : 'Sign in to load models', ''));
    else for (const m of state.models) select.add(new Option(m.name, m.id));
    select.disabled = !state.models.length;
    if (state.models.some(m => m.id === state.selectedModel)) select.value = state.selectedModel;
  }
  async function refreshModels() {
    try {
      state.account = await api.aiAccountStatus();
      if (state.account.connected) {
        state.models = await api.aiModels();
        if (!state.models.some(m => m.id === state.selectedModel)) state.selectedModel = state.models[0]?.id || '';
      } else { state.models = []; state.selectedModel = ''; }
      renderAccount();
    } catch (error) { state.models = []; state.selectedModel = ''; renderAccount(); uiError(error); }
  }
  async function refreshProjects() {
    state.projects = await api.aiListProjects();
    renderPlaces();
  }
  async function loadProject(key, name = '') {
    if (!key) return;
    const serial = ++state.changeId;
    try {
      const project = await api.aiEnsureProject(key, name);
      if (serial !== state.changeId) return;
      state.project = project; state.placeKey = key; state.placeName = project.name;
      if (!project.chats.some(c => c.id === state.chatId)) state.chatId = project.chats[0]?.id || null;
      await refreshProjects(); render();
    } catch (error) { uiError(error); }
  }
  function textBlock(content) {
    const parent = document.createElement('div'); parent.className = 'ai-text-block';
    const parts = String(content).split(/```([\w+-]*)\n([\s\S]*?)```/g);
    for (let i = 0; i < parts.length; i += 1) {
      if (i % 3 !== 0) continue;
      if (parts[i]) { const text = document.createElement('div'); text.className = 'ai-prose'; text.textContent = parts[i]; parent.append(text); }
      if (i + 2 >= parts.length) continue;
      const lang = parts[i + 1], code = parts[i + 2];
      const box = document.createElement('div'); box.className = 'ai-code';
      const header = document.createElement('div'); header.className = 'ai-code-heading';
      const title = document.createElement('span'); title.textContent = lang || 'Code';
      const actions = document.createElement('div');
      actions.append(button('Copy', () => api.copyText(code).catch(uiError)));
      actions.append(button('Save', async () => {
        if (!state.placeKey) return;
        try { state.project = await api.aiSaveSnippet(state.placeKey, `Code from ${state.project?.chats.find(c => c.id === state.chatId)?.title || 'ChatGPT'}`.slice(0, 160), code); render(); }
        catch (error) { uiError(error); }
      }));
      header.append(title, actions);
      const pre = document.createElement('pre'); pre.textContent = code;
      box.append(header, pre); parent.append(box);
    }
    return parent;
  }
  function renderThreads() {
    const list = $('aiThreads'); list.replaceChildren();
    for (const chat of state.project?.chats || []) {
      const row = document.createElement('div'); row.className = `ai-thread${chat.id === state.chatId ? ' selected' : ''}`;
      const trigger = button(chat.title, () => { state.chatId = chat.id; state.partial = ''; render(); });
      trigger.className = 'ai-thread-name'; trigger.title = chat.title;
      const rename = button('Rename', async () => {
        const value = window.prompt('Conversation name', chat.title);
        if (value === null || !value.trim()) return;
        try { state.project = await api.aiRenameChat(state.placeKey, chat.id, value); render(); }
        catch (error) { uiError(error); }
      });
      rename.title = 'Rename conversation';
      const remove = button('Delete', async () => {
        if (!window.confirm(`Delete “${chat.title}” from this PC?`)) return;
        try { state.project = await api.aiDeleteChat(state.placeKey, chat.id); if (state.chatId === chat.id) state.chatId = state.project.chats[0]?.id || null; render(); }
        catch (error) { uiError(error); }
      });
      row.append(trigger, rename, remove); list.append(row);
    }
    if (!state.project?.chats.length) list.append(empty('No conversations yet.'));
  }
  function renderMessages() {
    const list = $('aiMessages'); list.replaceChildren();
    const chat = state.project?.chats.find(c => c.id === state.chatId);
    if (!chat) { list.append(empty('Start a conversation to keep a Place-specific development history.')); return; }
    for (const msg of chat.messages) {
      const item = document.createElement('article'); item.className = `ai-message ${msg.role}`;
      const head = document.createElement('div'); head.className = 'ai-message-heading';
      const author = document.createElement('strong'); author.textContent = msg.role === 'assistant' ? 'ChatGPT' : 'You';
      const controls = document.createElement('div'); controls.className = 'ai-message-controls';
      controls.append(button('Copy', () => api.copyText(msg.content).catch(uiError)));
      if (msg.role === 'assistant' && window.speechSynthesis && window.SpeechSynthesisUtterance) {
        controls.append(button('Listen', () => {
          window.speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(msg.content.slice(0, 8000));
          utterance.lang = navigator.language || 'en-US'; window.speechSynthesis.speak(utterance);
        }));
      }
      head.append(author, controls);
      item.append(head, textBlock(msg.content)); list.append(item);
    }
    if (state.sending && state.requestChatId === state.chatId) {
      const partial = document.createElement('article'); partial.className = 'ai-message assistant pending';
      const title = document.createElement('strong'); title.textContent = 'ChatGPT · Responding';
      partial.append(title, textBlock(state.partial || '…')); list.append(partial);
    }
    list.scrollTop = list.scrollHeight;
  }
  function renderEntries() {
    const memories = $('aiMemoryList'); memories.replaceChildren();
    for (const m of state.project?.memories || []) {
      const entry = document.createElement('div'); entry.className = 'ai-entry';
      const body = document.createElement('p'); body.textContent = m.text;
      entry.append(body, button('Delete', async () => {
        if (!window.confirm('Delete this project note?')) return;
        try { state.project = await api.aiDeleteMemory(state.placeKey, m.id); render(); } catch (error) { uiError(error); }
      })); memories.append(entry);
    }
    if (!state.project?.memories.length) memories.append(empty('No project notes yet.'));
    const snippets = $('aiSnippetList'); snippets.replaceChildren();
    for (const item of state.project?.snippets || []) {
      const entry = document.createElement('div'); entry.className = 'ai-entry';
      const label = document.createElement('strong'); label.textContent = item.title;
      const code = document.createElement('pre'); code.textContent = item.code;
      const actions = document.createElement('div'); actions.append(button('Copy code', () => api.copyText(item.code).catch(uiError)));
      actions.append(button('Delete', async () => {
        if (!window.confirm('Delete this saved code?')) return;
        try { state.project = await api.aiDeleteSnippet(state.placeKey, item.id); render(); } catch (error) { uiError(error); }
      })); entry.append(label, code, actions); snippets.append(entry);
    }
    if (!state.project?.snippets.length) snippets.append(empty('Save Luau code blocks from a conversation.'));
  }
  function render() {
    renderThreads(); renderMessages(); renderEntries();
    $('aiPrompt').disabled = !state.placeKey;
    $('aiNewChat').disabled = !state.placeKey;
    renderAccount();
    for (const button of pane.querySelectorAll('.ai-tabs button')) button.setAttribute('aria-pressed', String(button.dataset.view === state.view));
    $('aiChatsView').hidden = state.view !== 'chats';
    $('aiMemoriesView').hidden = state.view !== 'memories';
    $('aiSnippetsView').hidden = state.view !== 'snippets';
  }
  async function sendMessage(event) {
    event.preventDefault();
    if (state.sending || !state.placeKey) return;
    const content = $('aiPrompt').value.trim();
    if (!content) return;
    if (!state.account?.connected || !state.selectedModel) { uiError(new Error('Connect ChatGPT and select a model.')); return; }
    const startedPlace = state.placeKey;
    try {
      if (!state.chatId) {
        state.project = await api.aiNewChat(state.placeKey, state.placeName);
        state.chatId = state.project.result;
      }
      state.sending = true; state.partial = ''; state.requestChatId = state.chatId;
      const chatId = state.chatId, placeKey = state.placeKey;
      $('aiPrompt').value = ''; $('aiRequestStatus').textContent = 'Generating response…'; render();
      const scriptContext = $('aiIncludeScript').checked ? getSelectedContext() : null;
      await api.aiSend({ placeKey, chatId, text: content, model: state.selectedModel, scriptContext });
      $('aiRequestStatus').textContent = 'Saved locally. Ctrl+Enter to send.';
    } catch (error) { uiError(error); }
    finally {
      state.sending = false; state.partial = '';
      if (state.placeKey === startedPlace) { try { state.project = await api.aiEnsureProject(startedPlace, state.placeName); } catch (error) { uiError(error); } }
      render();
    }
  }
  on(rail, 'click', () => toggle()); on($('aiClose'), 'click', () => toggle(false));
  on($('aiPlace'), 'change', () => {
    const key = $('aiPlace').value; const p = state.projects.find(p => p.placeKey === key);
    if (p) loadProject(key, p.name);
  });
  on($('aiLogin'), 'click', async () => {
    try {
      if (state.account?.connected) {
        const reply = await api.aiSignOut(); if (reply.warning) toast(reply.warning, true);
      } else await api.aiSignIn();
      await refreshModels();
    } catch (error) { uiError(error); }
  });
  on($('aiUsage'), 'click', () => api.aiOpenUsage().catch(uiError));
  on($('aiModel'), 'change', () => { state.selectedModel = $('aiModel').value; renderAccount(); });
  on($('aiNewChat'), 'click', async () => {
    if (!state.placeKey) return;
    try { state.project = await api.aiNewChat(state.placeKey, state.placeName); state.chatId = state.project.result; render(); $('aiPrompt').focus(); }
    catch (error) { uiError(error); }
  });
  for (const tab of pane.querySelectorAll('.ai-tabs button')) on(tab, 'click', () => { state.view = tab.dataset.view; render(); });
  on($('aiCompose'), 'submit', sendMessage);
  on($('aiPrompt'), 'keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) sendMessage(event); });
  on($('aiMemoryForm'), 'submit', async event => {
    event.preventDefault(); const value = $('aiMemoryText').value.trim();
    if (!value || !state.placeKey) return;
    try { state.project = await api.aiSaveMemory(state.placeKey, value); $('aiMemoryText').value = ''; render(); }
    catch (error) { uiError(error); }
  });
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { $('aiDictate').disabled = true; $('aiDictate').title = 'Speech dictation unavailable in this browser'; }
  else on($('aiDictate'), 'click', () => {
    const recognition = new SpeechRecognition(); recognition.lang = navigator.language || 'en-US';
    recognition.onresult = event => { $('aiPrompt').value = `${$('aiPrompt').value} ${event.results[0][0].transcript}`.trim(); $('aiPrompt').focus(); };
    recognition.onerror = event => { $('aiRequestStatus').textContent = `Speech recognition: ${event.error}`; };
    recognition.start();
  });
  on(window, 'keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey || event.key.toLowerCase() !== 'a') return;
    if (document.querySelector('dialog[open]')) return;
    event.preventDefault(); toggle();
  });
  // Pre-existing projects remain available even if Roblox Studio is disconnected.
  if (supported) refreshProjects().then(() => {
    const status = getStatus();
    const key = status?.ready ? projectKeyForPlace(status) : null;
    if (key) loadProject(key, status.placeName);
    else if (state.projects.length) loadProject(state.projects[0].placeKey, state.projects[0].name);
  }).catch(uiError);
  if (supported) refreshModels();
  else { state.account = { connected: false, secureStorage: false }; $('aiAuthDetail').textContent = 'Available in installed Windows app'; }
  render();

  return {
    onStatus(status) {
      const key = status?.ready ? projectKeyForPlace(status) : null;
      if (supported && key && key !== state.placeKey) loadProject(key, status.placeName);
      $('aiPlace').title = status?.placeKey === '0-0' ? 'Unpublished Places use their name as a temporary project identifier' : 'Previously connected Places';
    },
    onEvent(event) {
      if (supported && event.type === 'ai:account') {
        if (event.status?.error) uiError(new Error(event.status.error));
        refreshModels();
      }
      if (event.type === 'ai:delta' && state.sending && event.chatId === state.requestChatId && event.placeKey === state.placeKey) {
        if (state.partial.length + event.delta.length <= 128 * 1024) { state.partial += event.delta; scheduleMessageRender(); }
      }
    },
    dispose() { if (streamFrame) cancelAnimationFrame(streamFrame); for (const fn of cleanup) fn(); rail.remove(); pane.remove(); },
    toggle,
  };
}
