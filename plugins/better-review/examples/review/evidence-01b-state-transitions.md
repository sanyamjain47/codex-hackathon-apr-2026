---
id: evidence-01b-state-transitions
level: 3
title: "Evidence: state transition logic"
parent: change-01-billing-state
order: 2
risk: high
confidence: medium
status: unreviewed
labels:
  - state-machine
  - correctness
  - code-evidence
image:
children: []
---

## What this evidence shows

The allowed transitions between subscription states, and the helper that every writer is expected to route through.

## Relevant code

### Allowed transitions

```diff
+ const ALLOWED: Record<SubscriptionStatus, SubscriptionStatus[]> = {
+   trialing: ["active", "canceled", "incomplete"],
+   active: ["past_due", "canceled"],
+   past_due: ["active", "canceled"],
+   incomplete: ["active", "canceled"],
+   canceled: [],
+ };
+
+ export function canTransition(
+   from: SubscriptionStatus,
+   to: SubscriptionStatus,
+ ): boolean {
+   return ALLOWED[from].includes(to);
+ }
```

Why this matters:
`canceled` is intentionally terminal. Any path that re-activates a previously canceled subscription must create a new row, not mutate the existing one — otherwise audit history is destroyed.

Reviewer should verify:
Every call site that mutates `status` goes through `applyTransition` (below) — not raw `prisma.subscription.update({ data: { status } })`. Worth grepping for direct status writes before approving.

### Wrapper used by writers

```diff
+ export async function applyTransition(
+   subscriptionId: string,
+   to: SubscriptionStatus,
+ ): Promise<Subscription> {
+   return prisma.$transaction(async (tx) => {
+     const current = await tx.subscription.findUniqueOrThrow({
+       where: { id: subscriptionId },
+     });
+     if (!canTransition(current.status, to)) {
+       throw new InvalidTransitionError(current.status, to);
+     }
+     return tx.subscription.update({
+       where: { id: subscriptionId },
+       data: { status: to },
+     });
+   });
+ }
```

Why this matters:
Wrapping the read-then-write inside a single DB transaction prevents two concurrent webhook deliveries from racing past the guard.

Reviewer should verify:
The default Prisma transaction isolation is enough to actually serialize this read-then-write under concurrency, **and** that the webhook handler catches `InvalidTransitionError` so a stale Stripe replay doesn't 500.

## Open questions

- Should `InvalidTransitionError` from a stale replay be silently logged, or always alerted? It's both expected (replays) and suspicious (real bugs).
- Should `applyTransition` accept an optional `tx` so callers already inside a transaction don't open a nested one?
