'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const handlers = new Map();
contextBridge.exposeInMainWorld('cursorBridge', {
  platform: process.platform,
  setWindowTheme: (name) => ipcRenderer.invoke('bridge:set-window-theme', name),
  copyText: (value) => ipcRenderer.invoke('bridge:copy-text', value),
  saveQuickApplyDraft: (text) => ipcRenderer.invoke('bridge:save-quick-apply-draft', text),
  getQuickApplyDraft: () => ipcRenderer.invoke('bridge:get-quick-apply-draft'),
  previewQuickApply: (text, overrides) => ipcRenderer.invoke('bridge:preview-quick-apply', text, overrides),
  applyQuickApply: (token) => ipcRenderer.invoke('bridge:apply-quick-apply', token),
  mutateHierarchy: (request) => ipcRenderer.invoke('bridge:mutate-hierarchy', request),
  getState: () => ipcRenderer.invoke('bridge:get-state'),
  requestSource: (id) => ipcRenderer.invoke('bridge:request-source', id),
  writeScript: (id, source, revision) => ipcRenderer.invoke('bridge:write-script', id, source, revision),
  saveDraft: (id, source, nodePath, placeKey) => ipcRenderer.invoke('bridge:save-draft', id, source, nodePath, placeKey),
  getDraft: (id) => ipcRenderer.invoke('bridge:get-draft', id),
  clearDraft: (id, expectedSource, force = false) => ipcRenderer.invoke('bridge:clear-draft', id, expectedSource, force),
  getBackups: (id) => ipcRenderer.invoke('bridge:list-backups', id),
  restoreBackup: (id, version, storageScriptId) => ipcRenderer.invoke('bridge:read-backup', id, version, storageScriptId),
  openStudioScript: (id) => ipcRenderer.invoke('bridge:open-studio-script', id),
  requestChildren: (id) => ipcRenderer.invoke('bridge:list-children', id),
  openBackupsFolder: () => ipcRenderer.invoke('bridge:open-backups-folder'),
  disconnect: () => ipcRenderer.invoke('bridge:disconnect'),
  checkForUpdates: () => ipcRenderer.invoke('bridge:check-updates'),
  getAppVersion: () => ipcRenderer.invoke('bridge:get-version'),
  aiListProjects: () => ipcRenderer.invoke('bridge:ai-list-projects'),
  aiEnsureProject: (key, name) => ipcRenderer.invoke('bridge:ai-ensure-project', key, name),
  aiNewChat: (key, name) => ipcRenderer.invoke('bridge:ai-new-chat', key, name),
  aiRenameChat: (key, id, title) => ipcRenderer.invoke('bridge:ai-rename-chat', key, id, title),
  aiDeleteChat: (key, id) => ipcRenderer.invoke('bridge:ai-delete-chat', key, id),
  aiSaveMemory: (key, text) => ipcRenderer.invoke('bridge:ai-save-memory', key, text),
  aiDeleteMemory: (key, id) => ipcRenderer.invoke('bridge:ai-delete-memory', key, id),
  aiSaveSnippet: (key, title, code) => ipcRenderer.invoke('bridge:ai-save-snippet', key, title, code),
  aiDeleteSnippet: (key, id) => ipcRenderer.invoke('bridge:ai-delete-snippet', key, id),
  aiAccountStatus: () => ipcRenderer.invoke('bridge:ai-account-status'),
  aiSignIn: () => ipcRenderer.invoke('bridge:ai-sign-in'),
  aiSignOut: () => ipcRenderer.invoke('bridge:ai-sign-out'),
  aiModels: () => ipcRenderer.invoke('bridge:ai-models'),
  aiSend: (request) => ipcRenderer.invoke('bridge:ai-send', request),
  aiOpenUsage: () => ipcRenderer.invoke('bridge:ai-open-usage'),
  aiOpenChatGPT: () => ipcRenderer.invoke('bridge:ai-open-chatgpt'),
  onEvent(callback) {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('bridge:event', listener);
    const token = Symbol('bridge-listener');
    handlers.set(token, listener);
    return () => {
      ipcRenderer.removeListener('bridge:event', listener);
      handlers.delete(token);
    };
  },
});
