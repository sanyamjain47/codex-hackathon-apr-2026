# Next.js App

This package is the local UI proof of concept for Git Diff Viewer.

## Current State

The app is a minimal Next.js page. It is not wired to the review engine yet.

## Development

```bash
npm run dev --workspace @git-diff-viewer/app
```

The plugin launcher is the preferred POC entrypoint:

```bash
npm run dev:app
```

It binds to `127.0.0.1`, prefers port `3020`, reuses an already-running Git Diff
Viewer instance, and falls back to another local port when needed.

## Future Work

- Add a review trigger.
- Add review status and results screens.
- Connect to the review engine owned by the workflow package.
