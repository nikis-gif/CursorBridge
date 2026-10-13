# AI projects — v0.4.0 candidate

An optional Electron panel for Place-specific coding conversations. AI projects are identified by the existing Roblox Studio `placeKey`, never by a script name or in-memory session ID. Opening a Place creates/opens its existing project. Previous Place histories remain accessible while disconnected.

## Features

- `Ctrl+Shift+A` opens the AI panel. The panel inherits the existing workbench's theme and monochrome outline icon family. The Studio bridge and Quick Apply flows are unchanged.
- Chats can be created, renamed and deleted. Chat messages, architecture notes, and saved Luau code snippets persist locally under Electron `userData/ai-projects/` (one atomic JSON file per Place).
- Source context is **opt-in**: select a script and enable **Script context** before sending. No complete Place content is sent by default. The model never writes to Roblox Studio automatically; copy code or save a snippet, then use the existing editor or Quick Apply confirmation/backup path.
- **Continue with ChatGPT** uses the official open-source Sign in with ChatGPT OAuth authorization-code + PKCE flow, with the system browser and a loopback callback. No private API key or client secret is required. Credentials are encrypted with Electron `safeStorage`, never exposed to the renderer or Roblox plugin. The model picker loads only server-advertised models. Request errors and entitlement limits are not bypassed.
- History/memory are **independent** of chatgpt.com projects, conversations, account Memory, and Voice sessions; signing in does not import them. Prompts/history/context for a request are sent to OpenAI only when explicitly submitted. `store:false` and `stream:true` are used for Responses requests.
- **Dictation and read-aloud:** browser/OS speech facilities are used only if available. Speech recognition may rely on the platform's online service; the native ChatGPT voice experience is not embedded. No microphone data are sent to OpenAI by the AI text request code.

## Distribution eligibility

The ChatGPT plan-sharing integration has open-source/local-hosting eligibility requirements. The present repository has `license: UNLICENSED` and is not automatically open-source merely because it is public. Resolve the license/eligibility before releasing this OAuth integration to end-users; do not change the project license silently. Commercial or otherwise ineligible distribution needs separate approval or a supported billing arrangement.

The supplied **Vanilla 3 for Roblox Studio** icon ZIP forbids repackaging assets into third-party software. Do not include it in the CursorBridge distributable. The AI panel adds only original SVG outline shapes consistent with existing icons.

## Security and stability

Electron remains sandboxed, `contextIsolation` remains enabled, direct renderer network credential access is prohibited, and Roblox's localhost transport on port 38471 is unchanged. The new OAuth callback is a separate ephemeral loopback listener with state/nonce/PKCE protection and OIDC signature validation. Project files are subject to size/count limits and atomic replacement. Only the main Electron process can access encrypted tokens.

`npm test`, `npm run build`, `npm run test:ui:workspace`, `npm run test:ui`, plugin integrity and load/stability suites must all pass before publishing. OAuth live account authorization, read-aloud/recognition and native Windows window geometry need manual Windows QA. Automated tests stub OpenAI calls; they do not prove availability of an OpenAI model for any individual account.

## Keyboard reference

- `Ctrl+Shift+A`: AI projects
- `Ctrl+Enter` in AI prompt: send
- `Ctrl+Z` / `Ctrl+Y`: Monaco undo and redo code edits (not Studio Explorer mutations)
- `Ctrl+F` / `Ctrl+H`: find and replace in the focused Monaco editor
- `Ctrl+G`: go to line
- `Ctrl+Shift+P`: Monaco command palette
- `Ctrl+/`: toggle line comment
- `Ctrl+\` and `Ctrl+Shift+\`: side-by-side / stacked Monaco split
- `Ctrl+W` while the secondary group is focused: close the secondary view without closing the primary tab

### Unpublished Roblox Places

Roblox Studio reports `game.GameId = 0` and `game.PlaceId = 0` for new unpublished Places. Their bridge key is therefore `0-0`. The AI workspace scopes these temporary projects by the normalized Place name instead, so differently named local Baseplates do not accidentally share chat history. This cannot distinguish two unpublished files with the same name or track a renamed unpublished file; publishing the Place gives it a stable Roblox identifier.\n