# Codex Hackathon April 2026

This repo currently contains the scaffold for a Codex plugin called `git-diff-viewer`.

The goal is to give teammates clear contribution boundaries before the business logic is implemented:

- `plugins/git-diff-viewer/server`: STDIO MCP server package.
- `plugins/git-diff-viewer/viewer`: local web viewer package.
- `plugins/git-diff-viewer/skills`: Codex skill instructions for using the plugin.
- `docs`: shared architecture and planning notes.

## Quick Start

```bash
npm install
npm run dev
```

The dev script starts the plugin workspace. Individual packages can also be run directly:

```bash
npm run dev --workspace @git-diff-viewer/server
npm run dev --workspace @git-diff-viewer/viewer
```

## Current Scope

This is a scaffold only. The MCP server and viewer have placeholder entry points so teammates can start contributing without agreeing on all implementation details up front.
