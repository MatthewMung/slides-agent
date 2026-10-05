# Validation status／驗證狀態

Version: 0.1.0 experimental. The implementation separates “input sent” from “intended effect verified.”

| Capability | Status | Evidence / required next check |
|---|---|---|
| TypeScript build | Automated check | `npm run build` |
| Authentication, client isolation, disconnect/timeout stop | Automated tests | `tests/bridge.test.ts` |
| URL boundaries, CSS input validation, shortcut mapping | Automated tests | `tests/protocol.test.ts` |
| Image signatures, export file checks, credential rotation | Automated tests | `tests/files.test.ts` |
| Actual extension → bridge → MCP stdio | Integration test | `npm run test:browser`; routed local fixtures |
| Real Google Slides title editing and persistence | Not yet verified | Follow `ACCEPTANCE.md` on a private test deck |
| Native object animation / paragraph sequencing | Not yet verified | Check settings and actual playback |
| Native slide transitions | Not yet verified | Check settings and playback |
| Google image upload and production exports | Not yet verified | Check Slides picker and open PDF/PPTX |
| English / Traditional Chinese / Windows display-scale matrix | Not yet verified | Manual production-editor matrix |
| Independent second-computer installation | Not yet verified | Required before claiming the shareability milestone |

Browser fixture reports are generated under `artifacts/browser-smoke-*.json` and excluded from Git and ZIPs. They exercise real Chrome APIs on a local fixture, not Google's production editor.

## Recorded execution: 2026-10-05

- Host: Windows (`win32`), Node.js 24.12.0, MCP SDK 2.3.0.
- TypeScript check/build: passed.
- Unit/integration suites: **20 tests passed**, including broker authentication, cross-client isolation, MCP cancellation, timeout/disconnect handling, URL boundaries, file validation, and token rotation.
- Real Chromium extension → bridge → MCP stdio smoke test: **14 checks passed per run** at emulated device scales **1, 1.25 and 1.5**. Includes Unicode typing/shortcuts, double/right click and drag, stale-snapshot rejection, manual-input invalidation, cancelled-chooser rejection, root/cross-origin iframe uploads, resizing, attributed PDF download, emergency stop and navigation revocation.
- Emulated device scale is not a manual Windows display-scale acceptance test.
- Dependencies: `npm audit` reported **0 vulnerabilities** at this run.
- No Google production-editor or independent-computer manual acceptance result is claimed.
