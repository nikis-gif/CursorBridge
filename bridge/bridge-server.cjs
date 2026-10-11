'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { BackupStore } = require('./backup-store.cjs');
const { buildQuickApplyPlan, publicPreview } = require('./quick-apply.cjs');
const { prepareMutation, descendantsOf, sourceFingerprint, MAX_BACKUP_SCRIPTS } = require('./hierarchy-mutations.cjs');

const MAX_BODY_BYTES = 1024 * 1024;
const { MAX_SCRIPT_BYTES } = require('./bridge-server-constants.cjs');
const TIMEOUT_MS = 120000; // Accommodate Roblox HTTP throttling safely.
const PORT = 38471;

function httpError(code, message) {
  const error = new Error(message);
  error.statusCode = code;
  return error;
}

function tokenMatches(actual, received) {
  if (typeof received !== 'string' || typeof actual !== 'string') return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(received);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function cleanString(value, length = 180) {
  return typeof value === 'string' ? value.slice(0, length) : '';
}

function isScriptClass(className) {
  return className === 'Script' || className === 'LocalScript' || className === 'ModuleScript';
}

class BridgeServer extends EventEmitter {
  constructor({ storageDir, port = PORT, now = () => Date.now(), sessionTimeout = TIMEOUT_MS }) {
    super();
    this.port = port;
    this.now = now;
    this.sessionTimeout = sessionTimeout;
    this.storage = new BackupStore(storageDir);
    this.session = null;
    this.nodes = new Map();
    this.activity = [];
    this.ready = false;
    this.pairingCode = this.makePairingCode();
    this.pairingCreatedAt = now();
    this.failedPairAttempts = [];
    this.lastChangeAt = 0;
    this.cachedPlaceKey = 'offline';
    this.cachedPlaceName = 'No Studio session';
    this.httpServer = null;
    this.timer = null;
    this.snapshotWrite = Promise.resolve();
    this.lastSnapshotAt = 0;
    this.draftQueues = new Map();
    this.writeQueues = new Map();
    this.pendingBatchEvents = null;
    this.pendingMutations = new Map();
    this.mutationLocks = new Set();
    this.maxNodes = 250000;
    this.indexing = false;
    this.scanComplete = false;
    this.scanIndexed = 0;
    this.scanLimitReached = false;
    this.progressiveScan = false;
    this.onDemand = false;
    this.childPages = new Map();
    this.pendingWrites = new Map();
    this.scriptNodeCount = 0;
    this.sourceReadyCount = 0;
    this.quickApplyPreviews = new Map();
    this.pendingQuickApply = null;
    this.quickApplyPreparing = false;
  }

  makePairingCode() {
    return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  }

  async start() {
    await this.storage.init();
    const recovery = await this.storage.loadRecoverySnapshot().catch((error) => {
      this.log('warning', `Recovery snapshot unavailable: ${error.message}`);
      return null;
    });
    if (recovery?.nodes && Array.isArray(recovery.nodes)) {
      for (const node of recovery.nodes.slice(0, this.maxNodes)) {
        if (node && typeof node.id === 'string') this.nodes.set(node.id, node);
      }
      this.cachedPlaceKey = cleanString(recovery.placeKey) || 'offline';
      this.cachedPlaceName = cleanString(recovery.placeName) || 'Recovered Studio workspace';
      this.log('info', 'Restored a read-only recovery snapshot.');
    }
    this.httpServer = http.createServer((request, response) => {
      this.handleRequest(request, response).catch((error) => {
        this.respond(response, error.statusCode || 500, { ok: false, error: error.message });
      });
    });
    await new Promise((resolve, reject) => {
      this.httpServer.once('error', reject);
      this.httpServer.listen(this.port, '127.0.0.1', () => {
        this.httpServer.removeListener('error', reject);
        resolve();
      });
    });
    this.timer = setInterval(() => this.tick(), 1000);
    this.timer.unref();
    this.log('info', `Local bridge listening on 127.0.0.1:${this.port}.`);
    this.emitState();
  }

  async close() {
    clearInterval(this.timer);
    await this.disconnect('application-closed');
    if (this.httpServer) {
      await new Promise((resolve) => this.httpServer.close(resolve));
      this.httpServer = null;
    }
  }

  tick() {
    if (this.session && this.now() - this.session.lastSeen > this.sessionTimeout) {
      this.disconnect('heartbeat-timeout').catch((error) => this.log('error', error.message));
    }
    if (!this.session && this.now() - this.pairingCreatedAt > 5 * 60 * 1000) {
      this.rotatePairingCode();
    }
    if (this.ready && this.scanComplete && this.now() - this.lastSnapshotAt > 30 * 1000) {
      this.saveSnapshot().catch((error) => this.log('error', `Backup failed: ${error.message}`));
    }
  }

  rotatePairingCode() {
    this.pairingCode = this.makePairingCode();
    this.pairingCreatedAt = this.now();
    this.emitState();
  }

  log(level, message) {
    const entry = { at: new Date().toISOString(), level, message };
    this.activity.unshift(entry);
    if (this.activity.length > 60) this.activity.length = 60;
    this.emit('event', { type: 'activity', entry });
  }

  emitWorkspaceEvent(event) {
    if (this.pendingBatchEvents) this.pendingBatchEvents.push(event);
    else this.emit('event', event);
  }

  emitState() {
    this.emit('event', { type: 'status', status: this.getStatus() });
  }

  getStatus() {
    return {
      connected: !!this.session,
      ready: this.ready && !!this.session,
      placeKey: this.session?.placeKey || this.cachedPlaceKey,
      placeName: this.session?.placeName || this.cachedPlaceName,
      studioRunId: this.session?.studioRunId || null,
      pairingCode: this.session ? null : this.pairingCode,
      nodeCount: this.nodes.size,
      scriptCount: this.sourceReadyCount,
      indexing: this.indexing,
      scanComplete: this.scanComplete,
      scanIndexed: this.scanIndexed,
      scanLimitReached: this.scanLimitReached,
      onDemand: this.onDemand,
      lastChangeAt: this.lastChangeAt || null,
      lastHeartbeatAt: this.session?.lastSeen || null,
      port: this.port,
    };
  }

  getState() {
    return {
      status: this.getStatus(),
      nodes: [...this.nodes.values()].map((node) => this.serializeNode(node)),
      childPages: Object.fromEntries(this.childPages),
      activity: this.activity.slice(0, 30),
    };
  }

  async readRequest(request) {
    const chunks = [];
    let count = 0;
    for await (const chunk of request) {
      count += chunk.length;
      if (count > MAX_BODY_BYTES) throw httpError(413, 'Request exceeds the 1 MiB limit.');
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw httpError(400, 'Invalid JSON payload.'); }
  }

  respond(response, status, payload) {
    if (response.headersSent) return;
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(JSON.stringify(payload));
  }

  authenticate(request) {
    const received = request.headers.authorization?.replace(/^Bearer /i, '');
    if (!this.session || !tokenMatches(this.session.token, received)) {
      throw httpError(401, 'This Studio session is no longer authorized. Pair again.');
    }
    this.session.lastSeen = this.now();
  }

  async handleRequest(request, response) {
    // Browser origins cannot pair or control this local API; Studio has no Origin header.
    if (request.headers.origin) throw httpError(403, 'Browser origins are not allowed.');
    if (request.method !== 'POST' || request.headers['x-cursor-bridge'] !== '1') {
      throw httpError(404, 'Endpoint not found.');
    }
    if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
      throw httpError(415, 'Content-Type must be application/json.');
    }
    if (request.url === '/v1/pair') {
      const data = await this.readRequest(request);
      return this.respond(response, 200, this.pair(data));
    }
    this.authenticate(request);
    const data = await this.readRequest(request);
    if (request.url === '/v1/changes') {
      return this.respond(response, 200, await this.receiveChanges(data));
    }
    if (request.url === '/v1/poll') {
      return this.respond(response, 200, this.poll());
    }
    if (request.url === '/v1/disconnect') {
      await this.disconnect('studio-disconnected');
      return this.respond(response, 200, { ok: true });
    }
    throw httpError(404, 'Endpoint not found.');
  }

  pair(data) {
    if (this.session) throw httpError(409, 'Another Roblox Studio session is already paired.');
    this.failedPairAttempts = this.failedPairAttempts.filter((t) => this.now() - t < 60_000);
    if (this.failedPairAttempts.length >= 8) throw httpError(429, 'Too many pairing attempts. Retry in a minute.');
    if (!data || typeof data.code !== 'string' || !tokenMatches(this.pairingCode, data.code)) {
      this.failedPairAttempts.push(this.now());
      throw httpError(403, 'Incorrect pairing code.');
    }
    if (typeof data.studioRunId !== 'string' || data.studioRunId.length < 12) {
      throw httpError(400, 'Invalid Studio instance identifier.');
    }
    this.session = {
      token: crypto.randomBytes(32).toString('hex'),
      sessionId: crypto.randomUUID(),
      studioRunId: cleanString(data.studioRunId),
      placeKey: cleanString(data.placeKey) || 'unpublished',
      placeName: cleanString(data.placeName) || 'Untitled Place',
      lastSeen: this.now(),
      lastSeq: 0,
      openRequests: new Map(),
      sourceRequests: new Map(),
      childRequests: new Map(),
    };
    this.cachedPlaceKey = this.session.placeKey;
    this.cachedPlaceName = this.session.placeName;
    this.ready = false;
    this.indexing = false;
    this.progressiveScan = false;
    this.onDemand = false;
    this.childPages.clear();
    this.scanComplete = false;
    this.scanIndexed = 0;
    this.scanLimitReached = false;
    this.nodes.clear();
    this.sourceReadyCount = 0;
    this.scriptNodeCount = 0;
    this.pendingWrites.clear();
    this.writeQueues.clear();
    this.pendingMutations.clear();
    this.mutationLocks.clear();
    this.pendingQuickApply = null;
    this.quickApplyPreviews.clear();
    this.log('success', `Studio paired: ${this.session.placeName}.`);
    this.emit('event', { type: 'reset' });
    this.emitState();
    return { ok: true, sessionId: this.session.sessionId, token: this.session.token, protocolVersion: 1 };
  }

  poll() {
    const commands = [];
    // Do not scan the entire DataModel on every HTTP heartbeat.
    for (const [id, pending] of this.pendingWrites) {
      if (this.nodes.get(id)?.pendingWrite !== pending) {
        this.pendingWrites.delete(id);
        continue;
      }
      commands.push({ type: 'write', opId: pending.opId, scriptId: id,
        expectedSource: pending.expectedSource, newSource: pending.newSource });
    }
    for (const [id, opId] of this.session.sourceRequests) {
      commands.push({ type: 'loadSource', opId, scriptId: id });
    }
    for (const [parentId, request] of this.session.childRequests) {
      commands.push({type: 'listChildren', opId: request.opId, parentId, offset: request.offset});
    }
    for (const [opId, request] of this.session.openRequests) {
      commands.push({ type: 'open', opId, scriptId: request.scriptId });
    }
    for (const mutation of this.pendingMutations.values()) {
      commands.push({ type: 'mutate', opId: mutation.opId, ...mutation.payload });
    }
    if (this.pendingQuickApply) {
      const pending = this.pendingQuickApply;
      commands.push({ type: 'quickApply', opId: pending.opId, entries: pending.entries });
    }
    return { ok: true, ready: this.ready, commands: commands.slice(0, 25) };
  }

  requestSource(id) {
    if (!this.ready || !this.session) throw new Error('Studio is not connected.');
    const node = this.nodes.get(id);
    if (!node?.isScript) throw new Error('Script is not indexed yet.');
    if (typeof node.source === 'string') return { status: 'ready' };
    if (!this.session.sourceRequests.has(id)) {
      this.session.sourceRequests.set(id, crypto.randomUUID());
    }
    return { status: 'loading' };
  }

  // A bounded page is requested only when the Explorer expands a parent.
  // No full-Place traversal is necessary for locating an arbitrary deep branch.
  requestChildren(parentId) {
    if (!this.session || !this.ready) throw new Error('Studio is not connected.');
    const parent = this.nodes.get(parentId);
    if (!parent || parent.isScript) throw new Error('The destination folder is not indexed.');
    const state = this.childPages.get(parentId) || {offset: 0, total: null, complete: false};
    if (state.complete || parent.hasChildren === false) {
      if (!state.complete) this.childPages.set(parentId, {...state, total: 0, complete: true});
      return {status: 'complete', ...state};
    }
    if (this.session.childRequests.has(parentId)) return {status: 'loading', ...state};
    if (this.session.childRequests.size >= 8) throw new Error('Too many pending Explorer folders. Wait for a page to finish.');
    this.session.childRequests.set(parentId, {opId: crypto.randomUUID(), offset: state.offset});
    return {status: 'loading', ...state};
  }

  // Unknown subtrees must never be deleted/duplicated without all source backups.
  isSubtreeFullyIndexed(rootId) {
    if (this.scanComplete && !this.onDemand) return true;
    const children = new Map();
    for (const node of this.nodes.values()) {
      if (!children.has(node.parentId)) children.set(node.parentId, []);
      children.get(node.parentId).push(node);
    }
    const stack = [rootId];
    const visited = new Set();
    while (stack.length) {
      const id = stack.pop();
      if (visited.has(id)) continue;
      visited.add(id);
      const node = this.nodes.get(id);
      if (!node) return false;
      if (node.hasChildren && this.childPages.get(id)?.complete !== true) return false;
      for (const child of children.get(id) || []) stack.push(child.id);
    }
    return true;
  }

  async receiveChanges(data) {
    if (!data || !Number.isSafeInteger(data.sequence) || !Array.isArray(data.ops) || data.ops.length > 400) {
      throw httpError(400, 'Invalid batch format.');
    }
    if (data.sequence <= this.session.lastSeq) return { ok: true, receivedSequence: this.session.lastSeq };
    if (data.sequence !== this.session.lastSeq + 1) throw httpError(409, 'Out-of-order batch.');
    this.pendingBatchEvents = [];
    try {
      for (const op of data.ops) {
        if (!op || typeof op.type !== 'string') throw httpError(400, 'Invalid operation.');
        await this.applyOperation(op);
      }
      this.session.lastSeq = data.sequence;
    } finally {
      const events = this.pendingBatchEvents;
      this.pendingBatchEvents = null;
      if (events.length) this.emit('event', { type: 'batch', events });
    }
    return { ok: true, receivedSequence: this.session.lastSeq };
  }

  async applyOperation(op) {
    if (op.type === 'reset') {
      if (this.ready) throw httpError(409, 'A ready session cannot be reset.');
      this.nodes.clear();
      this.childPages.clear();
      this.session?.childRequests.clear();
      this.emit('event', { type: 'reset' });
      return;
    }
    if (op.type === 'scanBegin') {
      this.progressiveScan = true;
      this.onDemand = false;
      this.indexing = true;
      this.scanComplete = false;
      this.emitState();
      return;
    }
    if (op.type === 'ready') {
      this.ready = true;
      this.lastChangeAt = this.now();
      if (!this.progressiveScan) {
        // Older compatible Studio plugins emit ready only after full traversal.
        this.scanComplete = true;
        this.indexing = false;
        this.log('success', 'Explorer snapshot synchronized.');
        await this.saveSnapshot();
      } else {
        this.log('info', 'Explorer connected. Remaining hierarchy streaming in the background.');
      }
      this.emitState();
      return;
    }
    if (op.type === 'scanProgress') {
      this.scanIndexed = Math.max(this.scanIndexed, Math.max(0, Number(op.count) || 0));
      this.emitState();
      return;
    }
    if (op.type === 'scanComplete') {
      this.indexing = false;
      this.scanComplete = true;
      this.onDemand = false;
      this.scanIndexed = Math.max(this.nodes.size, Number(op.count) || 0);
      this.log('success', `Explorer fully indexed: ${this.nodes.size} instances.`);
      this.emitState();
      // Save only a complete snapshot, not a misleading partial workspace.
      this.saveSnapshot().catch((error) => this.log('warning', `Snapshot unavailable: ${error.message}`));
      return;
    }
    if (op.type === 'scanPaused') {
      this.indexing = false;
      this.scanComplete = false;
      this.onDemand = true;
      this.scanIndexed = Math.max(this.nodes.size, Number(op.count) || 0);
      this.log('info', 'Automatic index paused. Additional folders load as they are opened.');
      this.emitState();
      return;
    }
    if (op.type === 'scanLimit') {
      this.scanLimitReached = true;
      this.indexing = false;
      this.scanComplete = false;
      this.log('warning', 'Hierarchy safety limit reached; the Explorer remains incomplete.');
      this.emitState();
      return;
    }
    if (op.type === 'childrenPage') {
      const parentId = op.parentId;
      const expected = this.session?.childRequests.get(parentId);
      if (!expected || expected.opId !== op.opId || expected.offset !== op.offset) return;
      if (op.invalidated) {
        this.session.childRequests.delete(parentId);
        this.childPages.delete(parentId);
        this.emitWorkspaceEvent({type: 'childrenPage', parentId, invalidated: true});
        return;
      }
      if (!Array.isArray(op.children) || op.children.length > 150 ||
          !Number.isSafeInteger(op.total) || op.total < 0 ||
          !Number.isSafeInteger(op.nextOffset) || op.nextOffset < op.offset ||
          op.nextOffset > op.total || op.nextOffset - op.offset > 150) {
        throw httpError(400, 'Invalid Explorer page.');
      }
      for (const child of op.children) {
        if (!child || child.parentId !== parentId) throw httpError(400, 'Explorer page child belongs to another parent.');
        await this.applyOperation({type: 'upsert', node: child});
      }
      this.session.childRequests.delete(parentId);
      const state = {offset: op.nextOffset, total: op.total, complete: op.nextOffset >= op.total};
      this.childPages.set(parentId, state);
      this.emitWorkspaceEvent({type: 'childrenPage', parentId, ...state});
      return;
    }
    if (op.type === 'upsert') {
      const data = op.node;
      if (!data || typeof data.id !== 'string' || data.id.length > 120 ||
          typeof data.parentId !== 'string' || typeof data.name !== 'string' ||
          typeof data.className !== 'string') throw httpError(400, 'Invalid node.');
      if (!this.nodes.has(data.id) && this.nodes.size >= this.maxNodes) {
        throw httpError(413, 'Studio hierarchy exceeds the node limit.');
      }
      const previous = this.nodes.get(data.id);
      const isScript = isScriptClass(data.className);
      const node = previous || { id: data.id, revision: 0 };
      const nextOrder = Number.isSafeInteger(data.siblingOrder) && data.siblingOrder >= 1 && data.siblingOrder <= this.maxNodes
        ? data.siblingOrder : null;
      const changedMetadata = !previous || previous.name !== data.name || previous.parentId !== data.parentId ||
        previous.className !== data.className || (nextOrder !== null && previous.siblingOrder !== nextOrder);
      node.metadataRevision = (node.metadataRevision || 0) + (changedMetadata ? 1 : 0);
      if (nextOrder !== null) node.siblingOrder = nextOrder;
      node.name = cleanString(data.name, 300);
      if (typeof data.hasChildren === 'boolean') node.hasChildren = data.hasChildren;
      node.parentId = cleanString(data.parentId, 120);
      node.className = cleanString(data.className, 100);
      if (previous && previous.isScript !== isScript) {
        this.scriptNodeCount += isScript ? 1 : -1;
        if (typeof previous.source === 'string') this.sourceReadyCount--;
      } else if (!previous && isScript) this.scriptNodeCount++;
      node.isScript = isScript;
      node.sourceAvailable = !isScript || typeof data.source === 'string' ||
        typeof node.source === 'string';
      this.nodes.set(node.id, node);
      this.emitWorkspaceEvent({ type: 'upsert', node: this.serializeNode(node) });
      if (isScript && typeof data.source === 'string') await this.applyStudioSource(node, data.source);
      return;
    }
    if (op.type === 'remove') {
      if (typeof op.id !== 'string') throw httpError(400, 'Invalid node identifier.');
      // Large subtree deletions may generate descendant removal events.
      // Once an ancestor has removed the subtree, later child removals are no-ops.
      if (!this.nodes.has(op.id)) return;
      const removed = new Set([op.id]);
      const children = new Map();
      for (const node of this.nodes.values()) {
        if (!children.has(node.parentId)) children.set(node.parentId, []);
        children.get(node.parentId).push(node.id);
      }
      const pending = [op.id];
      for (let cursor = 0; cursor < pending.length; cursor++) {
        for (const childId of children.get(pending[cursor]) || []) {
          if (removed.has(childId)) continue;
          removed.add(childId);
          pending.push(childId);
        }
      }
      for (const id of removed) {
        const node = this.nodes.get(id);
        if (node && typeof node.source === 'string') {
          await this.backup(node, 'studio-node-removed');
        }
        if (node?.isScript) {
          this.scriptNodeCount--;
          if (typeof node.source === 'string') this.sourceReadyCount--;
        }
        this.pendingWrites.delete(id);
        this.session?.sourceRequests.delete(id);
        this.nodes.delete(id);
      }
      this.lastChangeAt = this.now();
      this.emitWorkspaceEvent({ type: 'remove', ids: [...removed] });
      return;
    }
    if (op.type === 'source') {
      const node = this.nodes.get(op.id);
      if (!node?.isScript) return;
      if (typeof op.source !== 'string') throw httpError(400, 'Invalid source operation.');
      this.session.sourceRequests.delete(op.id);
      await this.applyStudioSource(node, op.source);
      return;
    }
    if (op.type === 'sourceUnavailable') {
      this.session.sourceRequests.delete(op.id);
      const node = this.nodes.get(op.id);
      if (node?.isScript && typeof node.source !== 'string') {
        node.sourceAvailable = false;
        this.emitWorkspaceEvent({type: 'sourceUnavailable', id: op.id});
      }
      return;
    }
    if (op.type === 'mutationResult') {
      if (typeof op.opId !== 'string') throw httpError(400, 'Invalid mutation result.');
      const pending = this.pendingMutations.get(op.opId);
      if (pending) {
        this.pendingMutations.delete(op.opId);
        for (const id of pending.lockIds) this.mutationLocks.delete(id);
        const status = ['applied', 'partial', 'conflict', 'error'].includes(op.status) ? op.status : 'error';
        const results = Array.isArray(op.results) ? op.results.slice(0, 50).map((entry) => ({
          id: cleanString(entry.id, 120), status: cleanString(entry.status, 30),
          message: cleanString(entry.message, 200),
        })) : [];
        this.emitWorkspaceEvent({ type: 'mutation', opId: op.opId, action: pending.payload.action, status, results });
        this.log(status === 'applied' ? 'success' : 'warning', `${pending.payload.action}: ${status} (${results.filter((r) => r.status === 'applied').length}/${results.length}).`);
      }
      return;
    }
    if (op.type === 'quickApplyResult') {
      if (this.pendingQuickApply?.opId !== op.opId) return;
      const pending = this.pendingQuickApply;
      this.pendingQuickApply = null;
      for (const id of pending.lockIds) this.mutationLocks.delete(id);
      const allowed = new Set(['applied', 'conflict', 'error', 'partial', 'rolled-back']);
      const status = allowed.has(op.status) ? op.status : 'error';
      const results = Array.isArray(op.results) ? op.results.slice(0, 20).map((item) => ({
        index: Number.isSafeInteger(item.index) ? item.index : -1,
        status: cleanString(item.status, 30), message: cleanString(item.message, 200),
      })) : [];
      this.emitWorkspaceEvent({ type: 'quickApply', opId: pending.opId, status, results,
        count: pending.entries.length, backupPath: pending.backupPath });
      this.log(status === 'applied' ? 'success' : 'warning', `Quick Apply: ${status}.`);
      return;
    }
    if (op.type === 'result') {
      if (typeof op.opId !== 'string') throw httpError(400, 'Invalid result operation.');
      const node = this.nodes.get(op.id);
      if (node?.pendingWrite?.opId === op.opId) {
        if (op.status === 'applied' && typeof op.source === 'string' && op.source === node.pendingWrite.newSource) {
          await this.applyStudioSource(node, op.source, 'cursor');
          const queued = node.queuedSource;
          node.pendingWrite = null;
          this.pendingWrites.delete(node.id);
          node.queuedSource = null;
          if (typeof queued === 'string' && queued !== node.source) await this.enqueueWrite(node, queued);
        } else {
          await this.failPendingWrite(node, op.status === 'conflict' ? 'Studio script changed simultaneously.' : 'Studio rejected the edit.');
          if (typeof op.source === 'string') await this.applyStudioSource(node, op.source);
        }
      }
      if (this.session.openRequests.has(op.opId)) {
        this.session.openRequests.delete(op.opId);
        this.log(op.status === 'applied' ? 'info' : 'warning', `Studio editor request: ${op.status}.`);
      }
      return;
    }
    throw httpError(400, 'Unknown operation type.');
  }

  serializeNode(node) {
    const { pendingWrite, queuedSource, ...serializable } = node;
    return { ...serializable, pending: !!pendingWrite || typeof queuedSource === 'string' };
  }

  async applyStudioSource(node, source, origin = 'studio') {
    if (Buffer.byteLength(source, 'utf8') > MAX_SCRIPT_BYTES) {
      throw httpError(413, 'Script source exceeds the 256 KiB limit.');
    }
    if (source === node.source) return;
    if (typeof node.source !== 'string') this.sourceReadyCount++;
    // Studio sometimes emits the source observer before its explicit write result.
    // Matching our pending payload is an acknowledgment, not an external conflict.
    const pending = node.pendingWrite;
    const isWriteEcho = origin === 'studio' && pending && source === pending.newSource;
    if (typeof node.source === 'string') await this.backup(node, `before-${isWriteEcho ? 'cursor' : origin}-change`);
    if (origin === 'studio' && pending && !isWriteEcho) {
      await this.failPendingWrite(node, 'A Studio edit conflicted with the local draft.');
    }
    node.source = source;
    node.revision = (node.revision || 0) + 1;
    node.sourceAvailable = true;
    this.lastChangeAt = this.now();
    this.emitWorkspaceEvent({ type: 'upsert', node: this.serializeNode(node), origin: isWriteEcho ? 'cursor' : origin });
    if (isWriteEcho && node.pendingWrite === pending) {
      const queued = node.queuedSource;
      node.pendingWrite = null;
      this.pendingWrites.delete(node.id);
      node.queuedSource = null;
      if (typeof queued === 'string' && queued !== node.source) {
        await this.enqueueWrite(node, queued);
      }
    }
  }

  nodePath(id) {
    const names = [];
    const visited = new Set();
    let node = this.nodes.get(id);
    while (node && !visited.has(node.id)) {
      visited.add(node.id);
      names.push(node.name);
      node = this.nodes.get(node.parentId);
    }
    return ['game', ...names.reverse()].join('/');
  }

  async backup(node, reason) {
    return this.storage.saveVersion({ placeKey: this.session?.placeKey || this.cachedPlaceKey,
      scriptId: node.id, source: node.source, nodePath: this.nodePath(node.id), reason });
  }

  async enqueueWrite(node, source) {
    if (source === node.source) return { status: 'no-op' };
    if (typeof node.source !== 'string') throw new Error('The Studio source is not available.');
    // Capture the exact base before backing it up. A concurrent Studio update
    // during the awaited disk write must not be silently overwritten.
    const baseRevision = node.revision;
    const expectedSource = node.source;
    await this.backup(node, 'before-app-edit');
    if (!this.session || !this.ready || this.nodes.get(node.id) !== node ||
        node.revision !== baseRevision || node.source !== expectedSource || node.pendingWrite) {
      return { status: 'conflict', revision: node.revision };
    }
    node.pendingWrite = { opId: crypto.randomUUID(), baseRevision,
      expectedSource, newSource: source, createdAt: this.now() };
    this.pendingWrites.set(node.id, node.pendingWrite);
    this.emitWorkspaceEvent({ type: 'upsert', node: this.serializeNode(node) });
    return { status: 'queued', revision: node.revision };
  }

  async writeScript(id, source, baseRevision) {
    // Serialize writes for the same script while enqueueWrite awaits a backup.
    // Otherwise two concurrent IPC requests can each create a pending command.
    const previous = this.writeQueues.get(id) || Promise.resolve();
    const next = previous.catch(() => {}).then(() => this.writeScriptLocked(id, source, baseRevision));
    this.writeQueues.set(id, next);
    try { return await next; }
    finally { if (this.writeQueues.get(id) === next) this.writeQueues.delete(id); }
  }

  async writeScriptLocked(id, source, baseRevision) {
    if (!this.session || !this.ready) throw new Error('Studio is not connected. Your draft remains backed up locally.');
    if (this.pendingQuickApply || this.quickApplyPreparing) throw new Error('Wait for Quick Apply to finish. Your editor draft remains local.');
    const node = this.nodes.get(id);
    if (!node?.isScript || typeof node.source !== 'string') throw new Error('The script is not editable.');
    if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > MAX_SCRIPT_BYTES) {
      throw new Error('Script must be text smaller than 256 KiB.');
    }
    if (node.pendingWrite && (baseRevision === node.pendingWrite.baseRevision || baseRevision === node.revision)) {
      node.queuedSource = source;
      this.emitWorkspaceEvent({ type: 'upsert', node: this.serializeNode(node) });
      return { status: 'queued-behind-current', revision: node.revision };
    }
    if (baseRevision !== node.revision) {
      return { status: 'conflict', revision: node.revision, currentSource: node.source };
    }
    return this.enqueueWrite(node, source);
  }

  async failPendingWrite(node, reason) {
    if (!node.pendingWrite) return;
    const pending = node.pendingWrite;
    const unsent = node.queuedSource || pending.newSource;
    const placeKey = this.session?.placeKey || this.cachedPlaceKey;
    const nodePath = this.nodePath(node.id);
    // Do not overwrite a newer local draft already saved by the renderer.
    await this.queueDraftOperation(placeKey, node.id, async () => {
      const existing = await this.storage.getDraft(placeKey, node.id);
      if (!existing) await this.storage.saveDraft({ placeKey, scriptId: node.id,
        source: unsent, nodePath });
      else if (existing.source !== unsent) await this.storage.saveVersion({
        placeKey, scriptId: node.id, source: unsent, nodePath,
        reason: 'unsent-write-recovered-after-conflict',
      });
    });
    node.pendingWrite = null;
    this.pendingWrites.delete(node.id);
    node.queuedSource = null;
    this.log('warning', `${nodePath}: ${reason} Draft protected.`);
    this.emitWorkspaceEvent({ type: 'conflict', id: node.id, message: reason });
  }

  queueDraftOperation(placeKey, id, operation) {
    const key = `${placeKey}:${id}`;
    const previous = this.draftQueues.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    this.draftQueues.set(key, next);
    return next.finally(() => {
      if (this.draftQueues.get(key) === next) this.draftQueues.delete(key);
    });
  }

  async saveDraft(id, source, hintPath = null, hintPlaceKey = null) {
    if (typeof id !== 'string' || id.length > 120 || !id || typeof source !== 'string') {
      throw new Error('Invalid draft input.');
    }
    if (Buffer.byteLength(source, 'utf8') > MAX_SCRIPT_BYTES) throw new Error('Draft exceeds 256 KiB.');
    const node = this.nodes.get(id);
    const livePlaceKey = this.session?.placeKey || this.cachedPlaceKey;
    const livePath = node?.isScript ? this.nodePath(id) : null;
    const hinted = typeof hintPath === 'string' && hintPath.startsWith('game/') &&
      hintPath.length <= 1500 && typeof hintPlaceKey === 'string' &&
      hintPlaceKey.length > 0 && hintPlaceKey.length <= 180;
    if (!node?.isScript && !hinted) throw new Error('Script is not available.');
    // Retain the original place and path when a disconnect/reset races an IPC
    // save. The hint only controls local recovery storage, never Studio writes.
    const detached = hinted && (livePath !== hintPath || livePlaceKey !== hintPlaceKey);
    const placeKey = detached ? hintPlaceKey : livePlaceKey;
    const nodePath = detached ? hintPath : livePath;
    await this.queueDraftOperation(placeKey, id, () => this.storage.saveDraft({
      placeKey, scriptId: id, source, nodePath,
    }));
    return { ok: true };
  }

  async clearDraft(id, expectedSource, force = false) {
    const placeKey = this.session?.placeKey || this.cachedPlaceKey;
    return this.queueDraftOperation(placeKey, id, async () => {
      const existing = await this.storage.getDraft(placeKey, id);
      // A delayed acknowledgment may never erase a newer editor draft.
      if (!existing) return { ok: true };
      if (force || (typeof expectedSource === 'string' && existing.source === expectedSource)) {
        await this.storage.clearDraft(placeKey, id);
        return { ok: true };
      }
      return { ok: false, reason: 'A newer or different draft was retained.' };
    });
  }

  async getDraft(id) {
    const node = this.nodes.get(id);
    const placeKey = this.session?.placeKey || this.cachedPlaceKey;
    return node?.isScript
      ? this.storage.findDraftByPath(placeKey, id, this.nodePath(id))
      : this.storage.getDraft(placeKey, id);
  }

  async listBackups(id) {
    if (!this.nodes.get(id)?.isScript) return [];
    const nodePath = this.nodePath(id);
    return this.storage.listVersions(this.session?.placeKey || this.cachedPlaceKey, id, nodePath);
  }

  async restoreBackup(id, versionId, storageScriptId = id) {
    const available = await this.listBackups(id);
    if (!available.some((entry) => entry.id === versionId && entry.storageScriptId === storageScriptId)) {
      throw new Error('The requested backup does not match this Studio path.');
    }
    const source = await this.storage.readVersion(
      this.session?.placeKey || this.cachedPlaceKey, storageScriptId, versionId,
    );
    return { source }; // Manual preview only; never silently overwrites Studio.
  }

  openStudioScript(id) {
    if (!this.session || !this.ready || !this.nodes.get(id)?.isScript) throw new Error('Script is not connected.');
    this.session.openRequests.set(crypto.randomUUID(), { scriptId: id });
    return { ok: true };
  }

  async mutateHierarchy(request) {
    if (!this.session || !this.ready) throw new Error('Connect Roblox Studio before modifying the Explorer.');
    if (this.progressiveScan && this.indexing && request.action !== 'create' && request.action !== 'rename') {
      throw new Error('Wait for the full hierarchy scan to pause before structural changes.');
    }
    if (this.pendingQuickApply || this.quickApplyPreparing) throw new Error('Wait for Quick Apply to finish before changing the hierarchy.');
    const sessionId = this.session.sessionId;
    const payload = prepareMutation(this.nodes, request);
    const lockIds = payload.targets.map((target) => target.id);
    if (lockIds.some((id) => this.mutationLocks.has(id))) {
      throw new Error('One or more selected instances already have a pending operation.');
    }
    if (['delete', 'duplicate', 'move'].includes(payload.action) &&
        lockIds.some((id) => !this.isSubtreeFullyIndexed(id))) {
      throw new Error('Expand and fully load all folders within this selection before a structural change.');
    }
    const changedNodes = descendantsOf(this.nodes, lockIds);
    if (payload.action === 'delete' || payload.action === 'duplicate') {
      if (changedNodes.some((node) => node.pendingWrite || typeof node.queuedSource === 'string')) {
        throw new Error('Wait for pending code edits to sync before modifying these scripts.');
      }
    }
    if (payload.action === 'delete') {
      // Never delete a script whose current source could not be captured.
      const scripts = changedNodes.filter((node) => node.isScript);
      if (scripts.length > MAX_BACKUP_SCRIPTS) {
        throw new Error(`For safety, delete at most ${MAX_BACKUP_SCRIPTS} scripts (including descendants) at once.`);
      }
      if (scripts.some((node) => typeof node.source !== 'string')) {
        throw new Error('A selected descendant has unavailable script source. Delete it in Studio after verifying the source.');
      }
      payload.protectedScripts = scripts.map((node) => ({ id: node.id, fingerprint: sourceFingerprint(node.source) }));
      // Persist every script under selected folders before sending any destructive command.
      for (const node of scripts) await this.backup(node, 'before-app-delete');
      await this.saveSnapshot();
    }
    if (!this.session || this.session.sessionId !== sessionId || !this.ready) {
      throw new Error('Studio disconnected while preparing this operation. No mutation was queued.');
    }
    const opId = crypto.randomUUID();
    for (const id of lockIds) this.mutationLocks.add(id);
    this.pendingMutations.set(opId, { opId, payload, lockIds, startedAt: this.now() });
    this.emitWorkspaceEvent({ type: 'mutation', opId, action: payload.action, status: 'queued', count: payload.targets.length || 1 });
    return { opId, status: 'queued', count: payload.targets.length || 1 };
  }

  requireQuickApplyPathsLoaded(plan) {
    if (this.scanComplete && !this.onDemand) return;
    // Each known path segment must be uniquely resolvable from a fully loaded
    // sibling list. A partial mirror must never be treated as an empty folder.
    for (const entry of plan.entries) {
      if (entry.action === 'error') continue;
      let parentId = 'game';
      for (const guard of entry.guards || []) {
        if (parentId !== 'game' && this.childPages.get(parentId)?.complete !== true) {
          throw new Error(`Expand and fully load the path before Quick Apply: ${entry.path}`);
        }
        parentId = guard.id;
      }
      // For MODIFIED the final guard is the script itself. Its parent must be
      // loaded; for NEW the last guard is the parent where siblings are checked.
      if (entry.action === 'create' && this.childPages.get(parentId)?.complete !== true) {
        throw new Error(`Expand and fully load the destination before Quick Apply: ${entry.path}`);
      }
    }
  }

  previewQuickApply(text, classOverrides = {}) {
    if (!this.session || !this.ready) throw new Error('Connect Roblox Studio before previewing the bundle.');
    if (this.indexing) throw new Error('Quick Apply requires a complete hierarchy or fully loaded paths. Wait for automatic indexing to pause.');
    const plan = buildQuickApplyPlan(text, this.nodes, classOverrides);
    this.requireQuickApplyPathsLoaded(plan);
    const token = crypto.randomUUID();
    // Keep only a few short-lived previews so large pasted files never accumulate.
    this.quickApplyPreviews.clear();
    this.quickApplyPreviews.set(token, {
      ...plan, text, token, createdAt: this.now(), sessionId: this.session.sessionId,
    });
    return { ok: plan.errors.length === 0, token, ...publicPreview(plan), placeName: this.session.placeName };
  }

  async applyQuickApply(token) {
    if (!this.session || !this.ready) throw new Error('Studio disconnected. No scripts were changed.');
    if (this.pendingQuickApply || this.quickApplyPreparing || this.pendingMutations.size ||
      [...this.nodes.values()].some((node) => node.pendingWrite || typeof node.queuedSource === 'string')) {
      throw new Error('Wait for all pending Studio operations to finish before Quick Apply.');
    }
    const preview = this.quickApplyPreviews.get(token);
    if (!preview || preview.sessionId !== this.session.sessionId || this.now() - preview.createdAt > 5 * 60_000) {
      throw new Error('Preview expired or Studio changed sessions. Preview the bundle again.');
    }
    if (preview.errors.length) throw new Error('Resolve all preview errors before applying.');
    const classOverrides = Object.fromEntries(preview.entries.filter((entry) => entry.status === 'NEW')
      .map((entry) => [entry.index, entry.className]));
    const latest = buildQuickApplyPlan(preview.text, this.nodes, classOverrides);
    this.requireQuickApplyPathsLoaded(latest);
    if (latest.errors.length || latest.entries.length !== preview.entries.length || latest.entries.some((entry, index) => {
      const old = preview.entries[index];
      return entry.action !== old.action || entry.scriptId !== old.scriptId ||
        entry.revision !== old.revision || entry.expectedSource !== old.expectedSource ||
        entry.anchorId !== old.anchorId || JSON.stringify(entry.guards) !== JSON.stringify(old.guards);
    })) {
      throw new Error('Studio hierarchy or source changed since the preview. Review the bundle again.');
    }
    const actions = latest.entries.filter((entry) => entry.action !== 'unchanged');
    if (!actions.length) throw new Error('All included scripts already match Studio. Nothing to apply.');
    const sessionId = this.session.sessionId;
    const lockIds = actions.filter((entry) => entry.action === 'modify').map((entry) => entry.scriptId);
    if (lockIds.some((id) => this.mutationLocks.has(id))) throw new Error('An included script is being modified by another operation.');
    this.quickApplyPreparing = true;
    try {
    // Always persist the full input before touching Studio; NEW scripts cannot yet
    // be stored as per-script drafts because they have no Roblox instance ID.
    const backupPath = await this.storage.saveQuickApplyBundle({
      placeKey: this.session.placeKey, text: preview.text, count: actions.length,
    });
    for (const entry of actions) {
      if (entry.action === 'modify') await this.backup(this.nodes.get(entry.scriptId), 'before-quick-apply');
    }
    await this.saveSnapshot();
    if (!this.session || !this.ready || this.session.sessionId !== sessionId) {
      throw new Error('Studio disconnected while saving backups. The bundle was preserved in recovery.');
    }
    const opId = crypto.randomUUID();
    this.pendingQuickApply = { opId, lockIds, backupPath, startedAt: this.now(),
      entries: actions.map((entry) => ({
        index: entry.index, action: entry.action, path: entry.path, name: entry.name,
        className: entry.className, source: entry.source,
        guards: entry.guards, scriptId: entry.scriptId || null,
        expectedSource: entry.expectedSource || null,
        anchorId: entry.anchorId || null, missingFolders: entry.missingFolders,
      })) };
    for (const id of lockIds) this.mutationLocks.add(id);
    this.quickApplyPreviews.clear();
    this.emitWorkspaceEvent({ type: 'quickApply', opId, status: 'queued', count: actions.length, backupPath });
    return { status: 'queued', opId, count: actions.length, backupPath };
    } finally {
      this.quickApplyPreparing = false;
    }
  }

  async saveSnapshot() {
    if (this.nodes.size === 0 || !this.scanComplete) return;
    this.lastSnapshotAt = this.now();
    const metadata = { placeKey: this.session?.placeKey || this.cachedPlaceKey,
      placeName: this.session?.placeName || this.cachedPlaceName };
    // Keep node identity stable if a new Studio session starts during disk I/O.
    const snapshotNodes = new Map(this.nodes);
    this.snapshotWrite = this.snapshotWrite.catch(() => {}).then(() =>
      this.storage.saveRecoverySnapshotStream(metadata, snapshotNodes.values(),
        (node) => this.serializeNode(node)));
    return this.snapshotWrite;
  }

  async disconnect(reason = 'user-disconnected') {
    if (!this.session) return;
    const previous = this.session;
    this.session = null;
    if (this.pendingQuickApply) {
      const pending = this.pendingQuickApply;
      this.emitWorkspaceEvent({ type: 'quickApply', opId: pending.opId, status: 'unknown',
        message: 'Studio disconnected before confirming Quick Apply. Inspect the place; the original bundle is backed up.',
        backupPath: pending.backupPath });
      this.pendingQuickApply = null;
    }
    this.quickApplyPreviews.clear();
    for (const mutation of this.pendingMutations.values()) {
      this.emitWorkspaceEvent({ type: 'mutation', opId: mutation.opId, action: mutation.payload.action, status: 'unknown',
        message: 'Studio disconnected before confirming this operation. Inspect the hierarchy after reconnecting.' });
    }
    this.pendingMutations.clear();
    this.mutationLocks.clear();
    this.ready = false;
    this.indexing = false;
    this.childPages.clear();
    this.pendingWrites.clear();
    for (const node of this.nodes.values()) {
      if (node.pendingWrite) await this.failPendingWrite(node, `Session ended (${reason}).`);
    }
    if (this.scanComplete) await this.saveSnapshot().catch((error) => this.log('error', `Recovery save failed: ${error.message}`));
    this.log('warning', `Studio session ended (${reason}): ${previous.placeName}.`);
    this.rotatePairingCode();
  }
}

module.exports = { BridgeServer, PORT, MAX_SCRIPT_BYTES };
