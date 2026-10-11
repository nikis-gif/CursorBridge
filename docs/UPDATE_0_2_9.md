# Publish and install v0.2.9

Extract the complete update ZIP and open a terminal in the folder containing `package.json`. The source publisher needs Node.js 22+ and GitHub CLI (`gh`) authenticated to an account with write permission for `nikis-gif/CursorBridge`.

```powershell
node .\scripts\publish-update.cjs
```

No `npm install` is needed just to upload this verified update. The publisher verifies every local file against `update-manifest.json`, checks the remote versions, uploads the changed source and rebuilt Studio plugin in one commit, and requests the existing Windows release workflow. It refuses unexpected remote edits and never force-pushes. It does not read your Studio game scripts, app backups, or GitHub authentication token.

Open GitHub Actions and wait for the new release workflow to pass. A source-upload success is not proof that the installer built successfully. Once the v0.2.9 release exists, use **Check for updates** in the installed desktop app or download its installer from Releases.

Close Roblox Studio, disable/remove the older Cursor Bridge plugin copy (including a Creator Store-installed copy if applicable), and install the v0.2.9 RBXMX. Keep only one active Cursor Bridge plugin. Open Studio and pair with the updated desktop application. Do not remove app-data or recovery folders.

The normal release workflow was not changed by this stability update. If it cannot be dispatched automatically, open **Actions > Build and publish Windows release > Run workflow > main**. Re-running the source publisher when all files match is a no-op.

For local development use `npm install`, `npm test`, then `npm run dev`. For test scope and limits see `STABILITY.md`.
