# v0.1.0-alpha.1 — Experimental local Slides Agent

First public source preview: a local MCP server, authenticated loopback bridge, Chrome MV3 extension, Codex workflow skill, bilingual installation instructions and release ZIPs.

Implemented: screenshot/accessibility observation, CSS-coordinate input, click/double/right click, drag, wheel, Unicode text, shortcuts, single-client session ownership, stale-snapshot rejection, cancellation/emergency stop, root/iframe image-file chooser handling, and presentation-attributed download verification.

Validation on Windows / Node 24.12.0 / Chromium 153.0.8010.12:

- 20 unit/integration tests passed.
- 14 actual-extension/MCP browser checks passed at each emulated scale 1, 1.25 and 1.5.
- Build, skill validation and dependency audit passed.

These are isolated fixture tests. Google's production Slides editor, native animations/transitions, production image uploads/exports, Codex desktop installation and independent second-computer manual acceptance remain unverified. Follow docs/ACCEPTANCE.md before treating those capabilities as verified.

Install the extension ZIP by extracting it and loading its folder as an unpacked Chrome extension. The full-project ZIP includes prebuilt code plus source; install Node dependencies using npm ci. See the README for local bridge pairing and MCP registration. No private configuration or browser profiles are included.
