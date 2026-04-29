# Git Diff Viewer Plugin

This directory is the Codex plugin package.

The current proof of concept is narrow: when Git Diff Viewer is invoked from a Codex thread, Codex should start the local Next.js app and open it in the Codex browser.

## Contents

- `.codex-plugin/plugin.json`: plugin metadata shown to Codex.
- `viewer`: Next.js UI app.
- `.app.json`: app integration placeholder.
- `skills`: Codex skill instructions.
- `assets`: future icons, logos, and screenshots.
- `scripts`: helper scripts for packaging and local development.

## Development

From the repo root:

```bash
npm install
npm run dev
```

The launch script prefers `http://127.0.0.1:3020` and prints the final URL with
the `GIT_DIFF_VIEWER_URL=` prefix. If Git Diff Viewer is already running there,
the launcher prints that URL and exits successfully. If the port is occupied by
something else, it uses the next available local port.

Or run the plugin workspace directly:

```bash
npm run launch --workspace git-diff-viewer
```

MCP is intentionally out of scope for this proof of concept.
