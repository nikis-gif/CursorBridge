'use strict';

// OpenAI Sign in with ChatGPT (OSS) Authorization Code + PKCE, local to this PC.
// Tokens never enter the renderer, Roblox plugin, or the localhost bridge.
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const AUTH_ORIGIN = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const NEEDED_SCOPE = 'chatgpt.tokens.use.direct';
const CALLBACK_PATH = '/auth/callback';

const base64url = (input) => Buffer.from(input).toString('base64url');
const random = () => crypto.randomBytes(32).toString('base64url');

function verifyIdToken(jwt, jwks, { clientId, nonce, now = Date.now() }) {
  if (typeof jwt !== 'string' || jwt.length > 12000) throw new Error('Invalid identity token.');
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('Invalid identity token format.');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('Unsupported ID token signature.');
  const jwk = jwks.keys?.find(key => key.kid === header.kid && key.kty === 'RSA' && key.use !== 'enc');
  if (!jwk) throw new Error('Unable to verify account identity.');
  const trustedKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const signatureOk = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), trustedKey, Buffer.from(parts[2], 'base64url'));
  if (!signatureOk || claims.iss !== AUTH_ORIGIN ||
      !(claims.aud === clientId || (Array.isArray(claims.aud) && claims.aud.includes(clientId))) ||
      !Number.isFinite(claims.exp) || claims.exp * 1000 <= now ||
      !Number.isFinite(claims.iat) || claims.iat * 1000 > now + 60_000 ||
      claims.nonce !== nonce || typeof claims.sub !== 'string' || !claims.sub) {
    throw new Error('ChatGPT identity validation failed.');
  }
  return { issuer: claims.iss, subject: claims.sub, email: String(claims.email || ''), name: String(claims.name || claims.email || 'ChatGPT'), idToken: jwt };
}

async function readJson(response) {
  const body = await response.text();
  let data;
  try { data = JSON.parse(body); } catch { throw new Error(`ChatGPT authorization returned HTTP ${response.status}.`); }
  if (!response.ok) throw new Error(`ChatGPT authorization failed (${data.error || response.status}).`);
  return data;
}

