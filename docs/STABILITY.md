# v0.2.9 - Quick Apply and session stability

## Upgrade

Install the v0.2.9 Windows application and replace the Studio plugin with the v0.2.9 RBXMX. Disable older duplicate local or Creator Store installations. Re-pair once. Protocol v2 features require both new components. Keep all existing app-data and recovery folders.

## Exact path resolution

Preview sends only the requested path segments and operation types to the paired Studio plugin. Studio looks up these paths and reads existing destination source. It does not create or edit Instances during preview. The desktop builds a plan against that resolved snapshot instead of incomplete Explorer sibling pages. An unresolved MODIFIED entry remains an error, not an automatic NEW script. Duplicate ancestors or MODIFIED targets are rejected. NEW scripts retain the established same-name creation behavior.

Before Apply, the desktop persists the original TXT and previous script versions. Studio revalidates paths and current editor source, including the write callback. A source that changes after preview causes a conflict instead of a blind overwrite. Roblox remains the source of truth and can reject source even when it fits the bridge's limits.

## Larger inputs and transport

TXT input: 16 MiB (16,777,216 UTF-8 bytes). Scripts per bundle: 128. Each source: 2 MiB (2,097,152 bytes). Existing destination sources: 16 MiB aggregate. Combined serialized JSON: 64 MiB. These are application limits, not a guarantee that Roblox will accept every source at these sizes. Oversized deliveries must be split; source is never truncated.

JSON is split into 64 KiB UTF-8-safe fragments inside bounded HTTP packets. Each fragment carries a transfer ID, sequence index, count, byte size and Adler-32 corruption check. The corruption check is not cryptographic authentication; bearer tokens continue to authenticate the local peer. Commands are decoded only after complete validation. Lost responses resend the same fragment, and failed disk operations can retry the final fragment without losing earlier parts. Source changes in a partially completed batch are checkpointed.

Pasted input is saved to `drafts/quick-apply-input.txt`. Confirmed bundles and historical versions remain in `backups`. Browser localStorage is no longer the storage mechanism for large pasted bundles. Input is cleared after successful application or explicit Clear, not on a failed preview or an uncertain result. A disk failure or sudden power loss can still prevent the newest draft from being written; keep independent copies of important TXT deliveries.

## Long healthy sessions

There is no idle-keyboard, idle-mouse or maximum healthy session duration. An authenticated exchange continues even when no scripts change. Idle polling is approximately 1.5 seconds; pending work uses approximately 0.55 seconds, plus request/processing time. Long script editor operations run outside the HTTP loop in a serialized task. Completed command IDs are discarded only after acknowledged results. Fallback source audits inspect up to four scripts every five seconds rather than reading many large sources on every poll.

Network failures and Roblox HTTP throttling use bounded exponential retries instead of disconnecting after a fixed count. Logs are rate-limited. Page arrays and previews expire, outgoing transfer buffers are removed after completion, and unchanged snapshots are not repeatedly rewritten. The code does not disable Roblox request limits or prevent Windows from sleeping.

## Real interruptions and recovery

After 15 seconds without a heartbeat, the workbench becomes read-only and shows Reconnecting. A valid heartbeat before the 120-second transport lease expires restores that session. A longer outage ends the epoch, preserves local drafts and marks unconfirmed operations unknown. An in-memory resume authorization is restricted to the same token, Studio process ID and Place for up to seven days. Recovery creates a fresh snapshot and does not replay uncertain writes or Quick Apply. A lost resume response can be retried until the newly issued token is acknowledged.

Explicit Disconnect, another Studio pairing, or app shutdown revokes resume permission. Restarting the desktop loses this in-memory authorization and requires pairing again. Plugin unload, Play Test and changing Place still release the connection intentionally. A resumed scan waits for any previous yielding command worker to finish before exposing writable data.

OS suspension marks the workbench read-only. On wake the app waits for a real Studio heartbeat, rather than treating the OS resume event as evidence of a live connection. Suspension pauses execution; this handles recovery, not uninterrupted processing during sleep.

## Validation scope

94 Node tests passed, including closed deep paths, ambiguity, missing MODIFIED, new-folder planning, stale-source rejection, empty source, cancellation, input sizes, Unicode chunking, damaged fragments, lost HTTP responses, batch checkpoints, and authenticated resume. A real localhost test transferred a source larger than the old HTTP cap. An accelerated clock delivered 230,400 idle heartbeats across a simulated 96 hours with no edits. Another test simulated 80 hours of OS suspension. These are deterministic simulations, not a live Roblox soak.

Chromium tests use the production renderer with a simulated preload/Studio. They cover 6 MiB TXT with browser storage full, stale previews, index progress, recovery UI, the 16 MiB boundary and previous editing/search/Explorer regressions. XML tests verify rebuilt plugin structure but do not run Roblox APIs or Luau engine callbacks.

The Windows installer, live Studio integration and continuous multi-day runtime still require real testing. Start with a copy of the Place, retain Studio saves and off-device backups, and inspect unknown operations before retrying a bundle.

## API references

- Roblox ScriptEditorService: https://create.roblox.com/docs/reference/engine/classes/ScriptEditorService
- Roblox HttpService: https://create.roblox.com/docs/reference/engine/classes/HttpService
- Electron powerMonitor: https://www.electronjs.org/docs/latest/api/power-monitor
