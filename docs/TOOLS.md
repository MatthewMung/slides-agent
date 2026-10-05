# MCP interface

All coordinates are **CSS pixels relative to the page viewport**, not desktop coordinates. If reading a screenshot at native resolution, divide image coordinates by `cssToImageX` and `cssToImageY`. If your image viewer resizes it, account for that additional resizing first.

| Tool | Arguments | Result |
|---|---|---|
| `get_status` | `{}` | Bridge/extension connection and control status |
| `list_tabs` | `{}` | Eligible Slides tabs with numeric `tabId` |
| `start_session` | `{ "tabId": 123 }` | `sessionId`, observation, screenshot |
| `end_session` | `{ "sessionId": "uuid" }` | `{ "ended": true }` |
| `observe` | `{ "sessionId": "uuid" }` | New `snapshotId`, CSS viewport, image dimensions/scale, accessibility elements, warnings, optional `pendingUpload` |
| `act` | `{ "sessionId": "uuid", "snapshotId": "uuid", "action": { ... } }` | `action_sent_verify_result` and a new observation |
| `upload_file` | `{ "sessionId": "uuid", "chooserId": "uuid", "path": "C:/absolute/image.png" }` | `file_sent_verify_result` and new observation |
| `get_downloads` | `{ "sessionId": "uuid" }` | Attributable downloads with state, path and `verified` flag |

Screenshot bytes are returned as an MCP image content block. Structured output contains metadata and scale, not a duplicated base64 image. Accessibility text is incomplete on canvas: use it for menus/toolbars and the screenshot for slide objects. Root-frame bounds are viewport coordinates; cross-origin frame elements currently expose names/roles without bounds.

## Actions

```json
{"type":"click","x":320,"y":240}
{"type":"double_click","x":320,"y":240}
{"type":"right_click","x":320,"y":240}
{"type":"click","x":320,"y":240,"modifiers":["Control"]}
{"type":"drag","from":{"x":300,"y":200},"to":{"x":450,"y":350}}
{"type":"scroll","x":700,"y":500,"deltaX":0,"deltaY":500}
{"type":"type_text","text":"Hello 你好"}
{"type":"press_key","key":"a","modifiers":["Control"]}
```

Modifiers: `Control`, `Shift`, `Alt`, `Meta`. Named keys: `Enter`, `Tab`, `Escape`, `Backspace`, `Delete`, `ArrowLeft`, `ArrowUp`, `ArrowRight`, `ArrowDown`, `Home`, `End`, `PageUp`, `PageDown`, `Space`, `F5`, `F11`, `F12`; letters/digits are supported. Browser/OS-level shortcuts are not guaranteed. Use `type_text` for Unicode. File paths are sent only after an intercepted chooser exists and matches the current session.

## State and errors

Snapshots expire after 60 seconds and are consumed by actions. Active-tab changes, navigation, user input, viewport changes and disconnection invalidate them. After a cancelled or uncertain operation, inspect rather than retrying automatically. A visual change is not proof of persistence: reload the test presentation and inspect again when testing saving.

The broker reserves one global session, owned by the MCP connection that started it. Other clients can inspect connection status/list tabs, but cannot control that session. Emergency stop releases the reservation and detaches the debugger. Starting a new connection never restores an old session automatically.

Download attribution uses the presentation ID in the download URL/final URL/referrer and session start time. Unattributable files are excluded. `verified` checks existence, nonzero size and PDF/PPTX signature; it does not prove document content or archive integrity. The manual acceptance procedure also opens exported files.

Local transport: protocol version 1, authenticated loopback WebSockets, request IDs, bounded timeouts, no retries/replay. There is no public raw-CDP or JavaScript-evaluation tool.
