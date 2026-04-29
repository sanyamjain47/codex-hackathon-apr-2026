---
id: evidence-02a-webhook-handler
level: 3
title: "Evidence: webhook handler"
parent: change-02-stripe-webhooks
order: 1
risk: high
confidence: high
status: unreviewed
labels:
  - webhook
  - security
  - code-evidence
image:
children: []
---

## What this evidence shows

Where Stripe events enter the application, how signatures are verified, and how idempotency is enforced.

## Relevant code

### Route entry and signature verification

```diff
+ // app/api/webhooks/stripe/route.ts
+ export const runtime = "nodejs";
+
+ export async function POST(req: Request) {
+   const body = await req.text();
+   const signature = req.headers.get("stripe-signature");
+   if (!signature) {
+     return new Response("missing signature", { status: 400 });
+   }
+
+   let event: Stripe.Event;
+   try {
+     event = stripe.webhooks.constructEvent(
+       body,
+       signature,
+       env.STRIPE_WEBHOOK_SECRET,
+     );
+   } catch {
+     return new Response("invalid signature", { status: 400 });
+   }
```

Why this matters:
Signature verification is the only thing standing between an attacker and free writes to billing state. It must run before any logging, parsing, or branching that touches the body.

Reviewer should verify:
The Next.js route uses the raw text body. Any middleware that pre-parses JSON will silently break verification — this is the most common production-only failure for Stripe webhooks.

### Idempotency and dispatch

```diff
+   const seen = await prisma.processedEvent.findUnique({
+     where: { stripeEventId: event.id },
+   });
+   if (seen) {
+     return new Response("ok", { status: 200 });
+   }
+
+   try {
+     await prisma.$transaction(async (tx) => {
+       await tx.processedEvent.create({ data: { stripeEventId: event.id } });
+       await dispatchEvent(tx, event);
+     });
+   } catch (err) {
+     if (err instanceof InvalidTransitionError) {
+       return new Response("ok", { status: 200 });
+     }
+     throw err;
+   }
+
+   return new Response("ok", { status: 200 });
+ }
```

Why this matters:
Recording the event ID inside the same transaction as the side effect is what actually makes processing idempotent. A naive "insert then process" can write the side effect twice if the second insert fails on the unique constraint after a retry.

Reviewer should verify:
- `dispatchEvent` accepts the transaction client and uses it for **all** writes. If any handler reaches for the global `prisma` instance, atomicity is gone.
- Swallowing `InvalidTransitionError` as 200 is intentional — it represents a stale replay, not a real failure — but should also be observable somewhere (counter, log).

## Open questions

- Should we 200 or 4xx on unsupported event types? Stripe will retry 4xx and eventually disable the endpoint after enough failures.
- Should signature failure increment a security counter, or is the access log sufficient?
