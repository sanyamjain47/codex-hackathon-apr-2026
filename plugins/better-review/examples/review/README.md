# Example Review Tree

This folder is a sample input for the BetterReview frontend. It models a realistic feature branch — **adding Stripe-based subscription billing to a SaaS app** — using the lightweight card contract from `docs/contract.md`:

- Frontmatter is UI metadata.
- Markdown body is review content.
- Level 1 is the overview.
- Level 2 cards describe conceptual changes.
- Level 3 cards provide concrete code evidence.

## The scenario

A single feature branch that introduces:

1. A `Subscription` table and a small state machine that gates transitions.
2. A Stripe webhook endpoint that writes through the state machine, with signature verification and idempotency.
3. A staff-only admin page for inspecting and manually adjusting a user's billing.

These are the three Level 2 cards. Each is supported by Level 3 evidence cards with realistic diff hunks (Prisma schema, route handler, service, tests, page, component).

## Suggested frontend plan

Use this data shape first, before wiring a real review engine:

1. Load every `*.md` file from `examples/review`.
2. Parse lightweight frontmatter.
3. Validate the card shape with the BetterReview validator.
4. Sort cards by `parent` and `order`.
5. Render a three-pane review UI:
   - left: tree navigation
   - center: Markdown card body
   - right: metadata, risk, status, labels, evidence links
6. Render Markdown in the eventual card renderer, with custom handling for images, links, code blocks, tables, and task lists.
7. Keep review status local-only at first; replace with persisted state once the backend workflow contract exists.

## Renderer choice

The first pass uses a static progress surface only. When full card rendering lands, keep raw HTML disabled unless paired with sanitization.

## Files

```text
examples/review
  overview.md
  change-01-billing-state.md
  change-02-stripe-webhooks.md
  change-03-admin-billing-ui.md
  evidence-01a-schema-migration.md
  evidence-01b-state-transitions.md
  evidence-02a-webhook-handler.md
  evidence-02b-subscription-service.md
  evidence-02c-webhook-tests.md
  evidence-03a-admin-dashboard.md
  evidence-03b-status-badge.md
  images/
```
