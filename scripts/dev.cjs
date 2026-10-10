'use strict';

const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const VITE_URL = 'http://127.0.0.1:5173';
const VITE_ENTRY = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const electronBinary = require('electron');

const vite = spawn(process.execPath, [VITE_ENTRY, '--host', '127.0.0.1'], {
  cwd: ROOT, stdio: 'inherit', env: process.env,
});
let electron = null;
let stopped = false;

function shutdown() {
  if (stopped) return;
  stopped = true;
  if (electron && !electron.killed) electron.kill();
  if (!vite.killed) vite.kill();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
vite.on('exit', () => { if (!stopped) shutdown(); });

async function waitForRenderer() {
  for (let n = 0; n < 80 && !stopped; n++) {
    const ready = await new Promise((resolve) => {
      const request = http.get(VITE_URL, (response) => {response.resume();resolve(response.statusCode === 200);});
      request.setTimeout(1000, () => request.destroy());
      request.on('error', () => resolve(false));
    });
    if (ready) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

(async () => {
  if (!await waitForRenderer()) {console.error('Vite did not start.');shutdown();return;}
  electron = spawn(electronBinary, ['.'], {
    cwd: ROOT, stdio: 'inherit', env: { ...process.env, CURSOR_DEV_URL: VITE_URL },
  });
  electron.on('exit', () => {shutdown();});
})().catch((error) => {console.error(error);shutdown();});
