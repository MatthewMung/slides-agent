# Real Google Slides acceptance／真實簡報驗收

This is the release gate for claims about Google Slides. Fixture tests cannot replace it. Use a disposable private test presentation. Do not test by editing a production deck.

Record date, project commit/version, Windows version, Chrome version, Node version, Codex version, Google UI language and Windows display scale. Repeat relevant tests for English and Traditional Chinese, and display scales 100%, 125%, 150%. Keep personal deck URLs/screenshots outside the repository.

## Core workflow

1. Install on a **second Windows computer** using the README, without copying the original machine's configuration or Chrome profile. Generate a new token and sign in to Google yourself.
2. Create/open a private deck with three slides, a title, a bullet list, a shape and a grouped pair of objects. Give Codex the test-deck scope explicitly.
3. Ask Codex to edit the title, adjust its formatting, drag/resize a shape, duplicate/reorder a slide, and undo one edit. Verify each result. Reload and verify persistence.
4. Ask Codex to add a **Fade in** object animation to the bullet list, **On click**, **By paragraph**. Verify all three settings in the animation panel, play the preview, and test actual slideshow behavior.
5. Exercise **After previous**, **With previous**, another animation type and speed adjustment. Verify settings after reopening the panel.
6. Apply a slide transition, change its speed, preview it, and verify it in slideshow mode. If slideshow opens another tab, explicitly select that tab through a new session.
7. Ask Codex to insert a generated test PNG from a specified absolute path via Upload from computer. Verify appearance, position and saving. Test JPEG/GIF separately.
8. Export PDF and PPTX through the File menu. Confirm `complete` AND `verified`, open both files, and check slide count/content. Record any animation loss on export rather than assuming compatibility.
9. End the session and confirm the debugger is detached. Use the popup Stop button during a separate drag to verify it prevents further actions.

## Failure and recovery

- Switch tabs or resize between observe and act: old snapshot must be rejected.
- Manually change selection/text between observe and act: re-observation must be required.
- Open a second Codex MCP client: it must not take ownership of the first client's session.
- Close the controlled tab, cancel Chrome's debugger notice, disconnect the extension, and stop/restart the bridge: no old action may replay.
- Attempt an edit on a view-only deck: report the visible restriction; a sent input is not a successful edit.
- Upload a missing/renamed non-image: reject before sending the path to Chrome. Cancel an upload and verify the old chooser cannot target a later one.
- Enable Chrome's Save-location prompt: report that manual action is required rather than claiming export completed.
- Cancel a download: `verified` must remain false. Verify unrelated downloads are excluded.
- Test a competing DevTools session and enterprise restrictions where applicable: failures should be actionable, without silently replacing other control sessions.

## Result template

| Test | Environment | Outcome | Evidence | Limitation |
|---|---|---|---|---|
| Native paragraph animation | language / scale / versions | pass / fail / not run | setting + playback observation | |
| Transition and preview | | | | |
| Text persistence | | | | |
| Image insertion | | | | |
| PDF/PPTX open correctly | | | | |
| Second-computer install | | | | |

Publish only sanitized evidence. A screen recording demonstrating the actual tool on a real test deck should be added after these checks pass; do not label a fixture recording as a Google Slides demonstration.
