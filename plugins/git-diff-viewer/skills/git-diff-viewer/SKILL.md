---
name: git-diff-viewer
description: Use when the user tags or invokes Git Diff Viewer and wants to open the local review UI. This proof of concept reuses or starts the Next.js app and opens it in the Codex browser.
---

# Git Diff Viewer

When the user invokes Git Diff Viewer, the immediate goal is to open the local Next.js UI in the Codex browser. Prefer reusing an already-running viewer before starting a new process.

## POC Workflow

1. From the repo root, run the launcher:

```bash
npm run dev:app
```

The launcher is idempotent. If Git Diff Viewer is already running on the preferred local port, it prints the existing URL and exits successfully. Otherwise, it starts the Next.js dev server.

2. Read the launcher output and capture the local URL from the line prefixed with:

```text
GIT_DIFF_VIEWER_URL=
```

3. If the launcher started a server process, wait for the dev server to report that it is ready. If the launcher exited after reporting an already-running viewer, open the URL immediately.

4. Open the captured local URL in the Codex browser. The preferred URL is:

```text
http://127.0.0.1:3020
```

5. Tell the user the UI is running and provide the local URL.

## Notes

- Do not run a code review yet.
- Do not call a review engine yet.
- Do not require MCP tools for this proof of concept.
- The launcher uses port `3020` when available and otherwise chooses the next available local port.
