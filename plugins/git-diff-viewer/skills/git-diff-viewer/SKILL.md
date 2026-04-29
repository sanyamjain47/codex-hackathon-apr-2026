---
name: git-diff-viewer
description: Use when the user tags or invokes Git Diff Viewer and wants to open the local review UI. This proof of concept starts the Next.js app and opens it in the Codex browser.
---

# Git Diff Viewer

When the user invokes Git Diff Viewer, the immediate goal is to launch the local Next.js UI and open it in the Codex browser.

## POC Workflow

1. Start the app from the repo root:

```bash
npm run dev:app
```

2. Read the launcher output and capture the local URL from the line prefixed with:

```text
GIT_DIFF_VIEWER_URL=
```

3. Wait for the dev server to report that it is ready.

4. Open the captured local URL in the Codex browser. The preferred URL is:

```text
http://127.0.0.1:3000
```

5. Tell the user the UI is running and provide the local URL.

## Notes

- Do not run a code review yet.
- Do not call a review engine yet.
- Do not require MCP tools for this proof of concept.
- The launcher uses port `3000` when available and otherwise chooses the next available local port.
