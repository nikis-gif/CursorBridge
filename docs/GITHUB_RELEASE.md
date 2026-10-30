# Publishing Cursor Bridge Windows releases

Repository: **https://github.com/nikis-gif/CursorBridge**. The next release prepared
by PR #6 is **v0.4.3**; **v0.4.2 is already published** and must not be reused.
See [the release notes](RELEASE_0_4_3.md) and [runtime requirements](SETUP.md#runtime-requirements-and-verification).

## Prepare and validate the PR

1. Start from the PR branch. Update `package.json` and both root versions in
   `package-lock.json` together (`npm version patch --no-git-tag-version`).
2. Match `Product.Version` in `plugin/source/Config/Defaults.lua`, regenerate
   `CursorBridgeV2.rbxmx`, and add bilingual `docs/RELEASE_X_Y_Z.md` notes. Do not
   change the settings schema version or protocol version for a product patch.
3. Keep `.npmrc`, `devEngines`, `.nvmrc` and the patched Electron pin intact.
   Install with `npm ci`; do not bypass engine enforcement or regenerate unrelated
   dependency resolutions.
4. Run the available local checks:

```powershell
npm ci --no-audit --no-fund
npm test
npm run build
python scripts/build_plugin.py
python -m unittest discover -s tests -p test_plugin_build.py -v
python -m pip install -r tests/browser/requirements.txt
python -m playwright install chromium
npm run test:ui
npm run test:ui:workspace
npm run test:ui:load
npm run test:ui:stability
```

5. Push the PR branch and require **Workspace validation** to pass for the final
   revision: Linux regressions and Windows packaging/runtime checks. Changes after
   validation require a new run; an older green run is not approval of newer code.
6. Download `windows-release-candidate-<commit>` from that run's **Artifacts**.
   It contains the candidate installer, blockmap, `latest.yml` and Studio plugin
   (the plugin is at the archive root; installer files are under `release/`).
   Artifacts expire after 14 days. Record the run URL and tested PR revision.
7. Complete the manual checks below and record actual results in the PR. Obtain
   maintainer review and satisfy any repository rules before marking ready and
   merging. Keep the PR in draft while required manual results are missing.

Automated browser tests use a simulated Studio/Electron bridge, including the
real-Monaco suite. XML validation proves serialization integrity, not live Studio
execution. Launching the packaged binary as Node verifies runtime versions, not
NSIS installation, UI behavior or Roblox Studio compatibility.

## Manual Windows and Roblox Studio validation

Use the candidate from the final green run and a disposable test place. Record
Windows and Studio versions, the tester, date, installer/run and outcome of each
check. These are pending until someone actually executes and records them.

- [ ] Clean Windows installation, launch, close/reopen, native window controls and
  displayed desktop version 0.4.3.
- [ ] Upgrade an installed 0.4.2 using the candidate installer. Confirm 0.4.3
  launches and existing settings, drafts, recovery history and backups survive.
- [ ] Install `CursorBridgeV2.rbxmx`, restart Studio, allow the local connection
  prompt if needed, pair to the desktop and verify the intended place is active.
- [ ] Edit/save in both directions, reopen scripts, use Monaco undo/redo and split
  editors, and verify real source and hierarchy synchronization in Studio.
- [ ] Quick Apply: preview and apply NEW/MODIFIED scripts and folders, check exact
  destinations/classes, conflict rejection, backups and Studio undo behavior.
- [ ] Disconnect/reconnect, restart the app and Studio, and verify recovery of
  unsent drafts without duplicate application or silent source replacement.

Before publication, installing the candidate over 0.4.2 tests the installer upgrade
path. The production updater cannot discover 0.4.3 until it is published; test
that download/restart path after release, separately from the pre-merge checks.

## Publication from main

Merging a change to **`package.json` on `main` automatically starts**
`.github/workflows/release.yml`. **Tag pushes do not start this workflow.**
A manual run is supported through **Actions > Build and publish Windows release >
Run workflow > main**, for example after an infrastructure failure. Non-main
manual runs skip release jobs. Do not dispatch a duplicate run while one is active.

The workflow:

1. Runs the reusable Linux and Windows regression workflow.
2. Validates a stable package version, matching lockfile, release notes and the
   exact `build.publish` destination (`nikis-gif/CursorBridge`, type `release`).
3. Uses Node.js 22.23.4, installs the lockfile, runs Node tests, builds the renderer
   and plugin, validates XML and builds the Windows NSIS installer.
4. Runs the packaged executable to verify **Electron 44.10.0 / Node.js 24.22.1**;
   verifies `latest.yml` version, installer path, SHA-512 and byte size.
5. Creates `v<package.version>` only after validation. An existing tag is accepted
   only if it points at the same commit; tags are never force-moved.
6. Publishes versioned notes and all four assets together, then verifies the
   release is public and each exact asset name is present.

For v0.4.3, verify these assets at
https://github.com/nikis-gif/CursorBridge/releases/tag/v0.4.3:

- `Cursor-Bridge-Setup-0.4.3.exe`
- `Cursor-Bridge-Setup-0.4.3.exe.blockmap`
- `latest.yml`
- `CursorBridgeV2.rbxmx`

The production updater uses the public release and metadata; its end-to-end
Windows download/restart/install still needs a post-publication smoke test. Plugin
updates remain manual. Merely merging source or changing host Node.js does not
update an already installed desktop runtime.

## Failures and retries

- **No workflow:** check that `package.json` changed on `main`, or dispatch on
  `main`. Creating a tag alone does not publish.
- **Tag already belongs to another commit:** prepare another unused version in
  a PR. Never delete or move a published tag to work around this guard.
- **Release already exists:** inspect its assets and the failed step before
  retrying. `gh release create` does not overwrite an existing release; a retry
  is not an automatic repair of a partial/public release.
- **Dependency installation:** use the required Node.js/npm and committed
  lockfile. Resolve the actual error rather than switching to `npm install`.
- **Publication permission:** the workflow requests `contents: write` for its
  `GITHUB_TOKEN`; repository/organization policy must allow that permission.
- **Missing assets or post-publish verification failure:** the release is not
  complete merely because a tag or source archive exists. Inspect the failed
  job and all four asset names before reporting success.

Do not recreate the repository, run the historical `scripts/publish-update.cjs`
0.2.9 source uploader, bypass branch/review rules, or remove previous releases.
