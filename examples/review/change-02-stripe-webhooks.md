---
id: change-02-stripe-webhooks
level: 2
title: Stripe webhook processing
parent: overview
order: 2
risk: high
confidence: medium
status: unreviewed
labels:
  - external-integration
  - correctness
  - security
  - tests
image: images/change-02-webhooks.svg
children:
  - evidence-02a-webhook-handler
  - evidence-02b-subscription-service
  - evidence-02c-webhook-tests
---

## What changed

A new `POST /api/webhooks/stripe` route receives Stripe events, verifies signatures, deduplicates by event ID, and dispatches to a `BillingService` that updates the subscription state through `applyTransition`.

## Why it matters

This is the only writer to the billing state from Stripe. Anything mishandled here — signature, replay, ordering, unsupported events — silently produces incorrect billing in production. By the time a customer complains, the corrupt row already exists.

## How it works

The route reads the raw request body (required for signature verification), calls `stripe.webhooks.constructEvent`, then in a single transaction inserts the event ID into a `processed_events` table and dispatches to a typed handler per event type. Idempotency comes from the unique constraint on `stripeEventId`, not from a separate "have we seen this?" check.

## Spec / intent alignment

Aligns with the events listed in the spec. The spec doesn't mention idempotency explicitly; the implementation enforces it via `processed_events`. Out-of-order events use Stripe's `created` timestamp rather than local clock to decide whether to apply.

## Review questions

- Is the raw body preserved through any framework middleware? Next.js can pre-parse JSON bodies and silently break verification.
- Is the `processed_events` insert in the same transaction as the state mutation? A naive "insert, then process" leaks at-least-once delivery.
- Are unsupported event types logged and 200'd, or do we 4xx? Stripe stops retrying after enough 4xxs — that may or may not be what we want.
- Does the handler tolerate a partial Stripe outage without dropping events?

## Risks

### Security

Signature verification must run before any downstream side effect, including logging the payload. A logged-then-failed payload still teaches an attacker what gets through.

### Correctness

Out-of-order events (e.g. `subscription.updated` arriving after `subscription.deleted`) must not resurrect a deleted subscription. The state machine prevents this, but only if every handler routes through it.

### Observability

Failed events should land somewhere queryable; currently only `console.error` is used. A failed webhook is silent in production.

### Tests

Replay, signature failure, and unsupported events all need explicit tests. Two of three exist today.

## Evidence to inspect

- Webhook handler
- Subscription service
- Webhook tests
