'use strict';

// Local project history is deliberately independent of ChatGPT account memory.
// Every file is keyed by the exact, already-established Studio placeKey.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_MESSAGE_BYTES = 128 * 1024;
const MAX_SNIPPET_BYTES = 256 * 1024;
const MAX_PROJECT_BYTES = 16 * 1024 * 1024;
const MAX_THREADS = 150;
const MAX_MEMORIES = 100;
const MAX_SNIPPETS = 150;
const MAX_MESSAGES = 300;

function boundedText(value, bytes, field) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > bytes) {
    throw new Error(`Invalid ${field} (maximum ${bytes} bytes).`);
  }
  return value;
}
function validateKey(value) { return boundedText(value, 300, 'Place ID'); }
function resolveFile(root, key) {
  return path.join(root, `${crypto.createHash('sha256').update(validateKey(key)).digest('hex')}.json`);
}
function freshProject(placeKey, name) {
  return { schema: 1, placeKey, name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), chats: [], memories: [], snippets: [] };
}
function publicProject(project) { return structuredClone(project); }

class AIProjectStore {
  constructor(userData) {
    this.root = path.join(userData, 'ai-projects');
    this.locks = new Map();
  }
  async read(placeKey, name = '') {
    const key = validateKey(placeKey);
    const file = resolveFile(this.root, key);
    try {
      const stat = await fs.stat(file);
      if (stat.size > MAX_PROJECT_BYTES) throw new Error('Project file exceeds its size limit.');
      const project = JSON.parse(await fs.readFile(file, 'utf8'));
      if (project.placeKey !== key || project.schema !== 1 || !Array.isArray(project.chats) ||
          !Array.isArray(project.memories) || !Array.isArray(project.snippets)) throw new Error('Invalid project file.');
      return project;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return freshProject(key, String(name || 'Untitled Place').slice(0, 180));
    }
  }
  async atomicWrite(project) {
    const json = JSON.stringify(project);
    if (Buffer.byteLength(json, 'utf8') > MAX_PROJECT_BYTES) throw new Error('Project storage limit reached.');
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    const file = resolveFile(this.root, project.placeKey);
    const temp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
      await fs.writeFile(temp, json, { flag: 'wx', mode: 0o600 });
      await fs.rename(temp, file);
    } catch (error) {
      await fs.rm(temp, { force: true }).catch(() => {});
      throw error;
    }
  }
  async mutate(placeKey, name, edit) {
    const key = validateKey(placeKey);
    const previous = this.locks.get(key) || Promise.resolve();
    const work = previous.catch(() => {}).then(async () => {
      const project = await this.read(key, name);
      if (name && project.name !== name) project.name = String(name).slice(0, 180);
      const value = edit(project);
      project.updatedAt = new Date().toISOString();
      await this.atomicWrite(project);
      return value === undefined ? publicProject(project) : { ...publicProject(project), result: value };
    });
    this.locks.set(key, work);
    try { return await work; }
    finally { if (this.locks.get(key) === work) this.locks.delete(key); }
  }
  async ensure(placeKey, name) { return this.mutate(placeKey, name, () => {}); }
  async list() {
    let names;
    try { names = await fs.readdir(this.root); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const projects = [];
    for (const name of names.filter(x => /^[a-f0-9]{64}\.json$/.test(x)).slice(0, 1000)) {
      try {
        const file = path.join(this.root, name);
        if ((await fs.stat(file)).size > MAX_PROJECT_BYTES) continue;
        const p = JSON.parse(await fs.readFile(file, 'utf8'));
        if (p.schema === 1 && typeof p.placeKey === 'string' && resolveFile(this.root, p.placeKey) === file) {
          projects.push({ placeKey: p.placeKey, name: p.name, updatedAt: p.updatedAt,
            chatCount: p.chats?.length || 0, snippetCount: p.snippets?.length || 0 });
        }
      } catch { /* One invalid file must not hide other local projects. */ }
    }
    return projects.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }
  async createChat(key, name) {
    return this.mutate(key, name, p => {
      if (p.chats.length >= MAX_THREADS) throw new Error('Chat limit reached for this Place.');
      const chat = { id: crypto.randomUUID(), title: 'New chat', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [] };
      p.chats.unshift(chat);
      return chat.id;
    });
  }
  async renameChat(key, id, title) {
    return this.mutate(key, '', p => {
      const chat = p.chats.find(x => x.id === id);
      if (!chat) throw new Error('Chat not found.');
      chat.title = boundedText(title, 180, 'chat title').trim();
      chat.updatedAt = new Date().toISOString();
    });
  }
  async deleteChat(key, id) {
    return this.mutate(key, '', p => { p.chats = p.chats.filter(x => x.id !== id); });
  }
  async addMessage(key, id, role, text, model = '') {
    return this.mutate(key, '', p => {
      const chat = p.chats.find(x => x.id === id);
      if (!chat) throw new Error('Chat not found.');
      if (!['user', 'assistant'].includes(role)) throw new Error('Invalid message role.');
      const content = boundedText(text, MAX_MESSAGE_BYTES, 'message');
      if (chat.messages.length >= MAX_MESSAGES) throw new Error('Chat history limit reached; start a new conversation.');
      const message = { id: crypto.randomUUID(), role, content, createdAt: new Date().toISOString(), model: String(model).slice(0, 80) };
      chat.messages.push(message);
      chat.updatedAt = message.createdAt;
      if (role === 'user' && chat.title === 'New chat') chat.title = content.replace(/\s+/g, ' ').slice(0, 70);
      return message.id;
    });
  }
  async saveMemory(key, text) {
    return this.mutate(key, '', p => {
      if (p.memories.length >= MAX_MEMORIES) throw new Error('Memory limit reached.');
      p.memories.push({ id: crypto.randomUUID(), text: boundedText(text, 5000, 'memory'), createdAt: new Date().toISOString() });
    });
  }
  async deleteMemory(key, id) { return this.mutate(key, '', p => { p.memories = p.memories.filter(x => x.id !== id); }); }
  async saveSnippet(key, title, code) {
    return this.mutate(key, '', p => {
      if (p.snippets.length >= MAX_SNIPPETS) throw new Error('Saved code limit reached.');
      p.snippets.unshift({ id: crypto.randomUUID(), title: boundedText(title, 180, 'snippet title'),
        code: boundedText(code, MAX_SNIPPET_BYTES, 'code'), language: 'luau', createdAt: new Date().toISOString() });
    });
  }
  async deleteSnippet(key, id) { return this.mutate(key, '', p => { p.snippets = p.snippets.filter(x => x.id !== id); }); }
}

module.exports = { AIProjectStore, resolveFile };
