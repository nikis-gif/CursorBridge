'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const handlers = new Map();
contextBridge.exposeInMainWorld('cursorBridge', {
  copyText: (value) => ipcRenderer.invoke('bridge:copy-text', value),
  previewQuickApply: (text, overrides) => ipcRenderer.invoke('bridge:preview-quick-apply', text, overrides),
  applyQuickApply: (token) => ipcRenderer.invoke('bridge:apply-quick-apply', token),
  mutateHierarchy: (request) => ipcRenderer.invoke('bridge:mutate-hierarchy', request),
  getState: () => ipcRenderer.invoke('bridge:get-state'),
  writeScript: (id, source, revision) => ipcRenderer.invoke('bridge:write-script', id, source, revision),
  saveDraft: (id, source, nodePath, placeKey) => ipcRenderer.invoke('bridge:save-draft', id, source, nodePath, placeKey),
  getDraft: (id) => ipcRenderer.invoke('bridge:get-draft', id),
  clearDraft: (id, expectedSource, force = false) => ipcRenderer.invoke('bridge:clear-draft', id, expectedSource, force),
  getBackups: (id) => ipcRenderer.invoke('bridge:list-backups', id),
  restoreBackup: (id, version, storageScriptId) => ipcRenderer.invoke('bridge:read-backup', id, version, storageScriptId),
  openStudioScript: (id) => ipcRenderer.invoke('bridge:open-studio-script', id),
  openBackupsFolder: () => ipcRenderer.invoke('bridge:open-backups-folder'),
  disconnect: () => ipcRenderer.invoke('bridge:disconnect'),
  checkForUpdates: () => ipcRenderer.invoke('bridge:check-updates'),
  getAppVersion: () => ipcRenderer.invoke('bridge:get-version'),
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
