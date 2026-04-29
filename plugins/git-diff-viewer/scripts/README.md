# Scripts

This directory contains helper scripts for the Git Diff Viewer plugin.

## `launch-viewer.mjs`

Starts the local Next.js viewer on `127.0.0.1`.

It prefers port `3000`, falls back to the next available local port, and prints
the final URL using this prefix:

```text
GIT_DIFF_VIEWER_URL=
```

The Codex skill uses that URL when opening the viewer.
