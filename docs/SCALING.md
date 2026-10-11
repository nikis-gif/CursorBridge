# Cursor Bridge v0.2.7 — Large Place Architecture

## Exact scope

This update addresses silent truncation and UI freezes encountered when a Roblox Studio
Place has tens or hundreds of thousands of Instances. It does **not** claim unlimited
instance capacity, type checking, non-script property synchronization, or a completed
enterprise-scale benchmark against live Roblox Studio.

## Streaming index

- Roblox Studio traverses managed services breadth-first, using `GetChildren()` on one
  parent at a time, with short yielding scan slices.
- The producer stops adding metadata when the bounded transport queue is full. A single
  HTTP batch transports up to 350 metadata or source operations (max 700 KiB).
- A `scanBegin` marker declares progressive mode. `ready` exposes the first discovered
  part of the tree. `scanProgress` reports the current count and `scanComplete` marks
  the first fully indexed hierarchy. Older plugins that only send `ready` are still
  accepted for backward compatibility.
- No artificial success is reported at the 250,000-instance safety ceiling. On reaching
  it, the scanner reports `scanLimit`; the desktop clearly warns that the tree is
  incomplete and blocks operations that could affect undiscovered descendants.
- Rename/reparent listeners remain active during and after scanning. Parent ordering
  is captured when its children are traversed. Scan queue entries are deduplicated.
- The plugin hydrates script source in bounded background batches. Opening a script
  before hydration requests its source with `loadSource`. Unreadable sources are
  reported rather than fabricated.

## Safety guarantees

- The server remains authoritative for IDs and revision-conflict checks.
- Deleting, moving, duplicating, and Quick Apply cannot run against a partial progressive
  index; creating and renaming indexed instances remain available.
- No server-side deletion or source overwrite is inferred from a delayed scan.
- Recovery snapshots are created after complete indexing and streamed through gzip to a
  temporary file followed by atomic rename. Script version backups and local drafts
  remain separate and unchanged.
- Existing studio sessions retain single-client exclusivity. The server has a 120s
  inactivity timeout to tolerate the plugin's rate-limit backoff; a hard Studio exit
  can therefore take longer to release the session automatically.

## Desktop performance

- The server polls pending command maps instead of linearly scanning every instance
  at every heartbeat.
- Renderer counts are incremental, and tree rebuilds are coalesced during background
  indexing. Only viewport rows plus a small overscan exist in the DOM.
- The 11,000-visible-row truncation is removed. The browser test navigates through
  100,007 objects and mounts fewer than 160 elements representing Explorer rows.
- Extremely wide or deep Places still consume memory for the full model. The hard safety
  ceiling is 250,000 instances and the rendered hierarchy has a 512-level depth guard.

## Run the tests

```powershell
npm install
npm test
npm run test:load
python -m unittest discover -s tests -p test_plugin_build.py -v
npm run test:ui
npm run test:ui:load
```

The 100k tests use synthetic nodes and a mocked Studio connection. They verify transport
semantics and desktop rendering, not Roblox networking performance, real script-editor
cost, or Team Create behavior. Validate with a duplicate of the actual Place before
production use. For a deployment used across many teams, additional profiling, telemetry,
continuous load tests, and a storage-backed index are recommended.
