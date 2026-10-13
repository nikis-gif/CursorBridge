'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, ipcMain, shell, dialog, clipboard, powerMonitor, screen } = require('electron');
const { autoUpdater } = require('electron-updater');
const { BridgeServer } = require('../bridge/bridge-server.cjs');
const { AIProjectStore } = require('./ai-project-store.cjs');
const { ChatGPTAuth } = require('./chatgpt-auth.cjs');
const { AIAssistant } = require('./ai-assistant.cjs');
const { isChatGPTSignInEnabled, CHATGPT_SIGN_IN_UNAVAILABLE } = require('./siwc-availability.cjs');
const { windowStyleForTheme } = require('./window-theme.cjs');
const { initialWindowBounds } = require('./window-bounds.cjs');

let mainWindow = null;
let bridge = null;
let aiProjects = null;
let chatgptAuth = null;
let aiAssistant = null;
let aiInitError = null;
let updateCheckActive = false;
let updateDownloaded = false;
let installingUpdate = false;
let shutdownStarted = false;

const acquiredLock = app.requestSingleInstanceLock();
if (!acquiredLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

const ROOT = path.join(__dirname, '..');
const CHATGPT_SIGN_IN_ENABLED = isChatGPTSignInEnabled({
  packaged: app.isPackaged,
  developerOptIn: process.env.CURSOR_BRIDGE_DEV_SIWC === '1',
});
function requireChatGPTSignIn() {
  if (!CHATGPT_SIGN_IN_ENABLED) throw new Error(CHATGPT_SIGN_IN_UNAVAILABLE);
}
const DEV_URL = process.env.CURSOR_DEV_URL;

function isPublishConfigured() {
  // electron-builder writes the effective release provider into the packaged resources.
  const configFile = path.join(process.resourcesPath, 'app-update.yml');
  try {
    const configuration = fs.readFileSync(configFile, 'utf8');
    return configuration.includes('github') && !configuration.includes('REPLACE_WITH_');
  } catch {
    return false;
  }
}

function sendToRenderer(event) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('bridge:event', event);
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'Cursor Bridge',
    ...initialWindowBounds(screen.getPrimaryDisplay().workArea),
    backgroundColor: '#0b0b0d',
    titleBarStyle: 'hidden',
    ...(process.platform !== 'darwin' ? { titleBarOverlay: windowStyleForTheme('obsidian') } : {}),
    show: false,
    icon: path.join(ROOT, 'assets', 'CursorIcon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      backgroundThrottling: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  if (DEV_URL && !app.isPackaged) {
    await mainWindow.loadURL(DEV_URL);
  } else {
    await mainWindow.loadFile(path.join(ROOT, 'dist-renderer', 'index.html'));
  }
  mainWindow.on('closed', () => { mainWindow = null; });
}

