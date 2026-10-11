## 0.2.9 - Quick Apply and session reliability


## 0.3.0 - Discord Cloud Workspace

- Rebuilt the desktop shell with a Discord-inspired theme, rounded surfaces, activity rail, real session dashboard and a Quick Apply entry card.
- Integrated native Windows caption controls into the workbench palette; sandbox and context isolation remain enabled.
- Added left/right Explorer docking by drag handle or layout menu, keyboard resizing, persistent layout and reduced-motion controls.
- Added side-by-side and stacked views of a script with independent cursors and view states. Both views share one Monaco model and one draft/synchronization pipeline.
- Added tab-to-split drop targets, layout reset without touching code, and group-aware Ctrl+W / Ctrl+S shortcuts.
- Added the matching Discord preset to the Studio plugin, roomier panels and rounded controls. Existing saved theme choices are preserved.
- Added real-Monaco browser regressions plus layout/native-theme unit coverage; retained large-place, Quick Apply and recovery regression gates.
- Locked dependencies and made a version change on main automatically validate, build, tag and publish a complete Windows release.


- Resolve requested paths directly in Studio instead of requiring manually expanded Explorer pages.
- Preserve read-only preview, exact source/identity checks and explicit ambiguous/missing-path errors.
- Accept 16 MiB TXT bundles, 128 scripts and 2 MiB per script, with explicit byte limits.
- Fragment large JSON messages into acknowledged UTF-8 blocks and checkpoint failed batch retries.
- Keep an atomic on-disk Quick Apply input draft, independent of browser storage quotas.
- Separate yielding Studio commands from idle heartbeats; use one bidirectional exchange per cycle.
- Recover transient transport loss only for the original token/process/Place, without replaying unknown edits.
- Handle OS suspend/resume, bound completed-command/page caches and skip unchanged snapshots.
- Fix delayed preview responses, empty-source guards, fallback audit queuing and full-localStorage startup.
- Add a source publisher that verifies local/remote hashes and uses fast-forward-only GitHub commits.
- Tests: 94 Node cases, 11 XML checks, Chromium regression suites and 96-hour accelerated idle simulation. Live Studio soak and Windows installation are not yet validated.

## 0.2.8 — Demand-Paged Large Place Explorer

- Paired Roblox Studio sessions expose managed root services before the background scan finishes.
- Large folders load their immediate children in 150-item pages with an Explorer "Load more" row, avoiding an eager full-Place mirror.
- Automatic indexing has a bounded budget; previously unseen branches remain accessible by expanding the parent.
- Prevented partially indexed subtrees from being deleted/duplicated/moved without full coverage, and restricted Quick Apply to fully loaded target paths.
- Maintained source revisions, conflict protection, local drafts and Studio authority; marked global search as partial when the Place is on demand.
- Added Node protocol and Chromium regression tests for paging a folder that advertises 600,000 children.
- Known limit: 250,000 simultaneously indexed nodes in the desktop mirror; simulated tests do not establish live Roblox production capacity.

## 0.2.3 — Editing and Sync Reliability

- Prevented asynchronous draft recovery from replacing text typed immediately after opening a script. The model is shown without waiting for recovery I/O, and recovery is only offered if the document has not changed.
- Added document edit-generation checks and per-script write serialization. Old save requests are dropped or queued behind the current edit; Studio never overwrites a dirty editor without explicit conflict resolution.
- Distinguished Studio source acknowledgments from genuine external changes, including when the Studio source observer notifies before the write-result message.
- Serialized desktop draft save/clear operations, added compare-and-clear protection, and retained newer local drafts when an older Studio write fails.
- Added immediate last-resort recovery journaling in renderer local storage and preserved on-disk drafts during disconnect, session replacement and app shutdown where possible.
- Added recovery by exact script hierarchy path across Studio restarts; ambiguous matching names/paths are never auto-selected.
- Preserved all Workbench, Explorer, Quick Apply, Quick Open and Find in Place UI. No Studio plugin protocol change or reinstall is required for this release.
- Added focused server and real-Chromium renderer regressions for fast typing during load, cross-revision edits, lost heartbeat, simultaneous writes and stale drafts.

# Changelog

## 0.2.2 — Quick Open & Find in Place

- Enhanced Ctrl+P with intelligent name/path ranking, keyboard navigation, and `Name:line:column` navigation, preserving duplicate-name IDs and Studio hierarchy paths.
- Added Ctrl+Shift+F Find in Place as a native Cursor workbench sidebar, grouped by script, with line numbers, snippets, match counts, collapse, F4/Shift+F4 and Ctrl+Shift+E.
- Added case-sensitive, whole-word and regular-expression search toggles. Search uses the current Studio-synchronized source and the locally open Monaco model when edited.
- Added cancellable Web Worker searches with timeout, bounded 3,000-match responses, bounded snippets for long lines and explicit unavailable-source reporting.
- Kept Ctrl+F as Monaco's local file search, Ctrl+L Quick Apply, the existing Bridge server and Studio plugin unchanged.
- Added dedicated unit tests and Chromium interaction coverage for search, navigation, options, live updates and disconnected sessions.


## 0.2.1 — Quick Apply

