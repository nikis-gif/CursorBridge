# Cursor Bridge

**Cursor Bridge v0.2.5** is a Windows-first Luau workbench connected to the **currently paired Roblox Studio place**. It comprises a local Electron/Monaco application and a Roblox Studio plugin with the existing Cursor V2 floating window. Studio remains the source of truth for the DataModel; the workbench does not run games or replace Studio's compiler.

All connection traffic stays on `127.0.0.1:38471`. Source history, recovery snapshots, and unsynced drafts are stored locally on the PC.

**GitHub publishing:** The source is hosted at [nikis-gif/CursorBridge](https://github.com/nikis-gif/CursorBridge). Open **Actions > Build and publish Windows release > Run workflow** on `main`, or push a matching version tag. See [docs/GITHUB_RELEASE.md](docs/GITHUB_RELEASE.md). The release workflow publishes a public downloadable `.exe` and `latest.yml`.

## Install and run (Windows)

Requirements: **Node.js 22+**, Roblox Studio and, only for rebuilding the `.rbxmx`, Python 3.10+.

```powershell
npm install
npm test
npm run dev
```

To install or update the Studio plugin, first **close Roblox Studio**:

```powershell
PowerShell -ExecutionPolicy Bypass -File .\scripts\install-studio-plugin.ps1
```

Start the desktop app, open Roblox Studio, click **Cursor Bridge V2** on the Plugins toolbar and enter the six-digit pairing code. Grant Studio permission to call the localhost HTTP endpoint when asked. Do not leave older Cursor Bridge plugin copies installed. **The Studio plugin from v0.2.1 is fully compatible with this update**; reinstalling the plugin is not required when upgrading only the Windows app from v0.2.1 to v0.2.4.

## Workbench v0.2.4

- **Compact, context-aware Explorer:** Roblox-class-specific original SVG artwork, Studio-like Camera/Terrain prominence under Workspace, correctly nested services, and stable sibling order based on `GetChildren()` metadata rather than alphabetical sorting. Studio-hidden/internal services are not mirrored.
- **Low-distraction selection:** Click, Ctrl+Click, Shift+Click, keyboard range selection, and rectangular marquee selection by dragging from an empty portion of Explorer. The marquee uses tree offsets instead of measuring every node during each mouse movement. The selection toolbar occupies a permanent-height footer, so selecting objects does not shift the tree.
- **Native-feeling hierarchy actions:** Drag selected rows onto a new parent, or use Move To; Ctrl+D duplicates; Ctrl+C/Ctrl+X/Ctrl+V copies/cuts/pastes instances inside the live place; Ctrl+Shift+V pastes into the selected parent. F2 renames; Delete confirms deletion. The clipboard is scoped to the active place, not the Windows system clipboard.
- **Insert Object palette:** Ctrl+I, row-hover +, or Explorer + opens a searchable, categorized palette. Common scripting, 3D, communication, value, UI and media classes are supported. Existing sibling names may be repeated, as in Studio; objects are tracked using actual IDs, not name-based lookup.
- **Editable tab strip:** Drag tabs to reorder; middle-click closes; right-click opens tab actions; Ctrl+W closes; Ctrl+Shift+T reopens; Ctrl+Tab switches; Ctrl+P uses scored filename and hierarchy search with optional `ScriptName:line:column`; Ctrl+Alt+K reveals the active script in Explorer.
- **Independent appearance:** Four workbench themes, four Luau syntax palettes, font-family selection, font size/zoom, word wrap and minimap, with local persistence.
- **Faster feedback:** Explorer selection, tab opening and tab reordering happen locally without waiting for a Studio request. Source and hierarchy mutations are queued to Studio with confirmations. Polling is ~180 ms under normal local conditions, excluding request and Studio processing time.
- **Protection:** Source revision checks, script backups prior to writes and deletes, confirmation of structural changes, draft recovery on disconnect, single-session locking and automatic offline Explorer hiding.

### Shortcuts (focus Explorer for object operations)

| Action | Shortcut |
| --- | --- |
| Extend / toggle object selection | Shift+Click / Ctrl+Click |
| Box-select objects | Drag from empty Explorer space |
| Expand / collapse / navigate | Arrow keys, Home/End, PageUp/PageDown |
| Select visible tree rows | Ctrl+A |
| Find in Explorer | Ctrl+Shift+X or Ctrl+K |
| Insert Object | Ctrl+I |
| Copy / Cut / Paste instances | Ctrl+C / Ctrl+X / Ctrl+V |
| Paste Into the selected parent | Ctrl+Shift+V |
| Duplicate / rename / delete | Ctrl+D / F2 / Delete |
| Quick Open script | Ctrl+P |
| Find text across all readable scripts | Ctrl+Shift+F |
| Return to Explorer | Ctrl+Shift+E |
| Next / previous search result | F4 / Shift+F4 |
| Close / reopen tab | Ctrl+W / Ctrl+Shift+T |
| Change tab | Ctrl+Tab or Ctrl+1…9 |
| Reveal active script in Explorer | Ctrl+Alt+K |

Monaco's own shortcuts keep working **when the code editor is focused**; Explorer's clipboard commands do not intercept copying Luau text.

## How synchronization works

The Studio plugin sends batched instance metadata and Luau editor source to the authenticated localhost server. The server reports updates to the Electron renderer; writes and structural commands travel back to Studio and are applied only after Studio checks the current source, parent, class and identity. Desktop hierarchy never invents objects before Studio confirms them. A temporarily lost connection retains recovery data but never pretends an offline snapshot is live.

Structural delete safeguards include local backups of all readable script descendants and a Studio-side source fingerprint check before deletion. A stale source, unsupported class, service-root mutation, source size above 256 KiB or selection above protocol limits is rejected rather than quietly ignored. A command interrupted by disconnect can have an *unknown* final state: reconnect and inspect the tree.

## Testing and building

```powershell
npm test
python -m unittest discover -s tests -p 'test_*.py' -v
python scripts/build_plugin.py
npm run build
npm run package:win
```

Optional browser interaction tests require Playwright and its Chromium binary:

```powershell
python -m pip install playwright
python -m playwright install chromium
npm run test:ui
```

Browser tests simulate Studio responses; they do not validate live Roblox Studio, the Windows NSIS installer, network interruptions or an entire Luau compiler. For a release, explicitly test creating duplicate-named scripts, editing and reopening scripts, cut/paste between folders, multiclick/marquee selection, backups after disconnect and plugin unloading **in real Studio**.

## Publishing and updates

Read [docs/SETUP.md](docs/SETUP.md) before uploading to GitHub. Configure your actual GitHub repository in `package.json` (`build.publish[0]`); push source, `package-lock.json`, and a `v0.2.4` tag. The included GitHub Actions workflow compiles the installer and validates/uploads `CursorBridgeV2.rbxmx`. The installed desktop app can prompt for updates from GitHub Releases; Studio plugin upgrades are **not** currently automatic.

For architecture, security, and scope see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). For interface research and exact shortcut semantics see [docs/ENGINE_REFERENCE.md](docs/ENGINE_REFERENCE.md).

