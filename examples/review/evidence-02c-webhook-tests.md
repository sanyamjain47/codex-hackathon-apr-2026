---
id: evidence-02c-webhook-tests
level: 3
title: "Evidence: webhook tests"
parent: change-02-stripe-webhooks
order: 3
risk: medium
confidence: high
status: unreviewed
labels:
  - tests
  - code-evidence
image:
children: []
---

## What this evidence shows

The tests that lock in idempotency, signature verification, and unsupported-event behavior. These are the regression net for the highest-risk surface in this change.

## Relevant code

### Replay test

```diff
+ test("replayed event is processed exactly once", async () => {
+   const evt = makeEvent({ id: "evt_1", type: "customer.subscription.updated" });
+
+   await POST(makeReq(evt));
+   await POST(makeReq(evt));
+
+   const writes = await prisma.subscription.findMany({
+     where: { stripeSubscriptionId: evt.data.object.id },
+   });
+   expect(writes).toHaveLength(1);
+
+   const events = await prisma.processedEvent.findMany({
+     where: { stripeEventId: "evt_1" },
+   });
+   expect(events).toHaveLength(1);
+ });
```

Why this matters:
This is the only test that catches "we wrote twice." Removing or weakening it would let an idempotency regression ship — and idempotency regressions are mostly invisible until customers complain.

Reviewer should verify:
The test asserts row count, not just the latest status. A subtle bug could double-write the same status and still pass a status-only assertion.

### Signature failure test

```diff
+ test("rejects requests with an invalid signature", async () => {
+   const res = await POST(makeReq(makeEvent({}), { signature: "t=1,v1=bad" }));
+   expect(res.status).toBe(400);
+ });
```

Why this matters:
Locks in that signature verification cannot be quietly bypassed by a future refactor (e.g. someone adding global JSON body-parsing middleware).

Reviewer should verify:
Coverage for **both** "missing header" and "wrong header." Currently only the latter is tested.

### Unsupported event

```diff
+ test("unsupported event returns 200 and records the event id", async () => {
+   const evt = makeEvent({ id: "evt_x", type: "invoice.upcoming" });
+   const res = await POST(makeReq(evt));
+   expect(res.status).toBe(200);
+   const seen = await prisma.processedEvent.findUnique({
+     where: { stripeEventId: "evt_x" },
+   });
+   expect(seen).not.toBeNull();
+ });
```

Why this matters:
Asserts the chosen contract: unsupported events are acknowledged so Stripe stops retrying, but recorded so they're visible.

Reviewer should verify:
This matches what was decided in the change card. If the decision flips to 4xx, this test will need to flip with it.

## Open questions

- Should we add a property-style test that throws every Stripe status (including ones not yet released) at the mapping function?
