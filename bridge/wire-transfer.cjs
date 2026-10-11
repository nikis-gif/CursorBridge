'use strict';

const { randomUUID } = require('node:crypto');
const limits = require('../shared/limits.json');

// A corruption check, not a signature. The session bearer token authenticates the peer.
function checksum(bytes) {
  let a = 1, b = 0;
  for (let start = 0; start < bytes.length; start += 5552) {
    for (let i = start; i < Math.min(start + 5552, bytes.length); i++) { a += bytes[i]; b += a; }
    a %= 65521; b %= 65521;
  }
  return b * 65536 + a;
}

function encodeTransfer(value, id = randomUUID()) {
  const bytes = Buffer.from(JSON.stringify(value), 'utf8');
  if (bytes.length > limits.maxTransferBytes) throw new Error('Encoded operation exceeds 64 MiB. Split the bundle.');
  const parts = [];
  for (let start = 0; start < bytes.length;) {
    let end = Math.min(start + limits.chunkBytes, bytes.length);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
  }
  const digest = checksum(bytes);
  return parts.map((data, index) => ({ type: 'wireChunk', id, index,
    count: parts.length, bytes: bytes.length, checksum: digest, data }));
}

class IncomingTransfer {
  constructor() { this.active = null; this.completed = null; }

  accept(chunk) {
    const { id, index, count, bytes, data } = chunk;
    if (typeof id !== 'string' || !id || id.length > 120 || !Number.isSafeInteger(index) ||
        !Number.isSafeInteger(count) || count < 1 || count > 2048 || index < 0 || index >= count ||
        !Number.isSafeInteger(bytes) || bytes < 1 || bytes > limits.maxTransferBytes ||
        !Number.isSafeInteger(chunk.checksum) || chunk.checksum < 0 || chunk.checksum > 0xffffffff ||
        typeof data !== 'string' || Buffer.byteLength(data, 'utf8') > limits.chunkBytes) {
      throw new Error('Invalid transfer fragment.');
    }
    const done = this.completed;
    if (done) {
      if (done.id !== id || done.count !== count || done.bytes !== bytes || done.checksum !== chunk.checksum || done.lastData !== data || index !== count - 1) {
        throw new Error('The previous transfer has not been committed.');
      }
      return { next: count, received: bytes, total: bytes, value: done.value };
    }
    if (!this.active) {
      if (index !== 0) throw new Error('Transfer must start at fragment zero.');
      this.active = { id, count, bytes, checksum: chunk.checksum, parts: [], received: 0 };
    }
    const active = this.active;
    if (active.id !== id || active.count !== count || active.bytes !== bytes || active.checksum !== chunk.checksum) {
      throw new Error('Transfer identity changed.');
    }
    if (index < active.parts.length) {
      if (active.parts[index] !== data) throw new Error('Retried fragment differs from its original.');
      return { next: active.parts.length, received: active.received, total: bytes, value: null };
    }
    if (index !== active.parts.length) throw new Error('Out-of-order transfer fragment.');
    active.received += Buffer.byteLength(data, 'utf8');
    if (active.received > bytes) { this.clear(); throw new Error('Transfer exceeds its declared size.'); }
    active.parts.push(data);
    const progress = { next: active.parts.length, received: active.received, total: bytes, value: null };
    if (active.parts.length === count) {
      this.active = null;
      const body = Buffer.from(active.parts.join(''), 'utf8');
      if (body.length !== bytes || checksum(body) !== active.checksum) throw new Error('Transfer checksum mismatch.');
      const value = JSON.parse(body.toString('utf8'));
      if (!value || typeof value !== 'object' || value.type === 'wireChunk') throw new Error('Invalid transferred operation.');
      // Keep the decoded operation if the downstream disk write fails. Only the
      // final fragment is retried; successful earlier fragments stay checkpointed.
      this.completed = {id, count, bytes, checksum:chunk.checksum, lastData:data, value};
      progress.value = value;
    }
    return progress;
  }

  commit(id) { if (this.completed?.id === id) this.completed = null; }
  clear() { this.active = null; this.completed = null; }
}

class OutgoingTransfers {
  constructor() { this.items = new Map(); }

  receipts(receipts) {
    if (!Array.isArray(receipts) || receipts.length > 32) throw new Error('Invalid command receipts.');
    for (const receipt of receipts) {
      if (!receipt || typeof receipt.id !== 'string') throw new Error('Invalid command receipt.');
      const item = this.items.get(receipt.id);
      if (!item) continue;
      if (!Number.isSafeInteger(receipt.next) || receipt.next < 0 || receipt.next > item.sent) throw new Error('Receipt acknowledges unsent fragments.');
      item.next = Math.max(item.next, receipt.next);
    }
  }

  pack(commands) {
    const live = new Set(commands.map(command => command.opId));
    for (const id of this.items.keys()) if (!live.has(id)) this.items.delete(id);
    const output = [];
    let packetBytes = 4096;
    for (const command of commands) {
      let item = this.items.get(command.opId);
      if (item && item.next === item.chunks.length) continue;
      const size = item ? limits.chunkBytes + 1 : Buffer.byteLength(JSON.stringify(command), 'utf8');
      if (size <= limits.chunkBytes) {
        if (packetBytes + size > limits.maxPacketBytes) break;
        output.push(command); packetBytes += size + 1;
        continue;
      }
      if (!item) {
        if ([...this.items.values()].some(other => other.next < other.chunks.length)) continue;
        item = { chunks: encodeTransfer(command, command.opId), next: 0, sent: 0 };
        this.items.set(command.opId, item);
      }
      for (let i = item.next; i < item.chunks.length; i++) {
        const chunk = item.chunks[i];
        const size = Buffer.byteLength(JSON.stringify(chunk), 'utf8');
        if (packetBytes + size > limits.maxPacketBytes) break;
        output.push(chunk); packetBytes += size + 1;
        item.sent = Math.max(item.sent, i + 1);
      }
      if (item.next < item.chunks.length) break;
    }
    return output;
  }

  clear() { this.items.clear(); }
}
module.exports = {checksum, encodeTransfer, IncomingTransfer, OutgoingTransfers};
