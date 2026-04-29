---
id: change-01-billing-state
level: 2
title: Billing state model
parent: overview
order: 1
risk: high
confidence: high
status: unreviewed
labels:
  - data-model
  - migration
  - correctness
image: images/change-01-state.svg
children:
  - evidence-01a-schema-migration
  - evidence-01b-state-transitions
---

## What changed

A new `subscriptions` table is added with a constrained status enum, plus a small state-machine helper that gates transitions between billing states. Every writer — webhook handler, admin actions, future flows — is expected to route through this helper rather than write `status` directly.

## Why it matters

Every billing-related read and write in the app depends on this shape. Once it's persisted in production, changing it is expensive. Incorrect transitions (for example, allowing `canceled → active`) would let a non-paying customer keep paid features without anyone noticing immediately.

## How it works

A Prisma migration introduces the `Subscription` model and a `SubscriptionStatus` enum. A `BillingState` module exports `canTransition(from, to)` and an `applyTransition(subscriptionId, to)` wrapper that runs the read and write inside a single DB transaction so concurrent webhook deliveries can't race past the guard.

## Spec / intent alignment

Matches the lifecycle diagram in `docs/specs/billing-v1.md`. The spec does not mention `incomplete_expired`; the implementation collapses it to `canceled`. Worth confirming this is the desired behavior with the spec owner.

## Review questions

- Are the columns indexed for the queries the rest of the app actually runs (lookup by `userId`, dunning sweeps by `status, currentPeriodEnd`)?
- Does the migration backfill existing users to a sensible default, or does it rely on lazy creation on first checkout?
- Are state transitions guarded everywhere subscriptions are mutated, not just in the webhook handler?
- What happens to dependent rows (invoices, audit log) on a hard delete of a `User`?

## Risks

### Correctness

A missing transition rule means impossible states become reachable as soon as Stripe adds a new event type or sequence we don't expect.

### Migration

Adding a NOT NULL column with a default to a hot table can lock writes during the rewrite on Postgres. The current migration adds a nullable column, but downstream code now needs to tolerate `null`.

### Tests

The state-machine helper benefits from exhaustive tests over the cross-product of (from, to). Currently only happy-path transitions are exercised.

## Evidence to inspect

- Schema migration
- State transition logic
