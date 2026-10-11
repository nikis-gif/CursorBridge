# Cursor Bridge v0.2.8 — On-Demand Explorer for Large Places

## Why full scans failed

Earlier releases tried to enumerate and mirror the entire Roblox DataModel. The plugin
had an automatic indexing ceiling of 250,000 Instances. Extremely large Places could
spend minutes in "Preparing your workspace", hit that ceiling, and leave users with
only a small fraction of the Explorer. Raising the ceiling again would increase Roblox
Studio memory usage, instance event connections, HTTP transfers and desktop memory.

## On-demand browsing

- The plugin sends managed service roots and `ready` before background indexing.
- Background indexing uses a bounded budget of up to 8,000 new watched Instances.
  Parents with more than 800 children are deferred, not silently discarded.
- Clicking/expanding a folder requests a page from the Studio plugin through the
  authenticated `/v1/poll` protocol. Each response returns up to 150 immediate
  children, with exact IDs, class names, names, order, `hasChildren`, and a cursor.
- The Explorer offers **Load more** for additional siblings. Folders deeper than the
  indexed set can always be reached by expanding their parents.
- All page requests are individually acknowledged. Repeated requests while a page is
  pending are deduplicated. Invalid pages and wrong-parent IDs are rejected.
- Roblox retains at most eight temporary high-cardinality sibling snapshots; older
  page cursors may need to be restarted if they have been evicted.
- Script source is requested separately when opening a script whose source is not yet
  mirrored. External changes to *observed* scripts are synchronized as before.
- The desktop renders only the Explorer viewport. A Place may have far more Instances
  than the number of nodes currently loaded into desktop memory.

## Honest limits and safety

This is **on-demand navigation**, not proof of an unbounded or fully mirrored Place.
The desktop still caps the number of *currently indexed* nodes at 250,000 to protect
memory; pages outside the loaded tree are not counted against that limit. In a folder
containing hundreds of thousands of direct children, users may need many pages to reach
late entries. Extremely deep trees still have a 512-level traversal safeguard.

- Source backup/version checks remain authoritative and edits are conflict-guarded.
- Structural deletion, movement and duplication require the entire selected subtree
  to be loaded and backed up where necessary; editing and inserting into already
  discovered nodes remain supported.
- Quick Apply in a partially indexed Place only accepts paths whose existing
  ancestor folders and destinations are **fully loaded**. Source must be readable.
- Quick Open and Find in Place search *indexed scripts*, not yet-unvisited scripts.
  The UI explicitly labels these partial results.
- No incomplete scan is reported as a fully indexed Place.
- On reconnection, Studio remains the source of truth. Local unsynchronized drafts
  and previously saved source versions remain separate and recoverable.

## Automated verification

The Node suite exercises paging, duplicate requests, source ownership, spoofed page
payloads and destructive-operation safeguards. Chromium tests exercise a folder
advertising 600,000 children, with only its first 150 present in the desktop model.
The tests validate the architecture, not real Roblox Studio's maximum attainable
performance or a Team Create production deployment.

Run:

```powershell
npm install
npm test
python -m unittest discover -s tests -p test_plugin_build.py -v
npm run test:ui
npm run test:ui:load
```

For enterprise adoption, validate with a duplicate of the target Place and capture:
initial root availability, page latency, memory usage, script edit round-trip,
Studio HTTP throttling, reconnection time and recovery outcomes. A future release
could add server-side cross-Place search, automatic folder page prefetch, eviction
of collapsed desktop subtrees, and source indexing without walking every Instance.
