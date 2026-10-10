# Cursor Bridge protocol and design notes

## Trust boundary

The only HTTP listener is bound to `127.0.0.1`. Roblox Studio calls it through `HttpService:RequestAsync`. The listener accepts only JSON POST requests with `X-Cursor-Bridge: 1` and refuses requests with an Origin header. The pair route accepts a one-time short local pairing code and issues an unpredictable 256-bit session token. Every subsequent call requires a bearer token. Other Studio sessions receive HTTP 409 until the current session disconnects or times out. Browser views do not access the HTTP API directly; a restricted Electron preload exposes only predefined IPC methods.

## Routes

- `POST /v1/pair`: `{code, studioRunId, placeKey, placeName}`. Returns `{sessionId, token}`.
- `POST /v1/changes`: `{sequence, ops:[...]}`. One monotonically increasing batch sequence per session, idempotent on retries.
- `POST /v1/poll`: `{}`. Returns up to 25 outstanding write/open/mutate commands; Studio reports completion through `result` operations.
- `POST /v1/disconnect`: `{}`. Terminates the token immediately.

## Operation schema

- `reset`: clears the initial snapshot during pairing only.
- `upsert`: `{node:{id,parentId,name,className,siblingOrder?,source?,sourceAvailable?}}`. Parent IDs preserve exact hierarchy and allow name collisions.
- `source`: `{id,source}` from Studio text-buffer change.
- `remove`: `{id}` deletes a descendant subtree from the mirror.
- `ready`: indicates the initial snapshot has been sent.
- `result`: `{id,opId,status,source?}` is the result of a Studio-side operation.

## Hierarchy mutations

The renderer requests `bridge:mutate-hierarchy` through the isolated Electron preload, passing an action and selected instance IDs. The server validates names, allowed create classes, selected ancestor/descendant overlap, immutable service roots, destination ancestry, session readiness and pending locks. It captures optimistic node identity metadata (`id`, `parentId`, `name`, `className`) for the plugin to re-verify. Mutations are queued until acknowledged and never applied directly to the desktop mirror.

The Studio plugin executes `mutate` commands and returns `mutationResult` with an overall `applied`, `partial`, `conflict`, or `error` status and per-target details. It uses the actual Roblox Instances and attempts to group edits into ChangeHistoryService recordings. Existing node observers still drive authoritative upserts and removals back to the desktop. Successful create/duplicate results also include the actual new Studio instance ID so the desktop can select and open its script without guessing by name.

Delete preflight persists versioned backups for every script in the selected subtrees. The command also carries an Adler-32 / byte-length source fingerprint per script; Studio reads current script editor contents immediately before deleting and rejects if any fingerprint differs. This detects accidental concurrent edits, but is not a cryptographic integrity guarantee. The request is rejected if any script is unreadable, if edits are pending, or if more than 200 scripts would be affected. Operations time out with session loss and report their result as unknown rather than falsely claiming a failure when Studio might already have applied them.

## Write transactions

A Windows edit carries the last observed script revision. The server refuses stale revisions. Every outbound `write` command includes both `expectedSource` and `newSource`. Studio checks the edit-time source first and uses `ScriptEditorService:UpdateSourceAsync`, checking the callback's old source again. Repeated `opId` values cannot be applied twice in the Studio plugin. Server-side result processing advances the observed revision and allows one queued follow-up update. Conflicts are displayed to the user, and the local draft is stored to disk instead of silently overwriting Studio.

## Source ownership

Roblox Studio is authoritative. The Windows editor is a source-code view and optimistic editing interface. It does not execute Luau and does not claim to reproduce Roblox's full compiler, semantic type checker or engine type metadata. The source-to-XML build step serializes the plugin from modular files so Github history can diff the source directly.

## Performance and limits

Initial snapshot is batched into at most 75 operations and ~700 KiB of JSON per Studio request. Source is limited to 256 KiB per script, and the initial tree to 20,000 instances. Live changes are mostly event-driven and are drained approximately every 180 ms, excluding network and Studio runtime overhead. A rotating source audit checks up to 20 scripts on each poll for unusual edit paths that do not trigger change events. The renderer collapses folders and limits expanded DOM rows. Source-only updates do not redraw the entire tree. Marquee selection uses index-based row intervals rather than per-row layout reads.

## Recovery scope

