# Scripts

This directory contains helper scripts for the Git Diff Viewer plugin.

## `launch-viewer.mjs`

Reuses or starts the local Next.js viewer on `127.0.0.1`.

It prefers port `3020`. If Git Diff Viewer is already running there, it prints
that URL and exits successfully. Otherwise, it falls back to the next available
local port and prints the final URL using this prefix:

```text
GIT_DIFF_VIEWER_URL=
```

The Codex skill uses that URL when opening the viewer.
