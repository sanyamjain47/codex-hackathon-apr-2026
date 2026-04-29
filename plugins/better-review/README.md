# BetterReview Plugin

This directory is the Codex plugin package.

When BetterReview is invoked from a Codex thread, Codex should start the local static viewer, open it in the Codex browser, and start a fire-and-forget review generation run.

## Contents

- `.codex-plugin/plugin.json`: plugin metadata shown to Codex.
- `viewer`: static UI.
- `docs`: packaged review-generation prompt context.
- `examples/review`: packaged fixture cards for local validation and seeding.
- `.app.json`: app integration placeholder.
- `skills`: Codex skill instructions.
- `assets`: future icons, logos, and screenshots.
- `scripts`: helper scripts for packaging and local development.

## Development

From the repo root:

```bash
npm install
npm run dev
```

The launch script prefers `http://127.0.0.1:3020` and prints the final URL with
the `BETTER_REVIEW_URL=` prefix. If BetterReview is already running there,
the launcher prints that URL and exits successfully. If the port is occupied by
something else, it uses the next available local port.

Or run the plugin workspace directly:

```bash
npm run launch --workspace better-review
```

Useful test commands:

```bash
npm run seed:review-fixture
npm run validate:cards -- --cards-dir .better-review/current/cards
npm run start-review -- --dry-run
```

MCP is intentionally out of scope for this proof of concept.
