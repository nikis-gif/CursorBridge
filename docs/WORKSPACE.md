# Workspace v0.3.1

The default desktop window is up to 1080 x 700 logical pixels, capped at 90% of
the display work area. The initial Explorer width is 248 pixels. Saved layout
preferences remain in effect. Use Layout > Reset workspace layout to reset only
visual preferences, not scripts or recovery data.

New installations use Obsidian. In the Studio plugin, Obsidian is the first and
default preset; the previous v0.3.0 default migrates to Obsidian. Other explicit
plugin palettes are preserved. The additional neutral preset is called Cursor.
The entire app and plugin interface is in English; release notes include PT-BR
and English. Stable version tags keep the standard vMAJOR.MINOR.PATCH format.

# Workspace controls

The desktop workbench combines a compact activity rail, a text-first home screen
and separate editor groups. These are presentation changes: Roblox Studio is still
authoritative and scripts still use the existing revision, conflict and backup rules.

## Appearance and title bar

New installations use Obsidian. Existing desktop installations retain their saved
theme, with the previous v0.3.0 default renamed to Cursor. Select
**Appearance > Obsidian** for the default dark palette. Code colors, font, wrap
and minimap remain independent settings. Windows minimize, maximize, restore,
close and snap behavior use native caption controls, not simulated HTML buttons.
The title bar follows the selected workbench theme.

**Layout > Reduce animations** and the operating system reduced-motion preference
disable interface transitions. No external fonts, remote chat service or cloud
account is required. Quick Apply opens the existing bundle review; it does not
send a prompt to an AI provider.

## Explorer

Drag the grip in the Explorer toolbar onto the left or right drop target. The same
choices are available in the Layout menu. Drag the divider to resize the Explorer,
or focus it and use the left/right arrow keys. Home or a double-click resets its
width. Ctrl+B toggles the Explorer. Search shortcuts reveal it when necessary.

Theme and layout preferences survive restarts. Layout preferences contain only
visual settings, never script text. **Reset layout** does not delete scripts,
clear recovery drafts or alter the Studio hierarchy.

## Split editors

Open a script, then use the split button, Ctrl+Backslash, or the tab context menu
**Open to the side**. Ctrl+Shift+Backslash opens a stacked view. Drag a script tab
onto a side/bottom drop target to open it in the second group without duplicating
the script in Studio. Normal tab-to-tab dragging still reorders the primary tabs.

The second group holds one pinned document at a time. Selecting another primary
tab does not change that pinned document; drop another open tab onto a split target
to replace it. Both groups can show the same script with independent cursors and
scroll positions. They share one Monaco model, undo history and save pipeline.

Ctrl+W closes the focused secondary view without closing the primary tab. Ctrl+S
flushes the focused group's document through the same safe synchronization path.
Closing a view is not deleting a script. A conflict in the secondary view offers
**Review in main** so the existing explicit recovery controls resolve it.

Drag the split divider, use its arrow keys, or double-click/Home to return to an
even split. Disconnection and new Studio sessions detach the secondary model;
unsent drafts still follow the existing local recovery process.

## Validation

`npm ci`, `npm test`, `npm run build`, then `npm run test:ui` and
`npm run test:ui:workspace` exercise the renderer. Install the pinned Python
requirements in `tests/browser/requirements.txt` and Chromium with
`python -m playwright install chromium` first. Load and recovery suites remain
available as `test:ui:load` and `test:ui:stability`.

The workspace suite runs the actual built Monaco, with only asset URLs adapted
for an offline browser fixture and the Studio/Electron transport simulated.
Roblox plugin XML integrity tests do not replace an interactive Roblox Studio
runtime test. Native Windows caption interactions require Windows visual QA.

## Automated publishing

Changing `package.json` on main triggers the release workflow. The workflow first
runs the reusable regression suite, then builds the Windows installer and plugin,
verifies updater metadata and creates the matching version tag. A complete release
contains the installer, blockmap, `latest.yml` and `CursorBridgeV2.rbxmx`.
Tag pushes and manual dispatch remain supported. Increment the version for each
new release; an existing tag pointing at another commit is rejected rather than
rewritten. Previous releases are not deleted.
