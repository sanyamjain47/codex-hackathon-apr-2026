---
id: evidence-02b-subscription-service
level: 3
title: "Evidence: subscription service"
parent: change-02-stripe-webhooks
order: 2
risk: medium
confidence: medium
status: unreviewed
labels:
  - service
  - mapping
  - code-evidence
image:
children: []
---

## What this evidence shows

How Stripe's external statuses are mapped into the internal enum, and which writer each event uses.

## Relevant code

### Stripe → internal status mapping

```diff
+ const STRIPE_TO_INTERNAL: Record<string, SubscriptionStatus> = {
+   trialing: "trialing",
+   active: "active",
+   past_due: "past_due",
+   canceled: "canceled",
+   incomplete: "incomplete",
+   incomplete_expired: "canceled",
+   unpaid: "past_due",
+ };
+
+ export function mapStripeStatus(s: Stripe.Subscription.Status): SubscriptionStatus {
+   const mapped = STRIPE_TO_INTERNAL[s];
+   if (!mapped) {
+     throw new UnknownStripeStatusError(s);
+   }
+   return mapped;
+ }
```

Why this matters:
Stripe occasionally adds new statuses. Without an explicit allow-list, a new value either crashes downstream code or silently coerces into something visually similar but semantically wrong.

Reviewer should verify:
- Whether `incomplete_expired → canceled` is the intended collapse — the spec doesn't say.
- Whether `unpaid → past_due` should also kick off dunning. Currently it does not.

### `subscription.updated` handler

```diff
+ case "customer.subscription.updated": {
+   const sub = event.data.object as Stripe.Subscription;
+   const internalStatus = mapStripeStatus(sub.status);
+   const local = await tx.subscription.findUnique({
+     where: { stripeSubscriptionId: sub.id },
+   });
+   if (!local) {
+     return;
+   }
+   await applyTransition(local.id, internalStatus);
+   break;
+ }
```

Why this matters:
Routing through `applyTransition` is what enforces the state-machine guard. A future contributor reading this file should see this exact pattern and copy it for new event handlers.

Reviewer should verify:
The early return on missing `local` is intentional (subscription created out-of-band, e.g. in Stripe dashboard) and not a swallowed bug. Worth at least a debug log so it's not invisible.

### `subscription.deleted` handler

```diff
+ case "customer.subscription.deleted": {
+   const sub = event.data.object as Stripe.Subscription;
+   const local = await tx.subscription.findUnique({
+     where: { stripeSubscriptionId: sub.id },
+   });
+   if (!local || local.status === "canceled") return;
+   await applyTransition(local.id, "canceled");
+   break;
+ }
```

Why this matters:
The early return on `local.status === "canceled"` is what makes out-of-order delivery safe. Without it, a delayed `deleted` event arriving after a manual reactivate would corrupt state.

Reviewer should verify:
This logic relies on `canceled` being terminal in the state machine. If that ever changes, this handler needs to change with it.

## Open questions

- Should we record which Stripe status mapped to which internal status in the audit log, for future debugging?
