# Scripts

This directory contains helper scripts for the BetterReview plugin.

## `launch-viewer.mjs`

Reuses or starts the local static viewer on `127.0.0.1`.

It prefers port `3020`. If BetterReview is already running there, it prints
that URL and exits successfully. Otherwise, it falls back to the next available
local port and prints the final URL using this prefix:

```text
BETTER_REVIEW_URL=
```

The Codex skill uses that URL when opening the viewer.

## `start-review.mjs`

Resolves the current branch diff base, prepares `.better-review/current`, writes
the review request, and starts the App Server worker in the background.

Use dry-run mode to test branch resolution without writing a session:

```bash
npm run start-review -- --dry-run
```

## `validate-cards.mjs`

Validates card frontmatter and tree links:

```bash
npm run validate:cards
```

## `seed-fixture.mjs`

Copies the packaged `examples/review` fixture into `.better-review/current/cards` so the static UI
can be tested without spending model calls:

```bash
npm run seed:review-fixture
```
