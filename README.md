# Codex Hackathon April 2026

This repo currently contains the scaffold for a Codex plugin called `better-review`.

The immediate proof of concept is to let Codex launch a local static UI when the BetterReview plugin is invoked.

- `plugins/better-review/viewer`: local static UI.
- `plugins/better-review/skills`: Codex skill instructions for using the plugin.
- `docs`: shared architecture and planning notes.

## Quick Start

```bash
npm install
npm run dev
```

The dev script reuses or starts the plugin viewer through the same launcher the
Codex skill uses. It prints the final local URL with the `BETTER_REVIEW_URL=`
prefix.

Individual packages can also be run directly:

```bash
npm run dev:app
```

## Current Scope

This is a scaffold only. The static viewer is a placeholder UI so teammates can prove the Codex-to-browser launch path before wiring in full review rendering.
