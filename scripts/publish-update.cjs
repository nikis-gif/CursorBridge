'use strict';

// Upload a verified source update through the user's existing GitHub CLI login.
// No personal access token is read, embedded, copied or printed by this script.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');

function gh(args, body) {
  const result = spawnSync('gh', args, {encoding:'utf8',windowsHide:true,
    input:body === undefined ? undefined : JSON.stringify(body),maxBuffer:32*1024*1024});
  if (result.error) throw new Error(`GitHub CLI could not start. Install it and run gh auth login. ${result.error.message}`);
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'GitHub command failed.').trim());
  if (!result.stdout.trim()) return null;
  try { return JSON.parse(result.stdout); } catch { return result.stdout.trim(); }
}
function api(client, endpoint, method='GET', data) {
  const args=['api','--method',method,endpoint];
  if (data !== undefined) args.push('--input','-');
  return client(args,data);
}
function hash(kind, bytes) { return crypto.createHash(kind).update(bytes).digest('hex'); }
function blobHash(bytes) { return hash('sha1',Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes])); }

function publish({root=path.join(__dirname,'..'),client=gh,log=console.log}={}) {
  const manifestPath=path.join(root,'update-manifest.json');
  const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  const repo='nikis-gif/CursorBridge';
  if (manifest.repository !== repo || manifest.version !== '0.2.9' || !Array.isArray(manifest.files) || !manifest.files.length) {
    throw new Error('Invalid release source manifest. Extract the original update ZIP again.');
  }
  const files=[];const used=new Set();
  for(const entry of manifest.files) {
    if (typeof entry.path !== 'string' || !/^[A-Za-z0-9_.\/-]+$/.test(entry.path) ||
        entry.path.split('/').some(part=>part==='..'||part==='.'||!part) || entry.path.startsWith('.') || used.has(entry.path)) {
      throw new Error('Unsafe or duplicated path in update manifest.');
    }
    used.add(entry.path);
    const bytes=fs.readFileSync(path.join(root,entry.path));
    if (hash('sha256',bytes) !== entry.sha256 || blobHash(bytes) !== entry.blob) throw new Error(`Local file changed: ${entry.path}. Nothing was published.`);
    files.push({...entry,bytes});
  }
  log(`Checking ${repo} before uploading Cursor Bridge ${manifest.version}...`);
  const head=api(client,`repos/${repo}/git/ref/heads/main`).object.sha;
  const commit=api(client,`repos/${repo}/git/commits/${head}`);
  const tree=api(client,`repos/${repo}/git/trees/${commit.tree.sha}?recursive=1`);
  if (tree.truncated || !Array.isArray(tree.tree)) throw new Error('Incomplete repository tree. No source changes were made.');
  const remote=new Map(tree.tree.filter(item=>item.type==='blob').map(item=>[item.path,item.sha]));
  const changed=[];
  for(const file of files) {
    const current=remote.get(file.path) || null;
    if(current===file.blob)continue;
    if(current!==file.baseBlob)throw new Error(`GitHub file changed since this update was prepared: ${file.path}. Refusing to overwrite it.`);
    changed.push(file);
  }
  if(!changed.length){log('All source files already match this update. No new commit or release was created.');return {changed:false,sha:head};}
  const entries=[];
  for(const [index,file] of changed.entries()) {
    log(`[${index+1}/${changed.length}] ${file.path}`);
    const result=api(client,`repos/${repo}/git/blobs`,'POST',{content:file.bytes.toString('base64'),encoding:'base64'});
    if(result.sha!==file.blob)throw new Error(`GitHub blob verification failed: ${file.path}`);
    entries.push({path:file.path,mode:'100644',type:'blob',sha:result.sha});
  }
  const nextTree=api(client,`repos/${repo}/git/trees`,'POST',{base_tree:commit.tree.sha,tree:entries});
  const nextCommit=api(client,`repos/${repo}/git/commits`,'POST',{
    message:'Cursor Bridge v0.2.9: live Quick Apply paths, chunked bundles and session recovery',
    tree:nextTree.sha,parents:[head]});
  const current=api(client,`repos/${repo}/git/ref/heads/main`).object.sha;
  if(current!==head)throw new Error('The repository changed during upload. No branch was overwritten. Run again after reviewing the changes.');
  // A concurrent commit after the check is also protected by fast-forward only.
  api(client,`repos/${repo}/git/refs/heads/main`,'PATCH',{sha:nextCommit.sha,force:false});
  log(`Source published: ${nextCommit.sha}`);
  try {
    api(client,`repos/${repo}/actions/workflows/release.yml/dispatches`,'POST',{ref:'main'});
    log('Windows release build requested. This is not a build-success confirmation.');
  } catch(error) {
    log(`Source upload succeeded, but the release could not be started: ${error.message}`);
    log('Open GitHub Actions > Build and publish Windows release > Run workflow > main.');
  }
  log(`https://github.com/${repo}/actions/workflows/release.yml`);
  return {changed:true,sha:nextCommit.sha};
}
if(require.main===module){try{publish();}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={publish,blobHash};
