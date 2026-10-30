# Setup and GitHub publishing

**Online release:** After the source is on GitHub, use **Actions > Build and publish Windows release > Run workflow** on `main`. The workflow can create the tag and publish the Windows installer. See [GITHUB_RELEASE.md](GITHUB_RELEASE.md) for complete instructions.

# Windows setup and GitHub publishing

All commands use **PowerShell** and must run from the directory containing `package.json`.

For the recommended, up-to-date publishing steps, see [GitHub Release guide](GITHUB_RELEASE.md).

## 1. Install prerequisites

Install [Node.js](https://nodejs.org/) **22.23.4–22.x, 24.22.1–24.x, or 26.12.1–26.x** with **npm 10.9.0+**, [Git](https://git-scm.com/), [Python 3](https://www.python.org/) (for rebuilding the Studio plugin), and Roblox Studio. Optionally install [GitHub CLI](https://cli.github.com/).

After extracting the project ZIP, open the directory in Visual Studio Code and run:

```powershell
node --version
npm --version
git --version
npm ci
npm test
npm run dev
```

Use the desktop pairing code to link the plugin. The toolbar button opens a custom floating Cursor V2 window in Studio rather than a dock panel. For Studio plugin installation:

```powershell
PowerShell -ExecutionPolicy Bypass -File .\scripts\install-studio-plugin.ps1
```

The installation script rejects corrupt Roblox XML files before copying them. Restart Studio after installing. The plugin appears on Studio's **Plugins** toolbar as **Cursor Bridge V2**. Enable its first-time network access request to `127.0.0.1:38471` if prompted. The desktop process must be running before pairing.

### Runtime requirements and verification

The host Node.js and Electron's embedded Node.js are separate runtimes:

| Use | Runtime |
| --- | --- |
| `npm ci`, `npm test`, Vite, `scripts/dev.cjs`, and electron-builder | Node.js installed on the development/build machine |
| GitHub validation and Windows release builds | Node.js 22.23.4, selected from `.nvmrc` |
| Desktop main process, local bridge, and installed Windows application | Electron 44.10.0 with embedded Node.js 24.22.1 |
| Renderer / Monaco | Electron's Chromium; Node integration stays disabled |
| Roblox plugin and Luau execution | Roblox Studio, independent of Node.js |

The host range is `>=22.23.4 <23 || >=24.22.1 <25 || >=26.12.1 <27`.
Each supported major has its own security floor. Older patches, odd-numbered
majors, prereleases, and unreviewed future majors are not accepted. `.npmrc`
enforces `engines` during npm installation; `devEngines` rejects unsupported
Node.js/npm versions before npm install, ci, and run commands. Use npm 10.9.0+
and do not bypass these checks with `--force` or configuration overrides.
These are tooling safeguards, not a restriction on which binaries a machine
owner can execute directly.

The [v0.4.2 release build](https://github.com/nikis-gif/CursorBridge/actions/runs/38346923233)
used host Node.js 22.23.3 and packaged Electron 44.7.0. That Electron release
[bundles Node.js 24.21.0](https://releases.electronjs.org/release/v44.7.0).
The patch updates the dependency and lockfile to
[Electron 44.10.0 / Node.js 24.22.1](https://releases.electronjs.org/release/v44.10.0),
within the same Electron major. The Windows validation and publishing workflows
execute the unpacked binary with `ELECTRON_RUN_AS_NODE=1` and fail unless it
reports the pinned Electron version and Node.js 24.22.1. Keep that expected Node.js
version in both workflows aligned with the official release metadata when
upgrading Electron again.

These floors address the [October 21, 2026 Node.js security release](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases),
including the applicable TLS, DNS, and Brotli fixes. No application exploit was
demonstrated. The backup store uses gzip/gunzip, not Brotli; the presence of a
vulnerable runtime alone does not establish a reachable exploitation path.

`node --version` only reports the host runtime. After `npm run package:win`,
inspect the actual unpacked Windows binary separately:

```powershell
node --version
$env:ELECTRON_RUN_AS_NODE = '1'
try {
  & '.\release\win-unpacked\Cursor Bridge.exe' -p 'JSON.stringify(process.versions)'
} finally {
  Remove-Item Env:ELECTRON_RUN_AS_NODE
}
```

For an installed copy, substitute its actual executable path. Existing v0.4.2
installers are not changed by editing the repository or updating system Node.js.
Publish a new application version after validation, then install that new Windows
build. The Studio plugin does not need a runtime-related change.
Windows verification must still cover launching the GUI, pairing with Studio,
two-way edits, Quick Apply, backup recovery, and the installer/updater flow;
reading runtime versions is not a replacement for those checks.

## 2. Configure the repository

Replace this value inside `package.json` before publishing:

```json
"publish": [{
  "provider": "github",
  "owner": "nikis-gif",
  "repo": "CursorBridge",
  "releaseType": "release"
}]
```

The `owner` **must match** your actual GitHub account or organization, and the repository **must be public** for standard unauthenticated GitHub Release update checks.

## 3. Prepare an update through a pull request

Use the existing repository and a PR branch. Update the package and lockfile
version together, match the plugin product version, rebuild its XML and add
bilingual release notes. Run the automated checks, then test the Windows candidate
with real Roblox Studio before merging. Keep backups of test data when validating
an upgrade from an installed release.

The [release guide](GITHUB_RELEASE.md) contains the exact automated commands,
manual checks, approval gate and candidate artifact download instructions.

## 4. Publish after validation and review

A `package.json` change merged into `main` automatically triggers
**Build and publish Windows release**. Manual dispatch is supported on `main`;
tag pushes do not trigger publication. The workflow creates the matching tag
only after regression tests, builds and packaged runtime checks pass.

The workflow requests `contents: write` for the built-in `GITHUB_TOKEN`, subject
to repository and organization policy. Never reuse a version/tag for another
commit or bypass review requirements.

A complete release contains the versioned Windows `.exe`, its `.blockmap`,
`latest.yml` and `CursorBridgeV2.rbxmx`. Verify the release job and those assets
before reporting a successful launch. Installed desktop clients can check for a
new public release, ask before downloading and offer to restart/install; this
production update path needs a post-publication Windows smoke test. Developer
builds do not auto-update. The Studio plugin is installed separately.

## 5. Build an unsigned installer locally

```powershell
npm run package:win
```

Output: `release/`.

Unsigned Windows installers can trigger Microsoft SmartScreen prompts. For widespread public distribution, configure Authenticode code signing. Never redistribute another person's private code-signing keys.

## Local server and failure recovery

- Only one running app and one connected Studio session can pair at a time.
- The server listens on `127.0.0.1:38471`; it is not exposed to LAN/WAN.
- If Studio closes unexpectedly, the desktop releases the session after approximately **6.5 seconds**.
- Network communication is local and **does not require the public Internet**. Internet outages can still affect Roblox Studio's cloud collaboration features.
- Pending desktop changes and recovery snapshots are saved locally. Select a script and click **History**, or click **Open recovery folder** in the inspector.
- A rejected local draft can be applied later with **Apply local draft**, after an explicit confirmation. The current Studio version is backed up before applying.

## Monaco Editor import repair (introduced in v0.1.1)

This release fixes Vite's `Failed to resolve import monaco-editor/esm/vs/...` error
when using Monaco Editor 0.57.x. If upgrading an existing checkout, overwrite the
source files, then run `npm install`, `npm run build`, and `npm run dev`. The
repaired application uses the stable `monaco-editor` entry and
`monaco-editor/editor/editor.worker?worker` with a Vite worker bundle.

Do not add deprecated deep imports back to `renderer/app.js`. For new projects,
commit the generated `package-lock.json` so CI installs the same package versions.

## Studio plugin UI conventions

The Studio plugin follows the same lifecycle as the uploaded Cursor V2 plugins:

- `Main.lua` owns the toolbar button, play-test guard, unload listener and visibility state.
- `UI/BridgeWindow.lua` creates one floating `ScreenGui` inside `CoreGui` with a draggable title bar, resize grip, minimize and close/hide buttons.
- `UI/Primitives.lua`, `UI/Theme.lua` and `UI/CursorShell.lua` are copied from the supplied Cursor V2 example and provide the consistent UI controls, presets, settings and shortcuts.
- `Core/*`, `Packages/Maid.lua`, and `Config/Defaults.lua` use the same layout and settings contract.
- `Services/StudioBridge.lua` retains the existing two-way source synchronization protocol.

Closing the floating window hides it without disconnecting. To disconnect, click **Disconnect**; Play Test and plugin unloading also release the connection automatically.

The toolbar and title-bar icons use `rbxassetid://132318313203288`.

## Explorer behavior in v0.2.0

- The Explorer only appears after Studio is connected and the initial scan is complete. Disconnecting immediately hides the hierarchy and editor; backups remain on disk.
- Selecting an instance does not move the tree. Select multiple items with Shift or Ctrl, then use the compact actions in the Explorer footer or the context menu.
- Click **+** to insert a Script, LocalScript, ModuleScript, or Folder into the selected instance; use **Custom name…** for custom names. Roblox allows sibling instances to share identical names, and Cursor Bridge distinguishes them using their Studio IDs.
- The app waits for the Studio confirmation before showing created or duplicated instances. Studio returns the new instance ID to help focus the correct script.
- The supplied Vanilla 3 icon theme carries a personal-use-only license that prohibits embedding its assets in other applications or reuploading them to GitHub. Cursor Bridge ships independently drawn colored class icons; exact Vanilla artwork requires permission from its creator.

The app and Studio plugin must both be updated together to v0.2.1; older versions do not support Quick Apply and can break instance-focus behavior.

## Import AI script bundles

With Studio connected, press **Ctrl+L** in the desktop app. Copy the instructions from `docs/QUICK_APPLY_PROMPT.txt` to your code-generation AI, paste its single TXT response into Quick Apply, inspect the resolved paths and new classes, and choose Apply to Studio. Quick Apply requires the v0.2.1 Studio plugin. See `docs/QUICK_APPLY_FORMAT.md`.


### Navigation update (v0.2.2)

This update is Windows-app-only. The v0.2.1 Studio plugin remains compatible, so there is no need to reinstall the `.rbxmx` after upgrading from v0.2.1. `Ctrl+P` opens the ranked Quick Open script picker. `Ctrl+Shift+F` opens a Find in Place sidebar, and `Ctrl+Shift+E` returns to Explorer. For all global code search results, the place must remain connected and the Studio plugin must have delivered readable script source.

### Safe editing update (v0.2.3)

Replace the Windows app's source directory with the complete v0.2.3 archive. Do not delete your existing app data, drafts or recovery folders. The Studio plugin remains compatible: **no reinstall is required if you already use the v0.2.1/v0.2.2 plugin**.

Run `npm install`, `npm test`, then `npm run dev` from the updated source tree. Test opening a script and typing immediately, then verify it stays intact through a Studio source sync. If an external Studio change happens while you are editing, the workbench will preserve the draft and request explicit conflict resolution.

If a recovered version is offered, inspect it before replacing the live editor contents. Recovery by hierarchy path is conservative and declines ambiguous duplicate paths.
