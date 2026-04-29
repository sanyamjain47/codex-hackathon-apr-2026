# Codex Hackathon April 2026

This repository contains the IntuneAI hackathon work for **BetterReview**, a
Codex plugin that turns a branch diff into a human-friendly review surface.

BetterReview is built around a simple premise: agent-authored changes should not
be reviewed as a flat pile of files. A reviewer should first see the intent,
then the conceptual changes, then the concrete evidence that supports each
claim. The plugin launches a local viewer and starts a separate Codex worker
that generates the review artifact in the background.

## What BetterReview Does

BetterReview replaces a traditional file-by-file diff pass with a guided review
workspace:

- A local viewer runs on `127.0.0.1` and opens from a Codex thread.
- A review worker analyzes the current branch diff using Codex App Server.
- The worker writes a self-contained review artifact into
  `.better-review/current/review.html`.
- The viewer presents the result as a card-based review organized around
  conceptual changes, supporting evidence, risk, confidence, and reviewer status.

The goal is not to hide the code. The goal is to put the code in the order a
thoughtful engineer would use to explain the change.

## Why It Exists

Coding agents can now produce large, multi-file changes quickly. Human review is
still stuck on tools optimized for raw file diffs. That creates two bad review
patterns: people skim and approve because a careful read is too costly, or they
reject useful work because the diff does not explain itself.

BetterReview is an experiment in giving reviewers a better default path:

1. Start with the overall intent and recommended review path.
2. Move through the conceptual changes in a sensible order.
3. Drill into exact code evidence when a claim needs verification.
4. Keep risk and confidence visible instead of burying them in prose.

## Repository Layout

```text
.
├── docs/                         # Shared architecture and planning notes
├── examples/review/              # Repo-level review fixture notes
├── plugins/
│   └── better-review/
│       ├── .codex-plugin/        # Plugin metadata exposed to Codex
│       ├── app/                  # Local app integration assets
│       ├── docs/                 # Product and review contract docs
│       ├── examples/review/      # Fixture cards used for validation
│       ├── scripts/              # Launcher, worker, validation, fixture tools
│       ├── skills/               # Codex skill instructions
│       └── viewer/               # Static viewer entry point
├── package.json                  # Root workspace scripts
└── README.md
```

The active package is `plugins/better-review`. The root package is a workspace
wrapper so common commands can be run from the repository root.

## BetterReview Architecture

BetterReview has two Codex roles:

- **Host agent**: the current Codex thread. It launches the viewer, starts the
  review run, and reports the local URL.
- **Worker agent**: a detached Codex App Server session spawned by
  `review-worker.mjs`. It reads the branch diff, generates the review, writes
  `review.html`, validates the result, and exits.

This split keeps the main Codex thread usable while review generation runs in
the background.

Each run writes state under `.better-review/current/`:

```text
.better-review/current/
├── manifest.json
├── review-request.md
├── worker.log
└── review.html
```

`.better-review/` is local runtime output and should not be committed.

## Review Contract

The review contract is documented in
`plugins/better-review/docs/contract.md`. The current design centers on a
three-level structure:

- **Overview**: what changed, what to review first, and where the main risks are.
- **Change cards**: conceptual changes such as a new billing state, webhook
  behavior, or admin UI flow. Files are not the unit of review at this level.
- **Evidence cards**: concrete code snippets, schema changes, tests, or diff
  hunks that support a specific claim.

Frontmatter is reserved for UI metadata such as `id`, `level`, `title`,
`parent`, `order`, `risk`, `confidence`, `status`, `labels`, and `children`.
Semantic review content belongs in the Markdown body.

## Quick Start

Install the plugin into Codex from this repository using the Codex plugin
installer, then enable BetterReview in your Codex plugins list.

Install dependencies:

```bash
npm install
```

Launch or reuse the local viewer:

```bash
npm run dev
```

The launcher prints the final URL with a `BETTER_REVIEW_URL=` prefix. It
prefers `http://127.0.0.1:3020` and uses the next available local port if
needed.

Start a BetterReview generation run:

```bash
npm run start-review
```

The command prepares `.better-review/current/`, starts the detached worker, and
returns quickly with session paths. The worker continues in the background.

## Development Commands

```bash
npm run dev                 # Launch the BetterReview viewer
npm run dev:app             # Same viewer launcher through the app script
npm run start-review        # Start a real review generation run
npm run validate:review     # Validate the generated review artifact
npm run seed:review-fixture # Seed .better-review/current with fixture content
npm run typecheck           # Syntax-check the plugin scripts
```

The plugin package can also be run directly:

```bash
npm run launch --workspace better-review
npm run start-review --workspace better-review
```

## Current Status

This is a hackathon proof of concept. The plugin shell, local viewer launch
path, worker orchestration, review contract, validation scripts, and fixtures
are in place. The project is intentionally local-first: no hosted service, no
multi-user state, no GitHub merge gate, and no persistent review database.

The next meaningful milestones are improving the generated review quality,
hardening the viewer against larger diffs, and deciding how reviewer status
should persist or sync back to a code review system.