## Scope and asset license

This build is a **script and instance-hierarchy companion**, not a complete clone of Roblox Studio. It cannot render the 3D world, edit arbitrary instance properties, provide Roblox's full type checker, drag tabs into detached dockable panes, or reproduce every engine shortcut. Drag-and-drop to **reparent** is supported; changing the visual sort order of siblings with a horizontal insertion line is not. Some internal services are intentionally excluded from mirroring. System clipboard sharing of Instances and Paste Into **multiple different destinations simultaneously** are not implemented.

The user-provided Vanilla 3 icon pack has restrictions on incorporation/redistribution. **It is not bundled**. All class artwork in `renderer/icons.js` is original. The user-provided Cursor application icon is included with the user's project.

## Quick Apply (Ctrl+L)

Import a single AI-generated TXT containing multiple complete Luau scripts. Exact `SCRIPT/PATH/STATUS` headers identify which existing scripts to replace and which new scripts and folders to create. Preview destinations and NEW script classes, then apply the whole batch with Studio-side source checks, undo recording, backups, and conflict protection. Copy the AI format from the panel or use `docs/QUICK_APPLY_PROMPT.txt`.

See `docs/QUICK_APPLY_FORMAT.md` for the exact contract, limits, and recovery behavior. Quick Apply does not generate code and does not compile Luau; it imports the AI's scripts. Test the Studio plugin and application together on Windows.


