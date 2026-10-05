# Slides Agent

An experimental, open-source local MCP tool that lets **Codex operate Google Slides through your signed-in Chrome browser**. It provides screenshots, accessibility information, mouse/keyboard actions, image uploads, and export tracking. Codex decides what to do and verifies the resulting UI.

[繁體中文](README.zh-TW.md) · [Validation status](docs/VALIDATION.md) · [Tools](docs/TOOLS.md) · [Manual acceptance test](docs/ACCEPTANCE.md)

**Status: experimental.** Browser integration is tested against isolated fixtures. Native animations, transitions, saving, and rendering in Google's production editor require the manual acceptance test. It does not promise every Slides feature or unattended success.

## Requirements

- Windows, Node.js **24+**, Chrome **125+**, and Codex desktop with local MCP support.
- A Google account signed in to Chrome, with edit access to the presentation.
- Developer-mode installation of an unpacked Chrome extension. Chrome displays a debugger notice during control; corporate policy can prevent debugger attachment.
- Fully automatic exports require Chrome's **Ask where to save each file before downloading** setting to be off. Otherwise complete the native Save dialog yourself.

## Install from source

```powershell
git clone https://github.com/MatthewMung/slides-agent.git
cd slides-agent
npm ci
npm run build
npm run setup
```

You may also download and extract the source ZIP, then run the same commands from its folder. The release ZIP includes a prebuilt extension and CLI; `npm ci` is still required for the CLI's dependencies.

1. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this project's `dist/extension` folder. If using the extension-only ZIP, extract it and select the folder containing `manifest.json`.
2. In a terminal, start the bridge and leave it running:

   ```powershell
   npm run bridge
   ```

3. In a second terminal, display the local pairing token:

   ```powershell
   npm run setup -- --show-token
   ```

4. Open the Slides Agent extension popup, enter the bridge port and token, and choose **Connect**. It should show **Connected**.
5. `npm run setup` prints an MCP configuration with the correct absolute CLI path. Add that block to your Codex MCP configuration, or register the equivalent command in Codex settings:

   ```toml
   [mcp_servers.slides-agent]
   command = "node"
   args = ["C:/absolute/path/slides-agent/dist/src/cli.js", "mcp"]
   ```

   On Windows use forward slashes or escaped backslashes in TOML. Restart the MCP connection/start a fresh chat after registering it. Do not use `npm run mcp` as the MCP command: npm's banner can corrupt stdio.

6. Optionally copy `skills/slides-agent` into your personal Codex skills directory, preserving `SKILL.md`. This adds the observe/act/verify workflow; the MCP tools work without the skill.
7. Open a test presentation in Chrome and run:

   ```powershell
   npm run doctor
   ```

The bridge, extension, and MCP connection must all be present. Your Google login remains in Chrome. The project requires no separate OpenAI API key, Google OAuth application, hosted server, or Slides API connection. Codex usage follows your Codex account.

## Example prompt

> Use Slides Agent on my open test presentation. On slide 3, add a fade-in animation to the bullet list, triggered on click, one paragraph at a time. Check the animation panel and play a preview. Report what you verified, and release the session when finished.

The tool returns `action_sent_verify_result`, not “animation applied.” Codex must inspect the resulting panel/preview. Re-observe after manual input, navigation, a tab switch, resize, or any uncertain result. A consumed/expired snapshot cannot be reused.

## Stop, reconnect, and revoke pairing

- **Stop control** in the popup cancels control and detaches the debugger. The bridge remains available for a new session.
- **Disconnect** also disables automatic bridge reconnection. Reconnect using the popup when ready.
- Closing the controlling MCP client or losing the extension connection stops its session. Requests are never replayed automatically.
- To revoke the current token: stop the bridge, run `npm run setup -- --rotate`, restart the bridge and MCP client, display the new token locally, and pair the extension again. Old tokens will fail. Changing ports uses `npm run setup -- --rotate --port 32146`.

Configuration is stored in `%APPDATA%/slides-agent/config.json` (or the platform's user configuration directory). `SLIDES_AGENT_CONFIG` selects a custom file for testing. Keep it outside the repository. Pairing tokens are stored locally in this file and Chrome extension storage; keep them private. No cookies/passwords are read by the tool.

## Architecture

```text
Codex ↔ MCP stdio process ↔ loopback WebSocket bridge ↔ Chrome extension ↔ selected Slides tab
```

The bridge accepts authenticated local clients only. One session is owned by one MCP connection. Public tools expose constrained UI actions, rather than arbitrary JavaScript/CDP commands. The extension only attaches to Google Slides presentation URLs; leaving the selected document stops control. Screenshots/visible UI text are returned to your MCP host and therefore may be processed by its model provider.

The Chrome debugger and downloads permissions are browser-wide permissions: our code restricts their use to the selected Slides workflow, but the manifest alone cannot enforce that restriction. File uploads send your chosen images to Google. Login, account settings, permissions changes, and native operating-system dialogs remain user tasks.

## Develop and verify

```powershell
npm run check
npm test
npm run build
npx playwright install chromium
npm run test:browser
npm run package
```

The browser smoke test loads the **actual extension**, starts the **actual bridge**, and spawns the **actual MCP stdio process** in an isolated Chromium profile. It routes test URLs to local fixtures and never edits a real Google presentation. Output is saved under `artifacts/`, which is excluded from Git and release archives. Set `SLIDES_AGENT_SCALE` to `1.25` or `1.5` to exercise emulated device scale; this does not substitute for testing Windows display scaling on the production editor.

`npm run package` creates extension-only and complete-project ZIPs under `release/`. Release creation is separate from the manual real-Slides acceptance gate. See [acceptance procedure](docs/ACCEPTANCE.md).

## Troubleshooting

| Symptom | Action |
|---|---|
| `BRIDGE_OFFLINE` | Start `npm run bridge`; verify the configured port. |
| PowerShell blocks npm/npx scripts | Use `npm.cmd` / `npx.cmd` for the same command; no execution-policy change is needed. |
| Extension disconnected | Recheck token/port, connect from the popup; a second Chrome profile cannot replace an active extension connection. |
| `SESSION_IN_USE` | End the existing session or use the popup stop button. |
| `STALE_SNAPSHOT` / `VIEW_CHANGED` | Run `observe` again; use the new screenshot and snapshot ID. |
| `ACTION_RESULT_UNKNOWN` | Inspect first; do not repeat the edit automatically. |
| Debugger cannot attach | Close competing DevTools/control sessions; check enterprise restrictions. |
| `NO_FILE_CHOOSER` | Click Upload from computer, then observe and use the returned chooser ID. |
| Export has no verified download | Check progress, download warnings or a native Save dialog. |
| Slideshow opens another tab | End the old session, list tabs, start the presentation/slideshow tab explicitly. |

## Distribution and references

GitHub source sharing does not automatically list the tool in the ChatGPT plugin directory or Chrome Web Store. This version installs as a local MCP server and unpacked extension. Edge/macOS/ChatGPT web remain unverified.

Implementation follows the [MCP SDK v2 stdio example](https://ts.sdk.modelcontextprotocol.io/v2/get-started/first-server), [Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=desktop), [Chrome Debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger), [service-worker WebSockets](https://developer.chrome.com/docs/extensions/how-to/web-platform/websockets), and [Downloads API](https://developer.chrome.com/docs/extensions/reference/api/downloads).

MIT licensed. Contributions should include a reproducible case and distinguish fixture coverage from real Google Slides verification.
