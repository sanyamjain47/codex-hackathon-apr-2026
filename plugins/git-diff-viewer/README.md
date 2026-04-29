# Git Diff Viewer Plugin

This directory is the Codex plugin package.

## Contents

- `.codex-plugin/plugin.json`: plugin metadata shown to Codex.
- `.mcp.json`: MCP server configuration.
- `.app.json`: app integration placeholder.
- `server`: STDIO MCP server package.
- `viewer`: local web viewer package.
- `skills`: Codex skill instructions.
- `assets`: future icons, logos, and screenshots.
- `scripts`: helper scripts for packaging and local development.

## Development

From the repo root:

```bash
npm install
npm run dev --workspace git-diff-viewer
```

Or run each package directly:

```bash
npm run dev --workspace @git-diff-viewer/server
npm run dev --workspace @git-diff-viewer/viewer
```