function registerIpc() {
  const actions = {
    'bridge:set-window-theme': (event, name) => {
      if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents ||
          event.senderFrame !== mainWindow.webContents.mainFrame) return { ok: false };
      const style = windowStyleForTheme(name);
      if (!style) return { ok: false };
      if (process.platform !== 'darwin') mainWindow.setTitleBarOverlay(style);
      mainWindow.setBackgroundColor(style.color);
      return { ok: true };
    },
    'bridge:copy-text': (_event, value) => {
      if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 512 * 1024) {
        throw new Error('Clipboard text must be at most 512 KiB.');
      }
      clipboard.writeText(value);
      return { ok: true };
    },
    'bridge:get-state': () => bridge.getState(),
    'bridge:request-source': (_event, id) => bridge.requestSource(id),
    'bridge:save-quick-apply-draft': (_event, text) => bridge.saveQuickApplyDraft(text),
    'bridge:get-quick-apply-draft': () => bridge.getQuickApplyDraft(),
    'bridge:preview-quick-apply': (_event, text, overrides) => bridge.previewQuickApply(text, overrides),
    'bridge:apply-quick-apply': (_event, token) => bridge.applyQuickApply(token),
    'bridge:mutate-hierarchy': (_event, request) => bridge.mutateHierarchy(request),
    'bridge:write-script': (_event, id, source, revision) => bridge.writeScript(id, source, revision),
    'bridge:save-draft': (_event, id, source, nodePath, placeKey) => bridge.saveDraft(id, source, nodePath, placeKey),
    'bridge:get-draft': (_event, id) => bridge.getDraft(id),
    'bridge:clear-draft': (_event, id, expectedSource, force) => bridge.clearDraft(id, expectedSource, force),
    'bridge:list-backups': (_event, id) => bridge.listBackups(id),
    'bridge:read-backup': (_event, id, version, storageScriptId) => bridge.restoreBackup(id, version, storageScriptId),
    'bridge:open-studio-script': (_event, id) => bridge.openStudioScript(id),
    'bridge:list-children': (_event, id) => bridge.requestChildren(id),
    'bridge:open-backups-folder': () => shell.openPath(bridge.storage.backupsPath),
    'bridge:disconnect': () => bridge.disconnect('application-user-disconnected'),
    'bridge:check-updates': () => checkForUpdates(true),
    'bridge:get-version': () => app.getVersion(),
    'bridge:ai-list-projects': () => aiProjects.list(),
    'bridge:ai-ensure-project': (_event, key, name) => aiProjects.ensure(key, name),
    'bridge:ai-new-chat': (_event, key, name) => aiProjects.createChat(key, name),
    'bridge:ai-rename-chat': (_event, key, id, title) => aiProjects.renameChat(key, id, title),
    'bridge:ai-delete-chat': (_event, key, id) => aiProjects.deleteChat(key, id),
    'bridge:ai-save-memory': (_event, key, text) => aiProjects.saveMemory(key, text),
    'bridge:ai-delete-memory': (_event, key, id) => aiProjects.deleteMemory(key, id),
    'bridge:ai-save-snippet': (_event, key, title, code) => aiProjects.saveSnippet(key, title, code),
    'bridge:ai-delete-snippet': (_event, key, id) => aiProjects.deleteSnippet(key, id),
    'bridge:ai-account-status': () => CHATGPT_SIGN_IN_ENABLED
      ? { ...chatgptAuth.status(), available: true, error: aiInitError }
      : { connected: false, pending: false, secureStorage: false,
        available: false, reason: CHATGPT_SIGN_IN_UNAVAILABLE },
    'bridge:ai-sign-in': () => {
      requireChatGPTSignIn();
      if (aiInitError) throw new Error(`ChatGPT sign-in unavailable: ${aiInitError}`);
      return chatgptAuth.startSignIn();
    },
    'bridge:ai-sign-out': () => CHATGPT_SIGN_IN_ENABLED ? chatgptAuth.signOut() : { ok: true },
    'bridge:ai-models': () => { requireChatGPTSignIn(); return aiAssistant.models(true); },
    'bridge:ai-send': async (_event, request) => {
      requireChatGPTSignIn();
      if (request?.scriptContext) {
        const { canUseScriptContext } = await import('../shared/place-project-key.mjs');
        if (!canUseScriptContext(request.placeKey, bridge.getStatus())) {
          throw new Error('Script context is available only for the currently connected Place.');
        }
      }
      return aiAssistant.send(request);
    },
    'bridge:ai-open-usage': () => shell.openExternal('https://chatgpt.com/#settings/Usage'),
    'bridge:ai-open-chatgpt': () => shell.openExternal('https://chatgpt.com/'),
  };
  for (const [name, action] of Object.entries(actions)) {
    ipcMain.handle(name, action);
  }
}

