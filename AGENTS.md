# Development notes

This is an experimental Windows/Chrome local MCP tool. Keep TypeScript source in src/ and extension/. Build produces dist/ and packages produce release/; generated output, configuration, profiles and test artifacts are ignored.

- Use Node 24. npm run check, npm test, npm run build and npm run test:browser are the verification commands. Browser tests require npx playwright install chromium.
- Keep stdout exclusive to MCP messages in mcp mode. Log diagnostics to stderr.
- Validate actions at both bridge and extension boundaries. Preserve one-client ownership, fresh-snapshot requirements, cancellation and no-replay behavior.
- Real browser fixture tests cover the actual extension and MCP, but do not prove Google Slides production behavior. Keep docs/VALIDATION.md honest; production acceptance uses docs/ACCEPTANCE.md.
- Keep pairing secrets, Google cookies, private deck URLs and screenshots outside version control/release packages. The archive script includes an explicit source allowlist.
