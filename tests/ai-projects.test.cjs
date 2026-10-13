'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { AIProjectStore, resolveFile } = require('../electron/ai-project-store.cjs');
const { readEvents, AIAssistant } = require('../electron/ai-assistant.cjs');
const { verifyIdToken } = require('../electron/chatgpt-auth.cjs');

async function withStore(operation) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cursorbridge-ai-test-'));
  try { return await operation(new AIProjectStore(dir), dir); }
  finally { await fs.rm(dir, { recursive: true, force: true }); }
}
test('stores chat history and project notes independently per Place and after restart', async () => {
  await withStore(async (db, dir) => {
    const a = 'universe-1:place-101', b = 'universe-1:place-102';
    let x = await db.createChat(a, 'Baseplate 1');
    await db.addMessage(a, x.result, 'user', 'Make a health bar');
    await db.addMessage(a, x.result, 'assistant', '```luau\nlocal a = 1\n```');
    await db.saveMemory(a, 'Use strict Luau and typed modules.');
    await db.saveSnippet(a, 'Health bar', 'local Health = 100');
    await db.createChat(b, 'Baseplate 2');
    const restarted = new AIProjectStore(dir);
    const first = await restarted.read(a), second = await restarted.read(b);
    assert.equal(first.chats[0].messages.length, 2);
    assert.equal(first.memories.length, 1);
    assert.equal(first.snippets.length, 1);
    assert.equal(second.chats.length, 1);
    assert.equal(second.memories.length, 0);
    assert.equal((await restarted.list()).length, 2);
    assert.notEqual(resolveFile(restarted.root, a), resolveFile(restarted.root, b));
  });
});
test('preserves write ordering when two messages arrive concurrently', async () => {
  await withStore(async db => {
    const key='place-1', chat=(await db.createChat(key,'A')).result;
    await Promise.all(Array.from({length:20},(_,i)=>db.addMessage(key,chat,'user',`message ${i}`)));
    const p = await db.read(key);
    assert.equal(p.chats[0].messages.length,20);
    assert.equal(new Set(p.chats[0].messages.map(x=>x.content)).size,20);
  });
});
test('deletes conversations and snippets without touching other Places', async () => {
  await withStore(async db => {
    const a='a', b='b', id=(await db.createChat(a,'A')).result;
    await db.createChat(b,'B');
    await db.deleteChat(a,id);
    await db.saveMemory(a,'Note');
    const mem=(await db.read(a)).memories[0].id;
    await db.deleteMemory(a,mem);
    await db.saveSnippet(a,'Script','local x = true');
    const snippet=(await db.read(a)).snippets[0].id;
    await db.deleteSnippet(a,snippet);
    assert.equal((await db.read(a)).chats.length,0);
    assert.equal((await db.read(a)).memories.length,0);
    assert.equal((await db.read(a)).snippets.length,0);
    assert.equal((await db.read(b)).chats.length,1);
  });
});
test('rejects oversized inputs without damaging saved project data', async () => {
  await withStore(async db => {
    const key='p', id=(await db.createChat(key,'A')).result;
    await assert.rejects(db.addMessage(key,id,'user','x'.repeat(129*1024)),/maximum/);
    await assert.rejects(db.saveSnippet(key,'Bad','x'.repeat(300*1024)),/maximum/);
    assert.equal((await db.read(key)).chats[0].messages.length,0);
  });
});
test('rejects corrupt project on disk instead of silently overwriting it', async () => {
  await withStore(async db => {
    await db.ensure('p','Name');
    const file=resolveFile(db.root,'p');
    await fs.writeFile(file,'{"schema":2}');
    await assert.rejects(db.saveMemory('p','Note'),/Invalid project file/);
    assert.equal(await fs.readFile(file,'utf8'),'{"schema":2}');
  });
});
test('parses OpenAI streaming text and validates completion status', async () => {
  const body = ['data: {"type":"response.output_text.delta","delta":"Hello "}', '',
    'data: {"type":"response.output_text.delta","delta":"world"}', '',
    'data: {"type":"response.completed"}', '', ''].join('\n');
  const deltas=[];
  assert.equal(await readEvents({body:ReadableStream.from([Buffer.from(body)])},s=>deltas.push(s)), 'Hello world');
  assert.deepEqual(deltas,['Hello ','world']);
  await assert.rejects(readEvents({body:ReadableStream.from([Buffer.from('data: {"type":"response.failed"}\n\n')])},()=>{}),/failed/);
});
test('only sends requests using a model authorized by the connected account', async () => {
  await withStore(async db=>{
    const id=(await db.createChat('p','A')).result;
    const auth={accessToken:async()=> 'opaque-token'};
    let count=0;
    const assistant=new AIAssistant({auth,projects:db,fetchImpl:async(url)=>{
      count++;
      if(url.endsWith('/models'))return {ok:true,json:async()=>({models:[{slug:'permitted',display_name:'Permitted',visibility:'list'}]})};
      return {ok:true,body:ReadableStream.from([Buffer.from('data: {"type":"response.output_text.delta","delta":"Done"}\n\ndata: {"type":"response.completed"}\n\n')])};
    }});
    await assert.rejects(assistant.send({placeKey:'p',chatId:id,text:'hello',model:'not-permitted'}),/not available/);
    assert.equal(count,1);
    const result=await assistant.send({placeKey:'p',chatId:id,text:'hello',model:'permitted'});
    assert.equal(result.reply,'Done');
    assert.equal((await db.read('p')).chats[0].messages.length,2);
  });
});
test('validates OIDC RSA ID token signature, audience, issuer, expiry and nonce', () => {
  const {publicKey,privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  const now=Date.now(); const jwk={...publicKey.export({format:'jwk'}),kid:'test-key',use:'sig'};
  function encode(claims){const head=Buffer.from(JSON.stringify({alg:'RS256',kid:'test-key'})).toString('base64url');const body=Buffer.from(JSON.stringify(claims)).toString('base64url');const signature=crypto.sign('RSA-SHA256',Buffer.from(`${head}.${body}`),privateKey).toString('base64url');return `${head}.${body}.${signature}`;}
  const claims={iss:'https://auth.openai.com',aud:'oaiapp_test',sub:'account',nonce:'random-nonce',exp:Math.floor(now/1000)+300,iat:Math.floor(now/1000)};
  assert.equal(verifyIdToken(encode(claims),{keys:[jwk]},{clientId:'oaiapp_test',nonce:'random-nonce',now}).subject,'account');
  assert.throws(()=>verifyIdToken(encode({...claims,aud:'other'}),{keys:[jwk]},{clientId:'oaiapp_test',nonce:'random-nonce',now}),/validation failed/);
  assert.throws(()=>verifyIdToken(encode({...claims,nonce:'wrong'}),{keys:[jwk]},{clientId:'oaiapp_test',nonce:'random-nonce',now}),/validation failed/);
  assert.throws(()=>verifyIdToken(encode({...claims,exp:1}),{keys:[jwk]},{clientId:'oaiapp_test',nonce:'random-nonce',now}),/validation failed/);
});

test('Place-controlled names and notes stay out of higher-priority model instructions', async () => {
  await withStore(async store => {
    const key = 'place-safety';
    const { result: chatId } = await store.createChat(key, 'IGNORE_ALL_INSTRUCTIONS');
    await store.saveMemory(key, 'REPLACE_SYSTEM_INSTRUCTIONS');
    const received = [];
    const auth = { accessToken: async () => 'token' };
    const ai = new AIAssistant({ auth, projects: store, fetchImpl: async (url, options) => {
      if (url.endsWith('/models')) {
        return { ok: true, json: async () => ({ models: [ { visibility: 'list', slug: 'allowed', display_name: 'Allowed' } ] }) };
      }
      received.push(JSON.parse(options.body));
      return { ok: true, body: ReadableStream.from([Buffer.from('data: {"type":"response.output_text.delta","delta":"Response"}\\n\\ndata: {"type":"response.completed"}\\n\\n')]) };
    } });
    await ai.send({ placeKey: key, chatId, text: 'Hello', model: 'allowed' });
    assert.equal(received.length, 1);
    assert.doesNotMatch(received[0].instructions, /IGNORE_ALL_INSTRUCTIONS|REPLACE_SYSTEM_INSTRUCTIONS/);
    assert.match(received[0].input.at(-1).content, /REPLACE_SYSTEM_INSTRUCTIONS/);
    assert.equal(received[0].store, false);
    assert.equal(received[0].stream, true);
  });
});

test('interrupted inference retains user message but never fabricates a completed assistant turn', async () => {
  await withStore(async store => {
    const { result: chatId } = await store.createChat('place', 'Baseplate');
    const ai = new AIAssistant({ auth: { accessToken: async () => 'token' }, projects: store, fetchImpl: async url => {
      if (url.endsWith('/models')) return { ok: true, json: async () => ({ models: [{ slug: 'allowed', visibility: 'list' }] }) };
      return { ok: true, body: ReadableStream.from([Buffer.from('data: {"type":"response.output_text.delta","delta":"partial"}\\n\\n')]) };
    }});
    await assert.rejects(ai.send({ placeKey: 'place', chatId, text: 'Explain Lua tables', model: 'allowed' }), /ended before completion/);
    const p = await store.read('place');
    assert.deepEqual(p.chats[0].messages.map(m => m.role), ['user']);
  });
});