async function checkForUpdates(manual = false) {
  if (!app.isPackaged) return { ok: false, reason: 'Updates are available in the installed Windows build only.' };
  if (!isPublishConfigured()) return { ok: false, reason: 'Set your GitHub owner in package.json and build a release.' };
  if (updateCheckActive) return { ok: false, reason: 'An update check is already running.' };
  updateCheckActive = true;
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true, reason: 'Update check completed.' };
  } catch (error) {
    if (manual) await dialog.showMessageBox(mainWindow, {
      type: 'warning', title: 'Update check unavailable', message: error.message,
    });
    return { ok: false, reason: error.message };
  } finally {
    updateCheckActive = false;
  }
}

function configureUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('update-available', async (info) => {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question', buttons: ['Download update', 'Later'], defaultId: 0, cancelId: 1,
      title: 'Cursor Bridge update',
      message: `Cursor Bridge ${info.version} is available.`,
      detail: 'Download the GitHub release now? Studio scripts and drafts remain backed up locally.',
    });
    if (response === 0) {
      autoUpdater.downloadUpdate().catch((error) => sendToRenderer({ type: 'update', message: error.message }));
    }
  });
  autoUpdater.on('download-progress', (progress) => {
    sendToRenderer({ type: 'update', message: `Downloading update: ${Math.round(progress.percent)}%` });
  });
  autoUpdater.on('update-downloaded', async (info) => {
    updateDownloaded = true;
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question', buttons: ['Restart and install', 'Later'], cancelId: 1,
      title: 'Ready to install',
      message: `Cursor Bridge ${info.version} is ready.`,
      detail: 'Restarting disconnects the current Roblox Studio session. Unsynced drafts will remain in local recovery storage.',
    });
    if (response === 0) {
      await bridge.disconnect('application-updating');
      installingUpdate = true;
      autoUpdater.quitAndInstall(false, true);
    }
  });
  autoUpdater.on('error', (error) => sendToRenderer({ type: 'update', message: `Update error: ${error.message}` }));
}

if (acquiredLock) {
  app.whenReady().then(async () => {
    // All project data stays in Electron userData. Tokens stay encrypted in the main process.
    aiProjects = new AIProjectStore(app.getPath('userData'));
    chatgptAuth = new ChatGPTAuth({
      userData: app.getPath('userData'), safeStorage: require('electron').safeStorage,
      openExternal: (url) => shell.openExternal(url),
      onChange: (status) => {
        aiAssistant?.invalidateModels();
        if (!status.connected) aiAssistant?.abortAll();
        sendToRenderer({ type: 'ai:account', status });
      },
    });
    if (CHATGPT_SIGN_IN_ENABLED) {
      try { await chatgptAuth.init(); }
      catch (error) { aiInitError = error.message; console.error('ChatGPT sign-in disabled:', error.message); }
    }
    aiAssistant = new AIAssistant({
      auth: chatgptAuth, projects: aiProjects,
      onDelta: (event) => sendToRenderer({ type: 'ai:delta', ...event }),
    });
    bridge = new BridgeServer({ storageDir: app.getPath('userData') });
    bridge.on('event', sendToRenderer);
    try {
      await bridge.start();
    } catch (error) {
      dialog.showErrorBox('Cursor Bridge failed to start',
        `Cannot bind the local bridge port. Close other instances or free port 38471.\n\n${error.message}`);
      app.quit();
      return;
    }
    powerMonitor.on('suspend', () => bridge.suspendForSleep());
    powerMonitor.on('resume', () => bridge.resumeFromSleep());
    registerIpc();
    configureUpdater();
    await createWindow();
    if (app.isPackaged) {
      setTimeout(() => checkForUpdates(), 15_000).unref();
      setInterval(() => checkForUpdates(), 6 * 60 * 60 * 1000).unref();
    }
  }).catch((error) => {
    dialog.showErrorBox('Cursor Bridge error', error.message);
    app.quit();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (installingUpdate || shutdownStarted || !bridge) return;
    event.preventDefault();
    shutdownStarted = true;
    chatgptAuth?.close();
    bridge.close().catch((error) => console.error(error)).finally(() => app.quit());
  });
}
