'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { promisify } = require('node:util');
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const MAX_VERSIONS_PER_SCRIPT = 50;

function safeId(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
}

async function atomicWrite(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tempPath, data, { flag: 'wx' });
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

class BackupStore {
  constructor(root) {
    this.root = root;
    this.backupsPath = path.join(root, 'backups');
    this.draftsPath = path.join(root, 'drafts');
  }

  async init() {
    await fs.mkdir(this.backupsPath, { recursive: true });
    await fs.mkdir(this.draftsPath, { recursive: true });
  }

  async saveQuickApplyBundle({ placeKey, text, count }) {
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 512 * 1024) {
      throw new Error('Invalid Quick Apply recovery bundle.');
    }
    const folder = path.join(this.backupsPath, 'quick-apply', safeId(placeKey));
    const identifier = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}`;
    const file = path.join(folder, `${identifier}.txt`);
    await atomicWrite(file, text);
    await atomicWrite(`${file}.json`, JSON.stringify({ placeKey, count,
      savedAt: new Date().toISOString(), sha256: crypto.createHash('sha256').update(text).digest('hex'),
    }, null, 2));
    return file;
  }

  async saveVersion({ placeKey, scriptId, source, nodePath, reason }) {
    if (typeof source !== 'string') return null;
    const folder = path.join(this.backupsPath, 'scripts', safeId(placeKey), safeId(scriptId));
    await fs.mkdir(folder, { recursive: true });
    const identifier = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}`;
    const file = path.join(folder, `${identifier}.luau`);
    await atomicWrite(file, source);
    await atomicWrite(`${file}.json`, JSON.stringify({
      at: new Date().toISOString(), scriptId, placeKey, path: nodePath,
      reason, bytes: Buffer.byteLength(source, 'utf8'),
      sha256: crypto.createHash('sha256').update(source).digest('hex'),
    }, null, 2));
    await this.prune(folder);
    return file;
  }

  async prune(folder) {
    const names = (await fs.readdir(folder)).filter((name) => name.endsWith('.luau')).sort();
    const expired = names.slice(0, Math.max(0, names.length - MAX_VERSIONS_PER_SCRIPT));
    await Promise.all(expired.flatMap((name) => [
      fs.rm(path.join(folder, name), { force: true }),
      fs.rm(path.join(folder, `${name}.json`), { force: true }),
    ]));
  }

  async saveDraft({ placeKey, scriptId, source, nodePath }) {
    if (typeof source !== 'string') throw new Error('Draft source must be text.');
    const file = path.join(this.draftsPath, safeId(placeKey), `${safeId(scriptId)}.json`);
    await atomicWrite(file, JSON.stringify({
      scriptId, placeKey, path: nodePath, savedAt: new Date().toISOString(), source,
    }));
    return file;
  }

  async clearDraft(placeKey, scriptId) {
    await fs.rm(path.join(this.draftsPath, safeId(placeKey), `${safeId(scriptId)}.json`), { force: true });
  }

  async getDraft(placeKey, scriptId) {
    try {
      const contents = await fs.readFile(path.join(this.draftsPath, safeId(placeKey), `${safeId(scriptId)}.json`), 'utf8');
      return JSON.parse(contents);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async findDraftByPath(placeKey, scriptId, nodePath) {
    const exact = await this.getDraft(placeKey, scriptId);
    if (exact || !nodePath) return exact;
    // Runtime instance IDs change between Studio sessions. We only recover by
    // path when there is exactly one match; duplicate sibling names are ambiguous.
    const folder = path.join(this.draftsPath, safeId(placeKey));
    let names;
    try { names = await fs.readdir(folder); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    const matches = [];
    for (const name of names.slice(0, 2500)) {
      if (!name.endsWith('.json') || name === `${safeId(scriptId)}.json`) continue;
      try {
        const draft = JSON.parse(await fs.readFile(path.join(folder, name), 'utf8'));
        if (draft.path === nodePath && typeof draft.source === 'string') {
          matches.push({...draft, fromPreviousSession: true});
          if (matches.length > 1) return null;
        }
      } catch { /* A partially-written recovery file cannot block other drafts. */ }
    }
    return matches[0] || null;
  }

  async listVersions(placeKey, scriptId, nodePath = null) {
    const placeFolder = path.join(this.backupsPath, 'scripts', safeId(placeKey));
    const directId = safeId(scriptId);
    const folderIds = [directId];
    // Runtime instance IDs change after Studio restarts. Recover history by exact
    // hierarchy path when no persistent instance GUID is stored in the place.
    if (nodePath) {
      try {
        const directories = await fs.readdir(placeFolder, { withFileTypes: true });
        for (const directory of directories.slice(0, 2500)) {
          if (!directory.isDirectory() || directory.name === directId) continue;
          const folder = path.join(placeFolder, directory.name);
          const newest = (await fs.readdir(folder)).filter((name) => name.endsWith('.luau.json')).sort().pop();
          if (!newest) continue;
          try {
            const metadata = JSON.parse(await fs.readFile(path.join(folder, newest), 'utf8'));
            if (metadata.path === nodePath) folderIds.push(directory.name);
          } catch { /* A partial backup should not hide other history. */ }
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    const versions = [];
    for (const folderId of folderIds) {
      const folder = path.join(placeFolder, folderId);
      let files;
      try {
        files = (await fs.readdir(folder)).filter((name) => name.endsWith('.luau')).sort().reverse();
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      for (const name of files.slice(0, MAX_VERSIONS_PER_SCRIPT)) {
        try {
          const meta = JSON.parse(await fs.readFile(path.join(folder, `${name}.json`), 'utf8'));
          if (nodePath && meta.path !== nodePath) continue;
          versions.push({ id: name, storageScriptId: folderId, fromPreviousSession: folderId !== directId,
            at: meta.at, reason: meta.reason, bytes: meta.bytes, path: meta.path });
        } catch { /* Ignore incomplete backup pairs. */ }
      }
    }
    return versions.sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_VERSIONS_PER_SCRIPT);
  }

  async readVersion(placeKey, scriptId, versionId) {
    if (!/^[A-Za-z0-9_.-]+\.luau$/.test(versionId) || versionId.includes('..')) {
      throw new Error('Invalid backup version.');
    }
    if (safeId(scriptId) !== scriptId) throw new Error('Invalid backup script identifier.');
    return fs.readFile(path.join(this.backupsPath, 'scripts', safeId(placeKey), scriptId, versionId), 'utf8');
  }

  async saveRecoverySnapshot(data) {
    const body = await gzip(Buffer.from(JSON.stringify({ savedAt: new Date().toISOString(), data }), 'utf8'));
    await atomicWrite(path.join(this.backupsPath, 'recovery', 'latest.json.gz'), body);
  }

  async loadRecoverySnapshot() {
    try {
      const data = await fs.readFile(path.join(this.backupsPath, 'recovery', 'latest.json.gz'));
      const json = JSON.parse((await gunzip(data)).toString('utf8'));
      return json.data || null;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
}

module.exports = { BackupStore, atomicWrite, safeId };