class ChatGPTAuth {
  constructor({ userData, safeStorage, openExternal, fetchImpl = fetch, onChange = () => {} }) {
    this.root = path.join(userData, 'chatgpt');
    this.safeStorage = safeStorage;
    this.openExternal = openExternal;
    this.fetchImpl = fetchImpl;
    this.onChange = onChange;
    this.credentials = null;
    this.pending = null;
    this.refreshPromise = null;
    this.hostId = null;
    this.authEpoch = 0;
    this.credentialWrite = Promise.resolve();
  }
  encryptionAvailable() { return Boolean(this.safeStorage?.isEncryptionAvailable()); }
  async init() {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    const hostFile = path.join(this.root, 'host-id.txt');
    try { this.hostId = (await fs.readFile(hostFile, 'utf8')).trim(); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.hostId = `urn:uuid:${crypto.randomUUID()}`;
      await fs.writeFile(hostFile, this.hostId, { flag: 'wx', mode: 0o600 });
    }
    if (!/^urn:uuid:[0-9a-f-]{36}$/i.test(this.hostId)) throw new Error('Invalid saved ChatGPT host ID.');
    if (!this.encryptionAvailable()) return;
    try {
      const encrypted = await fs.readFile(path.join(this.root, 'credentials.bin'));
      this.credentials = JSON.parse(this.safeStorage.decryptString(encrypted));
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('ChatGPT credentials could not be decrypted; sign-in is unavailable until repaired.');
    }
  }
  async save() {
    if (!this.encryptionAvailable()) throw new Error('Secure credential storage is not available on this device.');
    // Serialize credential writes so a late refresh cannot overwrite a sign-out.
    const write = this.credentialWrite.catch(() => {}).then(async () => {
      const file = path.join(this.root, 'credentials.bin');
      const temp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
      try {
        const payload = this.safeStorage.encryptString(JSON.stringify(this.credentials));
        await fs.writeFile(temp, payload, { flag: 'wx', mode: 0o600 });
        await fs.rename(temp, file);
      } catch (error) { await fs.rm(temp, { force: true }).catch(() => {}); throw error; }
    });
    this.credentialWrite = write;
    return write;
  }
  status() {
    const c = this.credentials;
    return { connected: Boolean(c?.access_token && c.scopes?.includes(NEEDED_SCOPE)),
      email: c?.email || '', displayName: c?.name || '',
      secureStorage: this.encryptionAvailable(), pending: Boolean(this.pending) };
  }
  async discovery() {
    const response = await this.fetchImpl(`${AUTH_ORIGIN}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(12000) });
    const conf = await readJson(response);
    if (!conf.jwks_uri?.startsWith(`${AUTH_ORIGIN}/`)) throw new Error('Untrusted ChatGPT identity keys endpoint.');
    return conf;
  }
  async startSignIn() {
    if (!this.encryptionAvailable()) throw new Error('Windows credential encryption is unavailable.');
    if (this.pending) throw new Error('A ChatGPT sign-in is already in progress.');
    const authEpoch = ++this.authEpoch;
    const state = random(), nonce = random(), verifier = random();
    const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
    const previous = this.credentials;
    const clientId = previous?.client_id || 'dynamic_agent_client';
    const server = http.createServer();
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
    });
    const redirect = `http://127.0.0.1:${server.address().port}${CALLBACK_PATH}`;
    let timer;
    const close = () => { clearTimeout(timer); server.close(); this.pending = null; this.onChange(this.status()); };
    this.pending = { close };
    server.on('request', (request, response) => {
      const url = new URL(request.url, redirect);
      if (url.pathname !== CALLBACK_PATH || request.method !== 'GET' || request.headers.host !== `127.0.0.1:${server.address().port}`) {
        response.writeHead(404).end('Not found'); return;
      }
      const received = url.searchParams.get('state') || '';
      const valid = received.length === state.length && crypto.timingSafeEqual(Buffer.from(received), Buffer.from(state));
      if (!valid) { response.writeHead(400).end('Invalid authorization state'); return; }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end('<!doctype html><meta charset="utf-8"><title>Cursor Bridge</title><body style="font:16px system-ui;background:#141417;color:#eee;padding:40px"><h2>Cursor Bridge</h2><p>Authorization received. Return to the application to check the result.</p></body>');
      const code = url.searchParams.get('code');
      const issuedId = url.searchParams.get('client_id') || (previous?.client_id || '');
      const oauthError = url.searchParams.get('error');
      close();
      if (oauthError || !code || !issuedId ||
          (clientId !== 'dynamic_agent_client' && issuedId !== clientId)) {
        this.onChange({ ...this.status(), error: oauthError || 'Incomplete ChatGPT authorization.' });
        return;
      }
      this.finishSignIn({ code, issuedId, verifier, redirect, nonce, previous, authEpoch })
        .then(() => this.onChange(this.status()))
        .catch(error => this.onChange({ ...this.status(), error: error.message }));
    });
    timer = setTimeout(() => { if (this.pending) { close(); this.onChange({ ...this.status(), error: 'ChatGPT sign-in timed out.' }); } }, 180000);
    timer.unref?.();
    const url = new URL(`${AUTH_ORIGIN}/api/accounts/authorize`);
    const args = { client_id: clientId, ext_agent_host_id: this.hostId, response_type: 'code', redirect_uri: redirect,
      scope: SCOPES, resource: RESOURCE, state, nonce, code_challenge_method: 'S256', code_challenge: challenge };
    if (clientId === 'dynamic_agent_client') args.agent_name_hint = 'Cursor Bridge';
    else if (previous?.id_token) args.id_token_hint = previous.id_token;
    for (const [key, value] of Object.entries(args)) url.searchParams.set(key, value);
    try { await this.openExternal(url.toString()); }
    catch (error) { close(); throw error; }
    this.onChange(this.status());
    return this.status();
  }
  async finishSignIn({ code, issuedId, verifier, redirect, nonce, previous, authEpoch = this.authEpoch }) {
    if (!/^oaiapp_[\w-]+$/.test(issuedId)) throw new Error('Invalid issued ChatGPT client identifier.');
    const form = new URLSearchParams({ grant_type: 'authorization_code', client_id: issuedId,
      code, code_verifier: verifier, redirect_uri: redirect, resource: RESOURCE });
    const response = await this.fetchImpl(`${AUTH_ORIGIN}/api/accounts/oauth/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form, signal: AbortSignal.timeout(15000),
    });
    const tokens = await readJson(response);
    if (!tokens.id_token || !tokens.access_token || !tokens.refresh_token) throw new Error('Incomplete ChatGPT token response.');
    const conf = await this.discovery();
    const jwks = await readJson(await this.fetchImpl(conf.jwks_uri, { signal: AbortSignal.timeout(12000) }));
    const identity = verifyIdToken(tokens.id_token, jwks, { clientId: issuedId, nonce });
    if (previous?.subject && previous.subject !== identity.subject) throw new Error('The selected ChatGPT account does not match the saved account.');
    const scopes = String(tokens.scope || '').split(/\s+/).filter(Boolean);
    if (!scopes.includes(NEEDED_SCOPE)) throw new Error('ChatGPT plan usage permission was not granted.');
    if (authEpoch !== this.authEpoch) throw new Error('ChatGPT authorization was cancelled.');
    const record = { ...identity, client_id: issuedId, access_token: tokens.access_token,
      refresh_token: tokens.refresh_token, scopes, expiresAt: Date.now() + (Number(tokens.expires_in) || 3600) * 1000 };
    const old = this.credentials;
    this.credentials = record;
    try { await this.save(); } catch (error) { if (this.credentials === record) this.credentials = old; throw error; }
    if (authEpoch !== this.authEpoch || this.credentials !== record) throw new Error('ChatGPT authorization was cancelled.');
  }
  async accessToken() {
    if (!this.credentials?.access_token || !this.credentials.scopes.includes(NEEDED_SCOPE)) throw new Error('Connect a ChatGPT account before sending messages.');
    if (Date.now() + 90_000 < this.credentials.expiresAt) return this.credentials.access_token;
    const epoch = this.authEpoch;
    if (!this.refreshPromise) this.refreshPromise = this.refresh().finally(() => { this.refreshPromise = null; });
    await this.refreshPromise;
    if (epoch !== this.authEpoch || !this.credentials?.access_token) throw new Error('ChatGPT account changed during token renewal.');
    return this.credentials.access_token;
  }
  async refresh() {
    const previous = this.credentials, authEpoch = this.authEpoch;
    const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: previous.client_id,
      refresh_token: previous.refresh_token, resource: RESOURCE });
    const response = await this.fetchImpl(`${AUTH_ORIGIN}/api/accounts/oauth/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(15000),
    });
    const data = await readJson(response);
    if (!data.access_token || !data.refresh_token) throw new Error('ChatGPT token renewal failed.');
    const newScopes = data.scope ? String(data.scope).split(/\s+/) : previous.scopes;
    if (!newScopes.includes(NEEDED_SCOPE)) throw new Error('ChatGPT plan access revoked.');
    if (authEpoch !== this.authEpoch || this.credentials !== previous) throw new Error('ChatGPT account changed during token renewal.');
    const renewed = { ...previous, access_token: data.access_token, refresh_token: data.refresh_token,
      scopes: newScopes, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
    this.credentials = renewed;
    try { await this.save(); } catch (error) { if (this.credentials === renewed) this.credentials = previous; throw error; }
    if (authEpoch !== this.authEpoch || this.credentials !== renewed) throw new Error('ChatGPT account changed during token renewal.');
  }
  async signOut() {
    ++this.authEpoch;
    this.pending?.close();
    const prior = this.credentials;
    this.credentials = prior ? { ...prior, access_token: '', refresh_token: '', id_token: '' } : null;
    this.onChange(this.status()); // Cancel model streams before credential persistence.
    await this.save();
    if (!prior?.refresh_token) return { ok: true };
    try {
      const conf = await this.discovery();
      if (!conf.revocation_endpoint?.startsWith(`${AUTH_ORIGIN}/`)) return { ok: true, warning: 'Remote revocation not confirmed.' };
      const body = new URLSearchParams({ token: prior.refresh_token, token_type_hint: 'refresh_token', client_id: prior.client_id });
      const response = await this.fetchImpl(conf.revocation_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(12000) });
      return response.ok ? { ok: true } : { ok: true, warning: 'Remote revocation not confirmed.' };
    } catch { return { ok: true, warning: 'Remote revocation not confirmed; disconnect in ChatGPT Settings if needed.' }; }
  }
  close() { this.pending?.close(); }
}

module.exports = { ChatGPTAuth, verifyIdToken };
