# Editor reference and interaction contract (v0.2.0)

The workbench is inspired by, but not a byte-for-byte reproduction of, Roblox Studio, Unity, Unreal Engine or Godot. The authoritative Roblox Studio plugin controls DataModel edits.

## Roblox Studio (primary behavior reference)

Official documentation: [Explorer](https://create.roblox.com/docs/studio/explorer).

- The Explorer is a parent-child tree with expanders and class-dependent icons. Under Workspace, engine-owned Camera and Terrain entries receive priority over ordinary user-added objects; other children retain the order reported through Studio `GetChildren()` metadata.
- Hovering a parent exposes the insertion action. The searchable Insert Object palette is limited to an explicit list of classes whose constructors can be safely invoked by the plugin; Roblox Studio supports more classes than this workbench.
- Ctrl+D duplicates; Ctrl+V pastes to Workspace; Ctrl+Shift+V pastes into the selected parent. Ctrl+C and Ctrl+X are implemented as *session-local instance clipboards*, not interoperability with the Studio/system clipboard. Studio's multiple-destination Paste Into is not yet supported.
- Ctrl/Shift pointer selection and dragging an empty Explorer area to create a rectangular selection are supported. Dragging selected rows onto another instance **reparents** them. Only Studio acknowledges mutations.
- Arrow keys, Home/End, and PageUp/PageDown navigate visible rows; Ctrl+Shift+X finds objects. The workbench keeps standard Monaco editor text shortcuts isolated from Explorer shortcuts.
- Root services cannot be renamed, deleted, cloned or moved from the desktop. Internal CoreGui and NetworkClient objects are not mirrored because the bridge deliberately limits readable services and never synchronizes the plugin's own UI tree.

Script editor reference: [Script Editor](https://create.roblox.com/docs/studio/script-editor).

- Monaco implements Luau highlighting, bracket matching, normal editor undo/redo, and native editing operations. It also offers draggable tabs, middle-click close, tab context menus, Ctrl+W close, Ctrl+Shift+T reopen, Ctrl+P Quick Open and independent colors/font/minimap/word wrap settings.
- Hierarchy completion is based on the currently mirrored place and does not emulate Roblox's complete Luau language server or type inference.

## Unity (hierarchical drag interaction)

[Unity Hierarchy window](https://docs.unity3d.com/2023.2/Documentation/Manual/Hierarchy.html) uses indentation, context menus and drag-to-parent operations. Cursor Bridge adopts direct row dragging and grouping. Unity also supports inserting an object *between siblings* to control visual order; that feature is not supported by this bridge.

## Unreal Engine (scene Outliner)

[Unreal World Outliner](https://dev.epicgames.com/documentation/en-us/unreal-engine/world-outliner) emphasizes a dense searchable hierarchy, selection and dragging an Actor onto a target. Cursor Bridge favors compact rows, useful contextual actions and low visual noise instead of a permanent inspector.

## Godot (scripts, panels and docks)

[Godot editor layout](https://docs.godotengine.org/en/stable/getting_started/introduction/first_look_at_the_editor.html) and [Script Editor](https://docs.godotengine.org/en/stable/tutorials/editor/script_editor.html) use separate scene/script navigation, searchable script lists, drag-to-reorder and middle-click closing. Cursor Bridge implements reordering, closing/reopening, Quick Open and resizable Explorer. Godot's dock detachment and a complete multi-panel layout manager have **not** been implemented.

## Performance principles

1. Selection is painted by toggling classes on existing tree rows, without reconstructing DOM or contacting Studio.
2. Only real hierarchy metadata changes schedule a tree rebuild; source-only updates refresh Monaco and tabs.
3. The marquee selects by the contiguous row-offset interval, avoiding a layout read for each of thousands of rows on every mouse move. Auto-scroll keeps selection in content coordinates.
4. Desktop actions are queued quickly and return immediately; Studio confirms results asynchronously. The bridge must *not* optimistically fake object creation, movement or deletion, even if the user perceives an extra ~180 ms of transport latency.
5. The plugin polls localhost at ~180 ms and submits batched updates with acknowledged sequence numbers. This is near-real-time transport, not an instant or deterministic completion guarantee.

## Hard limits for this release

The bridge mirrors approved services and script sources of up to 256 KiB, caps its Studio scan at 20,000 instances, allows at most 50 top-level targets per structural mutation, and prevents deletion of more than 200 script descendants per request. The current renderer may mount up to 11,000 expanded DOM rows, so extremely large trees should be filtered or collapsed. GUI screenshots in the test suite use mock Studio data and must not be mistaken for end-to-end Studio integration evidence.

## Cursor Bridge navigation shortcuts (v0.2.2)

Roblox Studio documents `Ctrl+P` as Quick Open, `Ctrl+Shift+F` as Find All / Replace All across scripts, and `Ctrl+F` as the current-script Find/Replace action. Cursor Bridge implements Ctrl+P and the **find** portion of Ctrl+Shift+F; replace across all scripts is not part of this release. The Cursor Bridge panel is intentionally styled to match the Obsidian workbench rather than copying Studio's light UI.

| Shortcut | Behavior |
| --- | --- |
| Ctrl+P | Quick Open scripts by exact/fuzzy name or full hierarchy path |
| Ctrl+Shift+F | Search code across every readable script in the connected Studio Place |
| Ctrl+Shift+E | Return from Find in Place to the Explorer |
| F4 / Shift+F4 | Visit next / previous code-search result |
| Ctrl+F | Find within the currently open script using Monaco |
| Ctrl+L | Open Quick Apply for AI-generated script bundles |

Code search is performed on the local synchronized script mirror, with local edits taking priority if an unsynced Monaco model exists. No Studio plugin change is needed. If a script source cannot be read from Studio, the code search does not invent it and reports that source as unavailable.
