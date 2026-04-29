# Codex Hackathon April 2026

This repo currently contains the scaffold for a Codex plugin called `git-diff-viewer`.

The immediate proof of concept is to let Codex launch a local Next.js UI when the Git Diff Viewer plugin is invoked.

- `plugins/git-diff-viewer/viewer`: local Next.js UI package.
- `plugins/git-diff-viewer/skills`: Codex skill instructions for using the plugin.
- `docs`: shared architecture and planning notes.

## Quick Start

```bash
npm install
npm run dev
```

The dev script starts the plugin viewer through the same launcher the Codex
skill uses. It prints the final local URL with the `GIT_DIFF_VIEWER_URL=`
prefix.

Individual packages can also be run directly:

```bash
npm run dev:app
```

## Current Scope

This is a scaffold only. The Next.js app is a placeholder UI so teammates can prove the Codex-to-browser launch path before wiring in review logic.
