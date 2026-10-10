# Quick Apply — AI script delivery

Open Quick Apply with **Ctrl+L** (or the Quick Apply button in the header). Paste the AI-generated script bundle or choose **Open .txt**. The live Studio hierarchy resolves every path before any edit. Review the results and choose **Apply to Studio**.

## TXT format

Every script must follow the exact header structure below. The line of equal signs contains exactly 50 `=` characters. Include only scripts created or changed during the current task. The source must be complete and begin with `--!strict`.

```text
==================================================
SCRIPT: CombatService
PATH: game/ServerScriptService/Systems/CombatService
STATUS: MODIFIED
==================================================

--!strict

print("Updated")

==================================================
SCRIPT: CombatConfig
PATH: game/ReplicatedStorage/Config/CombatConfig
STATUS: NEW
CLASS: ModuleScript
==================================================

--!strict

return { Enabled = true }
```

- `SCRIPT`: exact, case-sensitive instance name, matching the last `PATH` component.
- `PATH`: `/`-separated Studio hierarchy; start at a built-in service, optionally prefixed with `game/`.
- `STATUS: MODIFIED`: replace exactly one existing Script, LocalScript or ModuleScript. Missing or ambiguous paths are rejected.
- `STATUS: NEW`: create a fresh script; missing intermediate **Folder** instances are created. Existing scripts with the same name are not overwritten.
- `CLASS`: optional for NEW. Accepted values: `Script`, `LocalScript`, `ModuleScript`. Without CLASS, the default is `Script`, adjustable in the preview. Existing scripts retain their actual class.

## Safety

Quick Apply does **not** execute pasted text in the desktop application. The bridge stores the TXT file and backups for every modified script **before** queueing a command. Roblox Studio checks the exact instance paths and source text a second time before changing anything. The Studio plugin uses a single ChangeHistoryService recording for undo. If the batch fails, it attempts to restore existing sources and remove created objects, then reports the result. A disconnected or uncertain batch is **never automatically retried**.

Limits: 20 scripts per bundle, 256 KiB per script, 512 KiB total. Code is not compiled or linted by Quick Apply: Studio remains responsible for script editing and diagnostics. Undo, network behavior, and Lua source writes still require real Studio validation.

## Recovery

The app saves imported bundles to `backups/quick-apply/<place-key>/` under its user-data directory and individual prior script versions under `backups/scripts/`. Use **Session > Open recovery folder**. Pasted text is also retained locally until a successful Studio confirmation or manual Clear.

## Workflow

1. Give your AI assistant `docs/QUICK_APPLY_PROMPT.txt` as its output contract.
2. Copy the AI's entire `.txt` payload and press Ctrl+L in Cursor Bridge.
3. Resolve any red paths, verify any new-script class selections, then click Apply to Studio.
4. Wait for the Studio confirmation. Inspect the scripts in Explorer and use Studio Undo or the recovery backups if necessary.
