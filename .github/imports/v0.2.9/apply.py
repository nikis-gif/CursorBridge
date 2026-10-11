#!/usr/bin/env python3
"""Import reviewed v0.2.9 patches, checking every old and new Git blob."""
from __future__ import annotations
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
STAGE = Path(__file__).resolve().parent
PLUGIN = 'CursorBridgeV2.rbxmx'

def run(*args: str) -> str:
    return subprocess.check_output(args, cwd=ROOT, text=True, encoding='utf-8').strip()

def blob(data: bytes) -> str:
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()

def load() -> dict:
    manifest = json.loads((STAGE / 'manifest.json').read_text(encoding='utf-8'))
    if manifest['repository'] != 'nikis-gif/CursorBridge' or manifest['version'] != '0.2.9':
        raise RuntimeError('Wrong source manifest.')
    paths = [entry['path'] for entry in manifest['files']]
    if len(paths) != len(set(paths)) or len(paths) != 33:
        raise RuntimeError('Unexpected source file list.')
    for name in paths:
        if name.startswith('.') or any(part in ('..', '.') for part in Path(name).parts) or Path(name).is_absolute():
            raise RuntimeError(f'Unsafe source path: {name}')
    return manifest

def verify_file(entry: dict, generated: bool = False) -> None:
    file = ROOT / entry['path']
    data = file.read_bytes()
    if file.is_symlink():
        raise RuntimeError(f'Symbolic links are not allowed: {file}')
    if not generated and (blob(data) != entry['blob'] or hashlib.sha256(data).hexdigest() != entry['sha256']):
        raise RuntimeError(f'Source verification failed: {entry["path"]}')

def apply() -> None:
    manifest = load()
    if run('git', 'rev-parse', 'HEAD^') != manifest['baseCommit']:
        raise RuntimeError('The source branch is not the reviewed v0.2.8 baseline; nothing was applied.')
    if run('git', 'status', '--porcelain', '--untracked-files=no'):
        raise RuntimeError('Working tree is not clean.')
    for entry in manifest['files']:
        file = ROOT / entry['path']
        current = blob(file.read_bytes()) if file.exists() else None
        if current != entry['baseBlob']:
            raise RuntimeError(f'Baseline differs for {entry["path"]}; refusing to overwrite.')
    patch_files = []
    covered = []
    for patch in manifest['patches']:
        name = patch['path']
        if Path(name).name != name or not name.endswith('.patch'):
            raise RuntimeError('Unsafe patch filename.')
        file = STAGE / name
        if hashlib.sha256(file.read_bytes()).hexdigest() != patch['sha256']:
            raise RuntimeError(f'Patch checksum mismatch: {name}')
        patch_files.append(str(file))
        covered.extend(patch['files'])
    expected = {entry['path'] for entry in manifest['files'] if entry['path'] != PLUGIN}
    if len(covered) != len(expected) or set(covered) != expected:
        raise RuntimeError('Patch coverage does not match the reviewed file manifest.')
    run('git', 'apply', '--check', '--index', *patch_files)
    run('git', 'apply', '--index', '--whitespace=nowarn', *patch_files)
    changed = set(run('git', 'diff', '--cached', '--name-only').splitlines())
    if changed != expected:
        raise RuntimeError('Applied paths differ from the source manifest.')
    for entry in manifest['files']:
        if entry['path'] != PLUGIN:
            verify_file(entry)
    print(f'Imported and verified {len(expected)} exact source files; the plugin is regenerated from Luau.')

def finalize() -> None:
    manifest = load()
    for entry in manifest['files']:
        verify_file(entry, generated=entry['path'] == PLUGIN)
        if entry['path'] == PLUGIN:
            data = (ROOT / PLUGIN).read_bytes()
            entry['blob'] = blob(data)
            entry['sha256'] = hashlib.sha256(data).hexdigest()
    manifest.pop('patches', None)
    (ROOT / 'update-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    run('git', 'add', '--', *[entry['path'] for entry in manifest['files']], 'update-manifest.json')
    changed = set(run('git', 'diff', '--cached', '--name-only').splitlines())
    expected = {entry['path'] for entry in manifest['files']} | {'update-manifest.json'}
    if changed != expected:
        raise RuntimeError('Refusing to commit unexpected or missing paths.')
    print(f'{len(changed)} verified source and generated files staged for one commit.')

if __name__ == '__main__':
    if len(sys.argv) != 2 or sys.argv[1] not in ('apply', 'finalize'):
        raise SystemExit('Usage: apply.py apply|finalize')
    try:
        apply() if sys.argv[1] == 'apply' else finalize()
    except Exception as error:
        raise SystemExit(f'Import stopped without publishing: {error}')
