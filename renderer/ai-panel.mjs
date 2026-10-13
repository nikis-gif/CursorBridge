import { icon } from './icons.js';
import { projectKeyForPlace, canUseScriptContext } from './place-project-key.mjs';
import './ai-panel.css';

// Lightweight, isolated AI surface. No direct HTTP requests or credentials in renderer.
export function mountAssistant({ api, getStatus, getSelectedContext, getSelectedScriptForSaving, toast }) {
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
      <div class="ai-heading-title"><strong>Project chat</strong><span id="aiProjectHint" class="ai-heading-subtitle">Choose a Place</span></div>
      <div class="ai-heading-actions">
        <button type="button" id="aiHistoryToggle" class="ai-icon" title="Conversation history" aria-label="Conversation history" aria-expanded="false" aria-controls="aiHistoryDrawer">${icon('history')}</button>
        <button type="button" id="aiNewChat" class="ai-icon" title="New chat" aria-label="New chat">${icon('plus')}</button>
        <button type="button" id="aiSettingsToggle" class="ai-icon" title="ChatGPT settings" aria-label="ChatGPT settings" aria-expanded="false" aria-controls="aiSettingsPanel">${icon('sliders')}</button>
        <button type="button" id="aiClose" class="ai-icon" title="Close (Ctrl+Shift+A)" aria-label="Close chat panel">${icon('close')}</button>
      </div>
    </header>
    <div class="ai-project-row"><label class="ai-sr-only" for="aiPlace">Place project</label>
      <select id="aiPlace" aria-label="Choose a Place" title="Previously connected Places"></select></div>
    <section class="ai-settings-panel" id="aiSettingsPanel" aria-label="ChatGPT account settings" hidden>
      <div class="ai-auth-row">
        <div class="ai-auth-status"><span id="aiLoginStatus">Checking account…</span><small id="aiAuthDetail"></small></div>
        <button class="ai-subtle-button" type="button" id="aiLogin">Connect</button>
      </div>
      <div class="ai-model-row" id="aiModelRow" hidden><label for="aiModel">Model</label>
        <select id="aiModel" disabled><option value="">No models</option></select>
        <button type="button" class="ai-usage-link" id="aiUsage" title="Open ChatGPT usage settings">Usage</button>
      </div>
    </section>
    <nav class="ai-tabs" aria-label="Project views">
      <button type="button" data-view="chats" aria-pressed="true">Chat</button>
      <button type="button" data-view="snippets" aria-pressed="false">Code</button>
      <button type="button" data-view="memories" aria-pressed="false">Notes</button>
    </nav>
    <section class="ai-history-panel" id="aiHistoryDrawer" aria-label="Conversation history" hidden>
      <div class="ai-history-header"><strong>History</strong><button type="button" id="aiHistoryClose" class="ai-icon" title="Close history" aria-label="Close history">${icon('close', 14)}</button></div>
      <div class="ai-threads" id="aiThreads" aria-label="Saved conversations"></div>
    </section>
    <div class="ai-view ai-chat-view" id="aiChatsView">
      <div class="ai-message-list" id="aiMessages" role="log" aria-live="polite" aria-label="Conversation"></div>
      <div id="aiAvailability" class="ai-availability" hidden>
        <strong id="aiUnavailableTitle">Chat unavailable</strong>
        <span id="aiUnavailableDetail">You can still use your saved code and notes.</span>
        <button type="button" id="aiUnavailableAction" class="ai-subtle-button">Open ChatGPT in browser</button>
      </div>
      <form class="ai-compose" id="aiCompose" hidden>
        <label class="ai-sr-only" for="aiPrompt">Message</label>
        <textarea id="aiPrompt" rows="2" placeholder="Ask about this Place…" maxlength="32000"></textarea>
        <div class="ai-compose-footer">
          <label class="ai-context-choice" title="Only include the selected script with your permission"><input type="checkbox" id="aiIncludeScript" /> Include script</label>
          <div class="ai-compose-actions">
            <button type="button" class="ai-icon" id="aiDictate" title="Dictate" aria-label="Dictate message">${icon('mic', 16)}</button>
            <button type="submit" class="ai-primary" id="aiSubmit" title="Send (Ctrl+Enter)">Send ${icon('arrow-up', 14)}</button>
          </div>
        </div>
        <small class="ai-footnote" id="aiRequestStatus" role="status" aria-live="polite"></small>
      </form>
    </div>
    <div class="ai-view ai-settings-view" id="aiMemoriesView" hidden>
      <form class="ai-inline-form" id="aiMemoryForm">
        <label class="ai-sr-only" for="aiMemoryText">Project note</label>
        <textarea id="aiMemoryText" rows="3" placeholder="Project conventions and decisions…" maxlength="5000"></textarea>
        <button class="ai-primary" type="submit">Save note</button>
      </form>
      <div id="aiMemoryList" class="ai-entries"></div>
    </div>
    <div class="ai-view ai-settings-view" id="aiSnippetsView" hidden>
      <button type="button" class="ai-subtle-button ai-save-script" id="aiSaveActiveScript" disabled>Save active script</button>
      <div id="aiSnippetList" class="ai-entries"></div>
    </div>
  `;
  document.querySelector('.workbench').append(pane);
  const $ = id => pane.querySelector(`#${id}`);
  const supported = typeof api?.aiListProjects === 'function' && typeof api?.aiAccountStatus === 'function';
  const state = { open: false, view: 'chats', placeKey: null, placeName: '', project: null, projects: [], chatId: null,
    account: null, models: [], selectedModel: '', sending: false, partial: '', requestChatId: null, changeId: 0 };
  const cleanup = [];
  let streamFrame = 0;
  let modelRefreshId = 0;
  const scheduleMessageRender = () => {
    if (streamFrame) return;
    streamFrame = requestAnimationFrame(() => {
      streamFrame = 0;
      if (!state.sending || state.chatId !== state.requestChatId) return;
      const list = $('aiMessages');
      const content = list.querySelector('.ai-message.pending .ai-text-block');
      if (!content) return;
      const pinnedToBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
      content.replaceWith(textBlock(state.partial || '…'));
      if (pinnedToBottom) list.scrollTop = list.scrollHeight;
    });
  };
  const on = (node, event, fn) => { node.addEventListener(event, fn); cleanup.push(() => node.removeEventListener(event, fn)); };
  const uiError = error => { $('aiRequestStatus').textContent = error?.message || String(error); toast(error?.message || String(error), true); };
  const empty = (text) => { const el = document.createElement('p'); el.className = 'ai-empty'; el.textContent = text; return el; };
  const button = (label, action, title = label) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'ai-text-action'; b.textContent = label; b.title = title; b.addEventListener('click', action); return b; };

  function setHistoryOpen(open) {
    $('aiHistoryDrawer').hidden = !open;
    $('aiHistoryToggle').setAttribute('aria-expanded', String(open));
    if (open) { setSettingsOpen(false); $('aiHistoryClose').focus(); }
  }
  function setSettingsOpen(open) {
    $('aiSettingsPanel').hidden = !open;
    $('aiSettingsToggle').setAttribute('aria-expanded', String(open));
    if (open) setHistoryOpen(false);
  }
  function toggle(force = !state.open) {
    state.open = Boolean(force); pane.hidden = !state.open;
    rail.setAttribute('aria-pressed', String(state.open));
    if (!state.open) { setHistoryOpen(false); setSettingsOpen(false); return; }
    if (supported) refreshModels();
    const target = $('aiCompose').hidden ? $('aiPlace') : $('aiPrompt');
    target.focus();
  }
  function renderPlaces() {
    const select = $('aiPlace'); select.replaceChildren();
    if (!state.projects.length) { const o = new Option('Connect a Place to start', ''); select.add(o); $('aiProjectHint').textContent = 'No Place connected'; return; }
    for (const p of state.projects) select.add(new Option(p.name || p.placeKey, p.placeKey));
    if (state.placeKey && state.projects.some(p => p.placeKey === state.placeKey)) select.value = state.placeKey;
    $('aiProjectHint').textContent = state.placeName || 'Choose a Place';
  }
  function renderAccount() {
    const a = state.account;
    const connected = Boolean(a?.connected);
    const available = a?.available !== false;
    const usable = connected && Boolean(state.selectedModel);
    $('aiLoginStatus').textContent = !available ? 'ChatGPT not available' :
      connected ? (a.displayName || a.email || 'ChatGPT connected') : 'ChatGPT not connected';
    $('aiAuthDetail').textContent = !available ? 'Account integration is disabled in this release.' :
      connected ? (a.email || 'Using your connected ChatGPT plan') :
      a?.error ? String(a.error).slice(0, 160) : 'Sign in with your ChatGPT account';
    $('aiLogin').textContent = !available ? 'Unavailable' : connected ? 'Sign out' : a?.pending ? 'Opening…' : 'Connect';
    $('aiLogin').disabled = !supported || !available || Boolean(a?.pending || (a && !a.secureStorage));
    $('aiModelRow').hidden = !connected;
    const select = $('aiModel'); select.replaceChildren();
    if (!state.models.length) select.add(new Option('No models available', ''));
    else for (const m of state.models) select.add(new Option(m.name, m.id));
    select.disabled = !state.models.length;
    if (state.models.some(m => m.id === state.selectedModel)) select.value = state.selectedModel;
    $('aiCompose').hidden = !usable;
    $('aiAvailability').hidden = usable;
    $('aiSubmit').disabled = state.sending || !state.placeKey || !usable;
    $('aiNewChat').disabled = state.sending || !state.placeKey || !usable;
    const title = $('aiUnavailableTitle');
    const detail = $('aiUnavailableDetail');
    const action = $('aiUnavailableAction');
    if (a === null) {
      title.textContent = 'Checking ChatGPT connection…';
      detail.textContent = '';
      action.hidden = true;
    } else if (!available || !supported) {
      title.textContent = 'ChatGPT chat is unavailable';
      detail.textContent = 'Use Code and Notes here, or open ChatGPT in your browser.';
      action.textContent = 'Open ChatGPT in browser';
      action.hidden = false; action.disabled = !api?.aiOpenChatGPT;
    } else if (!connected) {
      title.textContent = 'Connect ChatGPT to start a chat';
      detail.textContent = 'Your local projects remain separate from ChatGPT history.';
      action.textContent = 'Continue with ChatGPT';
      action.hidden = false; action.disabled = $('aiLogin').disabled;
    } else {
      title.textContent = 'No model available';
      detail.textContent = 'Check your account permissions and usage.';
      action.textContent = 'Account settings';
      action.hidden = false; action.disabled = false;
    }
  }
  async function refreshModels() {
    const requestId = ++modelRefreshId;
    try {
      const account = await api.aiAccountStatus();
      const models = account.connected ? await api.aiModels() : [];
      if (requestId !== modelRefreshId) return;
      state.account = account;
      state.models = models;
      if (!models.some(m => m.id === state.selectedModel)) state.selectedModel = models[0]?.id || '';
      renderAccount();
    } catch (error) {
      if (requestId !== modelRefreshId) return;
      state.models = []; state.selectedModel = ''; renderAccount(); uiError(error);
    }
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
      setHistoryOpen(false); await refreshProjects(); render();
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
      const trigger = button(chat.title, () => { state.chatId = chat.id; state.partial = ''; setHistoryOpen(false); render(); });
      trigger.className = 'ai-thread-name'; trigger.title = chat.title;
      const rename = button('Rename', async () => {
        const value = window.prompt('Conversation name', chat.title);
        if (value === null || !value.trim()) return;
        try { state.project = await api.aiRenameChat(state.placeKey, chat.id, value); render(); }
        catch (error) { uiError(error); }
      });
      rename.innerHTML = icon('edit', 13); rename.title = 'Rename conversation'; rename.setAttribute('aria-label', `Rename ${chat.title}`);
      const remove = button('Delete', async () => {
        if (!window.confirm(`Delete “${chat.title}” from this PC?`)) return;
        try { state.project = await api.aiDeleteChat(state.placeKey, chat.id); if (state.chatId === chat.id) state.chatId = state.project.chats[0]?.id || null; render(); }
        catch (error) { uiError(error); }
      });
      if (state.sending && chat.id === state.requestChatId) remove.disabled = true;
      remove.innerHTML = icon('trash', 13); remove.title = 'Delete conversation'; remove.setAttribute('aria-label', `Delete ${chat.title}`);
      row.append(trigger, rename, remove); list.append(row);
    }
    if (!state.project?.chats.length) list.append(empty('No conversations yet.'));
  }
  function renderMessages() {
    const list = $('aiMessages'); list.replaceChildren();
    const chat = state.project?.chats.find(c => c.id === state.chatId);
    if (!chat) { list.append(empty('No conversations yet.')); return; }
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
  function updateScriptContextChoice() {
    const input = $('aiIncludeScript');
    const allowed = canUseScriptContext(state.placeKey, getStatus());
    input.disabled = !allowed;
    if (!allowed) input.checked = false;
    input.title = allowed ? 'Include the selected script from this Place' : 'Connect to this Place to include live script context';
    $('aiSaveActiveScript').disabled = !allowed;
  }
  function render() {
    renderThreads(); renderMessages(); renderEntries();
    updateScriptContextChoice();
    $('aiPrompt').disabled = !state.placeKey;
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
    // Freeze the destination before any IPC await: users can switch Place while a chat is created.
    const placeKey = state.placeKey, placeName = state.placeName, model = state.selectedModel;
    const scriptContext = $('aiIncludeScript').checked && canUseScriptContext(placeKey, getStatus())
      ? getSelectedContext() : null;
    let chatId = state.chatId;
    state.sending = true; state.partial = ''; state.requestChatId = chatId;
    $('aiPrompt').value = ''; $('aiRequestStatus').textContent = 'Preparing conversation…'; render();
    try {
      if (!chatId) {
        const created = await api.aiNewChat(placeKey, placeName);
        chatId = created.result;
        if (state.placeKey === placeKey) { state.project = created; state.chatId = chatId; }
      }
      state.requestChatId = chatId;
      if (state.placeKey === placeKey) { $('aiRequestStatus').textContent = 'Generating response…'; render(); }
      await api.aiSend({ placeKey, chatId, text: content, model, scriptContext });
      if (state.placeKey === placeKey) $('aiRequestStatus').textContent = 'Saved locally. Ctrl+Enter to send.';
    } catch (error) {
      if (state.placeKey === placeKey) uiError(error);
      else toast(error?.message || String(error), true);
    } finally {
      state.sending = false; state.partial = ''; state.requestChatId = null;
      try {
        const refreshed = await api.aiEnsureProject(placeKey, placeName);
        if (state.placeKey === placeKey) state.project = refreshed;
      } catch (error) { uiError(error); }
      render();
    }
  }
  on(rail, 'click', () => toggle()); on($('aiClose'), 'click', () => toggle(false));
  on($('aiHistoryToggle'), 'click', () => setHistoryOpen($('aiHistoryDrawer').hidden));
  on($('aiHistoryClose'), 'click', () => { setHistoryOpen(false); $('aiHistoryToggle').focus(); });
  on($('aiSettingsToggle'), 'click', () => setSettingsOpen($('aiSettingsPanel').hidden));
  on($('aiUnavailableAction'), 'click', async () => {
    try {
      if (state.account?.available === false || !supported) await api.aiOpenChatGPT();
      else if (!state.account?.connected) { await api.aiSignIn(); await refreshModels(); }
      else setSettingsOpen(true);
    } catch (error) { uiError(error); }
  });
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
  on($('aiSaveActiveScript'), 'click', async () => {
    const key = state.placeKey;
    if (!canUseScriptContext(key, getStatus())) { uiError(new Error('Connect to this Place before saving its script.')); return; }
    const selected = getSelectedScriptForSaving?.();
    if (!selected || typeof selected.source !== 'string') { uiError(new Error('Open a script in the editor first.')); return; }
    const name = String(selected.path || 'Script').split('/').at(-1).slice(0, 150);
    try {
      const project = await api.aiSaveSnippet(key, `Script: ${name}`, selected.source);
      if (state.placeKey === key) { state.project = project; render(); }
      $('aiRequestStatus').textContent = 'Script saved locally.';
    } catch (error) { uiError(error); }
  });
  on($('aiModel'), 'change', () => { state.selectedModel = $('aiModel').value; renderAccount(); });
  on($('aiNewChat'), 'click', async () => {
    if (!state.placeKey || state.sending || !state.account?.connected || !state.selectedModel) return;
    try { state.project = await api.aiNewChat(state.placeKey, state.placeName); state.chatId = state.project.result; render(); $('aiPrompt').focus(); }
    catch (error) { uiError(error); }
  });
  for (const tab of pane.querySelectorAll('.ai-tabs button')) on(tab, 'click', () => {
    state.view = tab.dataset.view; setHistoryOpen(false); setSettingsOpen(false); render();
  });
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
    if (event.key === 'Escape' && state.open) { setHistoryOpen(false); setSettingsOpen(false); }
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
  else { state.account = { connected: false, available: false, secureStorage: false }; }
  render();

  return {
    onStatus(status) {
      const key = status?.ready ? projectKeyForPlace(status) : null;
      if (supported && key && key !== state.placeKey) loadProject(key, status.placeName);
      updateScriptContextChoice();
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
