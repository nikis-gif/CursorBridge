'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, ipcMain, shell, dialog, clipboard } = require('electron');
const { autoUpdater } = require('electron-updater');
const { BridgeServer } = require('../bridge/bridge-server.cjs');

let mainWindow = null;
let bridge = null;
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
    width: 1440, height: 890,
    minWidth: 1000, minHeight: 680,
    backgroundColor: '#08080a',
    show: false,
    icon: path.join(ROOT, 'assets', 'CursorIcon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
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
    'bridge:copy-text': (_event, value) => clipboard.writeText(String(value).slice(0, 16 * 1024)),
    'bridge:get-state': () => bridge.getState(),
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
    'bridge:open-backups-folder': () => shell.openPath(bridge.storage.backupsPath),
    'bridge:disconnect': () => bridge.disconnect('application-user-disconnected'),
    'bridge:check-updates': () => checkForUpdates(true),
    'bridge:get-version': () => app.getVersion(),
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
    bridge.close().catch((error) => console.error(error)).finally(() => app.quit());
  });
}
