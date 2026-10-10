# Publishing Cursor Bridge Windows releases

The repository for this project is **https://github.com/nikis-gif/CursorBridge**. Release version: **v0.2.4**.

## First release from GitHub website (recommended)

The earlier failed run reserved the `v0.2.3` tag. Do not rerun that historical job. Run the workflow on the updated `main` branch to publish `v0.2.4`.

1. Open https://github.com/nikis-gif/CursorBridge/actions.
2. Select **Build and publish Windows release**.
3. Click **Run workflow**, keep branch **main**, and confirm.
4. Wait for the Windows job to finish (it installs dependencies, runs tests and builds the Windows installer).
5. Download the Windows NSIS `.exe` at https://github.com/nikis-gif/CursorBridge/releases/latest.

The manual release workflow creates the matching `v0.2.4` Git tag only after tests and builds succeed, if it is missing. It uploads the Roblox Studio `.rbxmx` and `latest.yml` alongside the installer. Do not upload the source ZIP in place of an installer.

If Actions reports insufficient permissions, open **Settings > Actions > General > Workflow permissions** and enable **Read and write permissions** for `GITHUB_TOKEN`. The workflow requests `contents: write` itself.

The first publish compiles on GitHub's Windows runner. An unsigned installer may cause Windows SmartScreen warnings. Always download from your own GitHub Releases page.

## Subsequent releases

Update the project source and increase the `package.json` version; push the changes to `main`. Use **Run workflow** again to create the corresponding version tag and publish the next installer. You may also push the matching `vX.Y.Z` tag with Git to trigger the same workflow. Do not re-use a version number for a different commit.

---

## Local Git workflow (alternative)

# Publish Cursor Bridge v0.2.4 to GitHub

This guide publishes the **Windows NSIS installer** to a public GitHub Release. Uploading the source ZIP alone does **not** build a Windows installer. GitHub Actions builds the installer on a Windows runner when a version tag is pushed.

## 1. Windows prerequisites

Install Node.js 22+, Git, and GitHub CLI. Open the `CursorBridge` folder (the folder containing `package.json`) in Visual Studio Code and run the following commands in PowerShell:

```powershell
node --version
npm --version
git --version
gh --version
npm install
npm test
npm run build
```

After `npm install`, ensure that `package-lock.json` exists. Commit it for reproducible GitHub Actions builds. Do **not** commit `node_modules`, `release`, or `dist-renderer`.

## 2. Point the updater to your repository

Edit `package.json` and replace `REPLACE_WITH_nikis-gif` in `build.publish[0].owner` with your exact GitHub username or organization name. Keep these fields:

```json
{
  "provider": "github",
  "owner": "nikis-gif",
  "repo": "CursorBridge",
  "releaseType": "release"
}
```

The `repo` must match the GitHub repository you are about to create. `releaseType: release` makes the installer immediately downloadable (not a hidden draft). The repository should be **public** so the installed app can check for updates without a GitHub token on users' computers.

## 3. Authenticate and create the repository

```powershell
gh auth login
git init -b main
git add .
git commit -m "Release Cursor Bridge v0.2.4"
gh repo create CursorBridge --public --source . --remote origin --push
```

If the repository already exists, do **not** run `gh repo create` again. Instead, configure the existing remote and push:

```powershell
git remote add origin https://github.com/nikis-gif/CursorBridge.git
git push -u origin main
```

If `origin` already exists, run `git remote -v` to inspect it rather than adding a duplicate. If Git asks for your identity during commit, set `git config --global user.name` and `git config --global user.email` to your own details.

## 4. Enable GitHub Actions publishing

In your repository, open **Settings > Actions > General**. Allow GitHub Actions to run and, in **Workflow permissions**, choose **Read and write permissions** if your account or organization permits it. The workflow itself requests `contents: write` for GitHub Releases. No personal GitHub access token needs to be added to repository secrets: the workflow uses its built-in `GITHUB_TOKEN`.

Push the matching release tag:

```powershell
git tag v0.2.4
git push origin v0.2.4
```

The workflow at `.github/workflows/release.yml` will:

1. Validate the tag, app version, and repository owner.
2. Install Node.js dependencies and run app tests.
3. Build the Vite renderer and the Roblox Studio plugin.
4. Validate the `.rbxmx` XML.
5. Build and publish the Windows NSIS `.exe`, update metadata (`latest.yml`), and plugin file in **Releases**.
6. Verify that the release is published, not a draft.

Watch the **Actions** tab until the `windows-release` job succeeds. Then open **Releases > Cursor Bridge v0.2.4** (title may be the tag) and download the `.exe` installer under **Assets**. Run the installer, not the source-code ZIP.

Release URLs after publishing:

- `https://github.com/nikis-gif/CursorBridge/releases`
- `https://github.com/nikis-gif/CursorBridge/releases/latest`

## 5. Use the installed app and Studio plugin

Install the Windows `.exe`. If Roblox Studio does not already have the compatible plugin, download `CursorBridgeV2.rbxmx` from the same GitHub Release, close Studio, and copy it to `%LOCALAPPDATA%\Roblox\Plugins`. Restart Studio and pair it with the running Windows app.

Use `npm run dev` only while working on the source code. The installed `.exe` is the version that checks GitHub Releases for updates.

Unsigned Windows builds may trigger SmartScreen or antivirus warnings. For wider distribution, obtain a trusted Windows code-signing certificate and configure `electron-builder` to sign the installer. Do not bypass security warnings unless you trust the source and have verified the release.

## 6. Publish subsequent updates

Make your code changes, then run:

```powershell
npm version patch --no-git-tag-version
npm test
npm run build
git add .
git commit -m "Update Cursor Bridge"
git push origin main
```

Read the new version from `package.json`, then create and push the **matching** `vX.Y.Z` tag. For example, after updating 0.2.4 to 0.2.5:

```powershell
git tag v0.2.5
git push origin v0.2.5
```

If the Studio plugin changes, update the corresponding plugin version/configuration and regenerate the `.rbxmx` before tagging. Users of the installed Windows app can then check for updates; developer builds do not auto-update.

## Troubleshooting

- **Workflow not triggered:** tags must start with `v`, and the tag must be pushed to GitHub. Check the **Actions** tab.
- **Tag/version mismatch:** a `v0.2.4` tag requires `"version": "0.2.4"` in `package.json`.
- **Owner mismatch:** `build.publish[0].owner` and `.repo` must exactly identify the repository where the workflow is running.
- **Permission denied when publishing:** check repository **Settings > Actions > General > Workflow permissions** and any organization-level restrictions.
- **Only source archives are visible:** confirm the Windows workflow succeeded and that your Release is published with the `.exe` and `latest.yml` assets.
- **Release stuck as draft:** the project must include `"releaseType": "release"` in `build.publish[0]`.
- **Windows antivirus warnings:** unsigned builds can be flagged. Sign the installer for public distribution.
- **Build fails during dependency installation:** run `npm install` on your computer, commit `package-lock.json`, and retry the failed workflow.