The app writes versioned source files before external edits, records unsynced local drafts and saves a compressed workspace snapshot (periodically and on normal disconnect). Plugin `Unloading` is best effort only: an abrupt process exit is detected by heartbeat expiry. Recovery storage is **local** to the PC; neither GitHub nor Roblox cloud automatically receives recovery snapshots.

## Non-goals of version 0.2.0

Synchronizing non-script property values, server-side cross-device sessions, collaborative cursors, 100% Luau compilation/typechecking, multi-pane detached editor tabs, script sizes over 256 KiB, all engine services, and automatic Studio-plugin hot replacement are not shipped. Further versions can add language-server integration, property synchronization, and robust incremental tree streaming for large places.

## Studio GUI and plugin lifecycle

The UI follows the uploaded Cursor V2 plugin contract: `CoreGui/ScreenGui` floating windows, `CursorShell` for shared settings, `Primitives` for controls, `ThemeService` for palette changes, `CommandService` and `ShortcutService` for registered actions, `NotificationService` for feedback, and `Maid` for event cleanup. No dockable Studio widget is created.

The toolbar button initializes the controller lazily. Its active state mirrors the window visibility signal. Closing the window only hides the `ScreenGui`, so the background synchronization continues. Unloading the plugin, entering Play Test, or disconnecting explicitly shuts down the bridge and releases its session. See `plugin/source/Main.lua` and `plugin/source/Controllers/BridgeController.lua`.

## Quick Apply protocol (0.2.1)

Renderer -> Electron IPC `previewQuickApply(text, overrides)` -> `buildQuickApplyPlan` resolves script IDs and exact path guards against the live node map. Preview token expires after 5 minutes and is bound to the current Studio session. `applyQuickApply(token)` rechecks the plan, writes the full TXT to recovery, backs up each modified script, and queues one `quickApply` command. The Studio plugin executes via `Services/QuickApply.lua`, asynchronously relative to the heartbeat loop, and reports `quickApplyResult` through the existing acknowledged `/v1/changes` protocol. The renderer only reports completion after that result; unknown outcomes are not retried automatically. The parser treats AI output strictly as data, never executable Node code.


## Local code navigation (0.2.2)

Ctrl+P and Ctrl+Shift+F operate entirely in the Electron renderer using the current authenticated, Studio-origin DataModel mirror. The quick-open matcher ranks exact/prefix names ahead of path/fuzzy matches, never relying on sibling names for identity. Find in Place constructs a read-only snapshot from synchronized script source (or the local Monaco model when the script is being edited), then transfers it to a separate Vite-built Web Worker. RegExp parsing, line scanning and bounded excerpts execute in that worker, not the rendering thread. Queries are debounced, older workers are terminated, and slow searches are cancelled after 3.5 s. The sidebar renders grouped results with exact script IDs and Monaco ranges. On disconnect, the sidebar is hidden and pending worker activity is cancelled. No new HTTP route, Studio plugin permission or script-write mechanism is required.

Search results are limited to the first 3,000 matches, with a visible truncation notice. Sources unavailable through Roblox Studio (including oversized/unreadable scripts) are not guessed: the sidebar reports the number skipped. Case-sensitive, whole-word and regular-expression search use JavaScript regex semantics. Searches are line-based, not multi-line Lua AST queries or Luau type-aware references.

## Editing safety / asynchronous reconciliation (0.2.3)

The Monaco model is activated synchronously. A previously saved draft is considered only if the model, current Studio source and document edit generation still equal their captured opening values. A slow response never overwrites new typing. Each document tracks outgoing sources, authoritative revision and local edit generation. A Studio update may update a clean model or acknowledge a known outgoing source; a genuinely competing source keeps the local document and enters explicit manual resolution.

Outbound IPC for the same script is serialized, and disk recovery writes must complete before Studio write commands. Draft save and clear operations share a per-script server queue. Deletion is conditional on matching content unless an explicit discard is requested; new writes arriving after a clear remain intact. The Studio write observer can acknowledge an outstanding matching command before the explicit `result` event, without creating a false conflict.

The renderer keeps a synchronous, best-effort `localStorage` safety journal in addition to disk drafts. Disk drafts include place key and path; on a new instance ID, recovery by path requires exactly one match. Both are local backups, not an off-device guarantee. Storage quota errors are surfaced to the user. The existing Studio plugin and network protocol are unchanged.
