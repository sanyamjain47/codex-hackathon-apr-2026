---
id: evidence-01a-schema-migration
level: 3
title: "Evidence: schema migration"
parent: change-01-billing-state
order: 1
risk: high
confidence: high
status: unreviewed
labels:
  - migration
  - schema
  - code-evidence
image:
children: []
---

## What this evidence shows

The new `Subscription` table, its constraining enum, and the index that supports the most common lookup patterns (per-user reads and dunning sweeps).

## Relevant code

### Prisma schema additions

```diff
+ enum SubscriptionStatus {
+   trialing
+   active
+   past_due
+   canceled
+   incomplete
+ }
+
+ model Subscription {
+   id                    String              @id @default(cuid())
+   userId                String              @unique
+   stripeCustomerId      String
+   stripeSubscriptionId  String              @unique
+   status                SubscriptionStatus
+   currentPeriodEnd      DateTime
+   cancelAtPeriodEnd     Boolean             @default(false)
+   createdAt             DateTime            @default(now())
+   updatedAt             DateTime            @updatedAt
+
+   user                  User                @relation(fields: [userId], references: [id], onDelete: Cascade)
+
+   @@index([status, currentPeriodEnd])
+ }
```

Why this matters:
This is the durable contract every billing path depends on. Adding fields later is cheap; renaming or removing them is expensive once production data exists.

Reviewer should verify:
The `userId @unique` constraint matches the product rule "one active subscription per user." If multi-seat or multi-plan is on the roadmap, this will fight that change.

### Migration safety

```diff
+ -- AlterTable
+ ALTER TABLE "User" ADD COLUMN "billingCreatedAt" TIMESTAMP(3);
```

Why this matters:
The column is nullable, so the migration won't lock writes during backfill. The cost is that downstream code must tolerate `null`.

Reviewer should verify:
Every read of `billingCreatedAt` either coalesces with a default or is gated on a subscription existing. A blind `.toISOString()` will throw.

## Open questions

- Should `incomplete_expired` be a separate status, or stay collapsed into `canceled`?
- Should the Stripe price ID be denormalized onto `Subscription` for analytics, even though it's derivable via the Stripe API?
