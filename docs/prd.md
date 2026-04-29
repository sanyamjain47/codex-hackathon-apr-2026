# BetterReview — PRD

## One-line summary

A Codex plugin that opens a local web UI for reviewing agent-generated change sets, grouped semantically into a three-level tree (overview → conceptual changes → code evidence) so a human reviewer can move through the work in the order an experienced engineer would, instead of file-by-file.

## Problem

Coding agents now produce large, multi-file change sets in minutes. Human review has not scaled with that throughput.

The default review surface (a flat list of file diffs) was already a poor fit for human-authored PRs. It is actively hostile for agent-authored ones:

- It treats every file as equally important and equally ordered.
- It hides the conceptual change behind the mechanics of how it was implemented.
- It makes it cheap to skim and approve, and expensive to actually understand.
- It offers no place to record *why* a change is the way it is.

The result is one of two failure modes: reviewers rubber-stamp the diff because reading it carefully is too costly, or they reject good work because the surface gives them no way to gain confidence efficiently. Both erode trust in the agent and slow the team down.

## Goal

Make reviewing an agent-produced change set feel like being walked through it by a thoughtful engineer who already understands the work, in roughly the time it takes to read a well-written PR description — and let the reviewer drill into concrete code evidence whenever they want to verify a claim rather than trust it.

## Non-goals (for the proof of concept)

- Generating the review tree. The agent backend that produces `examples/review/`-shaped output is a separate workstream.
- Persisting review state across sessions, users, or machines.
- Multi-user collaboration, comments, or approval workflows.
- Replacing GitHub PR review, code-host integrations, or merge gates.
- Hosted deployment. The viewer runs on `127.0.0.1` only.
- Authoring or editing review cards from the UI.

These may all be revisited later; they are out of scope for the first usable version.

## Users

- **The reviewer** — an engineer asked to review work an agent produced. Wants to gain enough confidence to approve, request changes, or ask sharper questions, without reading every file.
- **The agent author** (indirect) — the upstream system generating the review tree. Its quality is judged by how often the reviewer trusts the overview and how rarely they need to fall back to raw diffs.

The first version optimizes entirely for the reviewer.

## What it does (user-visible)

1. The reviewer invokes the plugin from a Codex thread on a branch with a change set.
2. The plugin starts a local static viewer and prints `BETTER_REVIEW_URL=http://127.0.0.1:<port>`.
3. Codex opens that URL.
4. The reviewer lands on a three-pane workspace:
   - **Tree** of cards, grouped overview → change → evidence.
   - **Card body** rendered from Markdown, with badges for risk, confidence, and status.
   - **Side panel** with metadata, labels, and links to child evidence cards.
5. The reviewer can mark cards as `approved`, `needs-change`, `flagged`, or leave them `unreviewed`. Status is local-only for now.
6. From any conceptual change, the reviewer can drill into the evidence card(s) supporting it — code snippets with "why this matters" and "what to verify" attached.

## How the work is organized — the contract

Defined in detail in `docs/contract.md`. Three levels:

- **Level 1 — Overview.** What changed at a conceptual level, the recommended review path, the main risks, and the context the agent had.
- **Level 2 — Change card.** One conceptual change. What it is, why it matters, how it works, alignment with intent, review questions, risks, and which evidence supports it. *Files are not the unit at this level.*
- **Level 3 — Evidence card.** Concrete code evidence — diff hunks, function definitions, schema changes — for one Level 2 claim. Each snippet is paired with *why it matters* and *what the reviewer should verify*.

Frontmatter is UI metadata only (`id`, `level`, `title`, `parent`, `order`, `risk`, `confidence`, `status`, `labels`, `image`, `children`). All semantic content lives in the Markdown body.

## Why this shape

- **The unit of review is the conceptual change, not the file.** Agents already think in conceptual changes; the review surface should match.
- **Evidence is separated from explanation.** A reviewer who trusts the explanation can move on; a reviewer who doesn't can drill in. Both are first-class.
- **Risks and "what to verify" are explicit.** Reviewer attention is the scarce resource; the tree should direct it.
- **The contract is small.** Frontmatter is metadata, body is prose. The agent doesn't get to over-structure things and the UI doesn't get to overfit.

## MVP scope

The first usable version delivers:

1. **Plugin shell** (`plugins/better-review`) — Codex plugin metadata and a skill that launches the viewer and prints `BETTER_REVIEW_URL=`.
2. **Local static viewer** (`plugins/better-review/viewer`) — bound to `127.0.0.1`, no auth, no telemetry.
3. **Card loader** — reads Markdown files from a configured review directory, validates lightweight frontmatter, and constructs the tree from `parent`/`children` + `order`.
4. **Three-pane review UI** — tree, card body, metadata side panel.
5. **Markdown rendering** — out of scope for the first progress surface; raw HTML remains disabled when full rendering is added.
6. **Local-only review status** — toggleable per card, not persisted.
7. **Fixture-backed development** — `examples/review/` is the canonical fixture. The viewer must run end-to-end against it without any backend.

Out of MVP: a real review-generation backend, persistence, auth, deployment, multi-user state, GitHub integration.

## Success criteria

The MVP is successful if all of the following hold against the `examples/review/` fixture:

- A reviewer who has never seen the change can read the overview and the three change cards in under five minutes and explain back what changed and where the risks are.
- Drilling from any "Reviewer should verify" line to the relevant evidence is a single click.
- The viewer launches from a Codex thread in one command and opens in the browser without manual steps.
- Adding a new card to the fixture requires no UI change — the loader, schema, and renderer absorb it.
- Removing or renaming a card surfaces a clear development-time warning rather than a silent failure.

## Open questions (worth deciding before shipping the MVP)

- Should approval of a Level 2 card require all child evidence cards to be approved, or are they independent?
- Should review status persist to `localStorage` for the session, or reset on every load?
- Should the URL encode the selected card (`/review/[id]`) so links into a specific card work?
- How do we render a card whose evidence references files larger than fit in a snippet — link out, expand inline, or virtualize?
- What's the visual treatment when the agent itself flagged low confidence vs. the reviewer flagged needs-change? Two different signals, easy to conflate.

## Risks

- **Looking like a file browser.** If the UI surfaces files prominently at Level 1 or Level 2, the conceptual-change framing collapses and the product reverts to a slower flat diff viewer.
- **Trusting the tree too much.** The reviewer needs an obvious escape hatch back to raw diffs when the overview feels wrong; without one, the surface becomes a place agents can hide work in.
- **Markdown rendering surface.** Code blocks, tables, and images all stress dense layouts differently; a renderer that looks fine on the overview can fall apart on a long evidence card.
- **Premature persistence.** Persisting review state too early creates the illusion of multi-user review where none exists, and locks in shape decisions before the workflow contract is settled.

## Security notes

- HTTP server binds only to `127.0.0.1`.
- The skill launch command is narrow.
- Raw HTML is disabled in the Markdown renderer for the MVP. If it's enabled later for richer content, it must be paired with sanitization.
- The viewer does not execute review logic. It only renders cards produced by an upstream agent.
- MCP is not required for the proof of concept.

## Future direction (post-MVP, not a commitment)

- A real review-generation backend that produces the card tree from a branch + spec/PR description.
- Persisted review state, scoped to a branch + reviewer.
- GitHub integration: opening directly from a PR, syncing approvals back.
- Threaded comments at card granularity.
- Reviewer-authored notes that the agent can read in a follow-up turn.
- A "review path" replay mode that walks the reviewer through the cards in order.
