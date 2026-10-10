# Setup and GitHub publishing

**Online release:** After the source is on GitHub, use **Actions > Build and publish Windows release > Run workflow** on `main`. The workflow can create the tag and publish the Windows installer. See [GITHUB_RELEASE.md](GITHUB_RELEASE.md) for complete instructions.

# Windows setup and GitHub publishing

All commands use **PowerShell** and must run from the directory containing `package.json`.

For the recommended, up-to-date publishing steps, see [GitHub Release guide](GITHUB_RELEASE.md).

## 1. Install prerequisites

Install [Node.js 22 LTS or newer](https://nodejs.org/), [Git](https://git-scm.com/), [Python 3](https://www.python.org/) (for rebuilding the Studio plugin), and Roblox Studio. Optionally install [GitHub CLI](https://cli.github.com/).

After extracting the project ZIP, open the directory in Visual Studio Code and run:

```powershell
node --version
npm --version
git --version
npm install
npm test
npm run dev
```

Use the desktop pairing code to link the plugin. The toolbar button opens a custom floating Cursor V2 window in Studio rather than a dock panel. For Studio plugin installation:

```powershell
PowerShell -ExecutionPolicy Bypass -File .\scripts\install-studio-plugin.ps1
```

The installation script rejects corrupt Roblox XML files before copying them. Restart Studio after installing. The plugin appears on Studio's **Plugins** toolbar as **Cursor Bridge V2**. Enable its first-time network access request to `127.0.0.1:38471` if prompted. The desktop process must be running before pairing.

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

## 3. Push to GitHub using GitHub CLI

```powershell
gh auth login
git init -b main
git add .
git commit -m "Release Cursor Bridge v0.2.4"
gh repo create CursorBridge --public --source . --remote origin --push
```

**Alternative: without GitHub CLI.** Create an empty *public* repository named `CursorBridge` in GitHub's website first. Then:

```powershell
git init -b main
git add .
git commit -m "Release Cursor Bridge v0.2.4"
git remote add origin https://github.com/nikis-gif/CursorBridge.git
git push -u origin main
```

In both cases, make sure `package-lock.json` was generated and included by `npm install`.

## 4. Enable GitHub Actions and publish your first installer

Open your GitHub repository -> **Settings** -> **Actions** -> **General**. Ensure workflows are enabled and **Workflow permissions** permit reading and writing the repository contents (the workflow itself also requests `contents: write`).

From PowerShell:

```powershell
git tag v0.2.4
git push origin v0.2.4
```

Open the repository's **Actions** tab, select **Build and publish Windows release**, and wait for the `windows-release` job. Its artifacts are published on **Releases** as an `.exe` installer, `latest.yml` and `CursorBridgeV2.rbxmx`. The first build can take several minutes.

> If publishing fails, verify that `package.json` has the correct GitHub owner/repo, the repository is public, and the workflow has write permission. Keep your `package-lock.json` in Git for repeatable installation.

## 5. Publish subsequent updates

Change code, build and test the plugin/app, and increment the semver version (example: `0.2.5`):

```powershell
npm version patch --no-git-tag-version
# Also update Version in plugin/source/Config/Defaults.lua.
python .\scripts\build_plugin.py
npm test
git add .
git commit -m "Release 0.2.5"
git push origin main
git tag v0.2.5
git push origin v0.2.5
```

Every tagged release rebuilds the Windows installer and plugin. Installed Cursor Bridge Windows clients detect new public GitHub Releases, ask before downloading, then offer to restart and install. These updates are unavailable in `npm run dev` mode. **A plugin `.rbxmx` file is a separate install**; rebuild and reinstall the Studio plugin as needed.

## 6. Build an unsigned installer locally

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
