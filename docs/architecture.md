# Git Diff Viewer Architecture

## Goal

Build a Codex plugin that lets Codex review Git diffs and, later, show those diffs in a local web viewer with inline annotations.

## Recommended Shape

```text
Codex
  |
  | STDIO MCP
  v
MCP server package
  |
  | future localhost HTTP API
  v
Viewer package
```

## Packages

### Plugin Shell

Path: `plugins/git-diff-viewer`

Owns Codex plugin metadata:

- `.codex-plugin/plugin.json`
- `.mcp.json`
- `.app.json`
- `skills/`
- package-level scripts that coordinate `server` and `viewer`

### MCP Server

Path: `plugins/git-diff-viewer/server`

Initial responsibility:

- Start a STDIO MCP server.
- Expose placeholder tools while the team agrees on schemas.

Future responsibility:

- Resolve repo root from the active workspace.
- Run Git commands with `cwd` set to the resolved repo root.
- Create review sessions.
- Store normalized diff data.
- Start or coordinate a localhost HTTP server for the viewer.

### Viewer

Path: `plugins/git-diff-viewer/viewer`

Initial responsibility:

- Provide a Vite app placeholder.
- Establish UI conventions and contribution space.

Future responsibility:

- Render changed files and hunks.
- Support unified and split views.
- Show Codex annotations inline.
- Poll, fetch, or subscribe to session updates from the server.

## MVP Boundary

The first implementation should be "Pure MCP + Codex reasoning":

- Codex does the review reasoning.
- MCP tools provide repo and diff data.
- The server owns session state.
- The viewer consumes session state through local HTTP later.

Avoid adding an internal Codex SDK agent until the MCP and viewer workflow is stable.

## Future Tool Ideas

- `get_repo_info`
- `get_working_tree_diff`
- `get_branch_diff`
- `create_review_session`
- `list_changed_files`
- `get_file_diff`
- `add_review_annotations`
- `open_diff_viewer`

## Security Notes

- Bind local HTTP only to `127.0.0.1`.
- Use Git argv arrays, not shell strings.
- Do not expose arbitrary shell execution.
- Keep file reads inside the resolved repo root.
- Treat diff content as untrusted data.