- **Ctrl+L** opens the Quick Apply AI script bundle panel. The TXT parser follows the supplied 50-equals `SCRIPT/PATH/STATUS` contract.
- Preview resolves exact case-sensitive Studio paths, warns about ambiguous instances, highlights modified/new scripts, and supports class selection for NEW entries.
- A single batch command creates intermediate Folder instances, creates new Luau scripts, or replaces existing sources in Studio. Unchanged scripts are skipped.
- The desktop bridge saves the original TXT and versions of affected scripts before queueing edits. Studio validates sources and parent hierarchy again and uses an undo recording, with best-effort rollback on errors.
- Late network confirmations never automatically trigger a retry. The Ctrl+L dialog preserves pasted text until Studio confirms success.
- Added dedicated parser/protocol tests and browser UI tests. Existing Explorer and editor behavior is preserved.

## 0.2.0 - Studio-inspired workbench

- Reworked Explorer ordering: prioritize Workspace Camera and Terrain; use `GetChildren()` sibling order from Studio instead of alphabetical sorting of ordinary instances.
- Replaced generic instance symbols with a wider collection of class-specific, original SVG illustrations. Restricted Vanilla 3 assets are not redistributed.
- Restyled Explorer as a compact Studio-like tree with quieter neutral selection colors, hover insertion controls and direct row drag-to-reparent behavior.
- Added marquee selection that tracks content coordinates during scrolling without querying every node's layout on each mouse move. Existing Ctrl/Shift selection remains available.
- Added Explorer-scoped instance clipboard: Ctrl+C, Ctrl+X, Ctrl+V (Workspace), Ctrl+Shift+V (selected parent), and context-menu actions. Server/Studio validate copied-instance destinations, identity and cycle prevention.
- Added drag-reordering of script tabs, middle-click close, right-click tab actions, Ctrl+W/Ctrl+Shift+T, Ctrl+Tab/Ctrl+1–9, Ctrl+P Quick Open and Ctrl+Alt+K reveal.
- Added independent code syntax themes, font family/size, word wrap, minimap and persisted editor preferences without changing the workbench palette.
- Expanded the allowed, searchable Insert Object class palette for scripting, 3D, remote events, values, UI and media.
- Reduced nominal local polling interval from 450 ms to 180 ms; source-only updates do not rebuild Explorer; selection and tabs never wait on the HTTP bridge.
- Added server protocol tests for sibling ordering and Paste Into destinations, new workbench unit tests and headless Chromium interaction coverage with a simulated Studio.

## 0.1.4 - Explorer recovery and non-breaking UI polish

- Restored click-to-open and double-click-to-open scripts. Selection no longer replaces tree elements during pointer events.
- Replaced the intrusive multi-selection banner with fixed-height Explorer footer actions; the scrollable tree never shifts when selecting items.
- The complete Explorer, editor and tabs are hidden until a Studio session finishes indexing; offline recovery snapshots remain stored, not displayed as a live place.
- Reworked creation into a compact Insert Object menu. Script, LocalScript, ModuleScript and Folder are inserted under the chosen parent with Roblox's default name, even if that name already exists.
- Creating a script no longer forces an empty UpdateSourceAsync on new instances. The Studio plugin returns each new instance's actual ID and the Windows editor can focus/open it after authoritative synchronization.
- Duplicating an instance preserves its exact name (including duplicate sibling names) and respects current Studio script buffers.
- Replaced generic monochrome class icons with original, class-specific colored illustrations while keeping the Cursor V2 palette. Restricted Vanilla 3 assets are not embedded or redistributed.
- Added regression tests for selection transitions, duplicate sibling names, offline visibility, creation protocol and existing bridge behavior.

- Added optional Chromium browser interaction smoke coverage for Explorer click/selection, duplicate names, Studio acknowledgement, and offline reset.

## 0.1.3 - Minimal Explorer and hierarchy actions

- Redesigned the Windows app around a compact, Roblox-inspired Explorer and the Monaco editor; removed the permanently open statistics/activity sidebar.
- Added a discrete session popover, simpler toolbars, resizable Explorer, class-specific original icons, and lighter Obsidian styling.
- Added range selection with Shift+Click, additive Ctrl+Click, mouse sweep selection and drag-and-drop multi-instance moves with a dedicated drag grip.
- Added context menus, create scripts/folders, rename, duplicate, move-to picker, delete confirmation and keyboard shortcuts.
- Extended the local bridge protocol with Studio-acknowledged `mutate` commands, result reporting, optimistic hierarchy validation and pending-operation locks.
- Added deletion backups and Studio-side source checksum verification; refuse deletion if sources are unavailable, pending edits exist, or contents changed since backup.
- Added ChangeHistoryService integration (where available) and cloning of unsaved Luau script source inside folder/script duplicates.
- Added regression tests for hierarchy operations, multi-selection, recovery and incompatible parent/child moves.

## 0.1.2 - Cursor V2 Studio interface

- Replaced the Studio DockWidget with a CoreGui ScreenGui floating window.
- Reused the UI/Theme, UI/Primitives, UI/CursorShell, Core, and Maid modules from the provided Cursor V2 plugin examples.
- Added draggable title bar, resize grip, minimize and close/hide controls, settings panel, theme presets, feedback notifications, and toolbar active-state synchronization.
- Applied the supplied Studio icon `rbxassetid://132318313203288` to the toolbar and floating-window title bar.
- Preserved the existing local bridge protocol, hierarchy synchronization, exclusive session lock, and desktop editor.
- Protected network pairing and heartbeat callbacks during plugin shutdown.
- Added regression checks for the Cursor V2 module hierarchy, floating window, lifecycle, and icon.

## 0.1.1 - Monaco compatibility

- Replaced Monaco Editor private deep imports with public entry points for Monaco 0.57.

## 0.1.0 - Initial bridge

- Added local pairing, bidirectional Luau synchronization, backups, hierarchy snapshot, and Electron desktop application.
