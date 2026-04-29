# Git Diff Viewer Architecture

## Goal

Build a Codex plugin proof of concept that launches a local Next.js UI when the user invokes Git Diff Viewer from a Codex thread.

## Recommended Shape

```text
Codex thread
  |
  | user invokes Git Diff Viewer
  v
Plugin skill
  |
  | npm run dev:app
  v
Launcher prints GIT_DIFF_VIEWER_URL=http://127.0.0.1:<port>
  |
  v
Next.js app on 127.0.0.1:<port>
  |
  | Codex browser opens URL
  v
Visible Git Diff Viewer UI
```

## Packages

### Plugin Shell

Path: `plugins/git-diff-viewer`

Owns Codex plugin metadata:

- `.codex-plugin/plugin.json`
- `.app.json`
- `skills/`
- package-level scripts that start the Next.js app through the local launcher

### Viewer

Path: `plugins/git-diff-viewer/viewer`

Initial responsibility:

- Provide a minimal Next.js app.
- Prove Codex can start and open the local UI.

Future responsibility:

- Trigger the custom review workflow.
- Render review progress and results.
- Show annotations once the review engine is ready.

## MVP Boundary

The first implementation should prove only this:

- the plugin can be invoked from a Codex thread
- Codex can start the local Next.js app
- Codex can open the `GIT_DIFF_VIEWER_URL=` URL in the browser

The review engine is out of scope for this POC.

## Security Notes

- Bind local HTTP only to `127.0.0.1`.
- Keep the skill launch command narrow.
- MCP is not required for the proof of concept.
- Do not run review logic until the workflow owner provides the integration contract.