## Navigation & Find in Place (v0.2.2)

- **Ctrl+P — Quick Open:** searches script names and exact hierarchy paths, ranks exact names ahead of fuzzy matches, and supports Arrow Up/Down, Enter, Escape. Enter `Inventory:35` or `Inventory:35:7` to open a specific line and column. Duplicate names remain distinguishable by their hierarchy and instance ID.
- **Ctrl+Shift+F — Find in Place:** switches the sidebar from Explorer to a grouped code-search view. Searches all readable script sources received from the connected Studio session, including current local editor edits. Each match shows its script, exact path, line, and highlighted excerpt. Select a match to jump to that Luau location.
- Search options: **Match Case**, **Whole Word**, **Regular Expression**, collapsible file groups, F4/Shift+F4 navigation, and match counts. Ctrl+Shift+E returns to the Explorer. Normal Ctrl+F remains Monaco's within-file search.
- Full-text searches execute in a dedicated Web Worker. Old queries are cancelled; potentially expensive regular expressions have a 3.5-second timeout. Results are capped at **3,000 displayed matches**; narrow the query for more. The app reports scripts whose source is unavailable (for example, due to Studio permissions or size limits), rather than claiming those scripts were searched.
- Search is **read-only**. This feature does not modify or replace scripts, use cloud services, index offline backups, or search Roblox assets beyond the current paired Place. Closing the Studio session removes the live Explorer and search view, as before.

**Upgrading from v0.2.2:** replace the Windows project with this version, run `npm install`, `npm test`, and `npm run dev`. Keep the existing v0.2.1+ Studio plugin installed. Build a Windows installer with `npm run package:win` after `npm run build` succeeds.

### Sync reliability (v0.2.3)

Editors open immediately and never discard typed characters because an older recovery lookup finishes late.
Changes are journaled locally as soon as they are typed, followed by disk-backed drafts before any Studio write is queued.
Roblox Studio remains the authority: concurrent remote edits show a conflict with both versions preserved, rather than silently replacing the editor buffer.
Outgoing writes are acknowledged individually; a delayed acknowledgement cannot clear a different, newer draft.
Reconnect recovery can offer a previous draft when its saved hierarchy path is unambiguous.

**Recovery:** use *Open recovery folder* in the app or the script's *History* view. If a conflict occurs, choose whether to reapply the local draft or reload the Studio version. Do not delete the backups or drafts directory during an update.

The Studio plugin is unchanged from the previous build. Update only the Windows project for this release. Automated tests exercise a simulated Studio transport; live Roblox Studio behavior still requires verification on Windows.


## High-load Studio transport (v0.2.5)

The Studio plugin now uses rate-aware adaptive polling: 1.5 seconds while idle and 0.55 seconds while there are queued changes. Source audits run every 2 seconds, rather than on every network cycle. On Roblox HttpService throttling ("Number of requests exceeded limit"), the plugin backs off exponentially (2–30 seconds) instead of treating the throttle itself as an immediately fatal local connection error. The desktop session heartbeat timeout is now 45 seconds to tolerate transient throttling.

The local session can still expire after a sustained outage. Disconnect or Place changes still require an explicit pairing step, and local drafts/backups continue to apply. These rates are intentionally conservative because other Studio plugins may share the Roblox HTTP request budget. Users upgrading from v0.2.4 must install both the Windows app and the updated v0.2.5 Studio plugin. This is a transport fix, not proof of support for arbitrarily large places; the current hierarchy, source-size and backup limits remain in effect.
