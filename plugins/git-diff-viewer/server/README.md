# Server

This package will become the Codex-facing MCP server.

## Current State

The server exposes a single `ping` tool so teammates can verify that the MCP process starts. It does not contain Git or diff business logic yet.

## Development

```bash
npm run dev --workspace @git-diff-viewer/server
```

## Future Work

- Add narrow Git tools.
- Resolve the active repo root.
- Create review sessions.
- Coordinate a local viewer server.
- Keep all filesystem access inside the resolved repo root.
