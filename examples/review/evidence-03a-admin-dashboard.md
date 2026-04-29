---
id: evidence-03a-admin-dashboard
level: 3
title: "Evidence: admin dashboard page"
parent: change-03-admin-billing-ui
order: 1
risk: medium
confidence: medium
status: unreviewed
labels:
  - ui
  - nextjs
  - auth
  - code-evidence
image: images/evidence-image.svg
children: []
---

## What this evidence shows

How the staff billing page is rendered, where the role check lives, and how moderated actions are wired.

## Relevant code

### Role-gated server component

```diff
+ // app/admin/billing/[userId]/page.tsx
+ export default async function AdminBillingPage({
+   params,
+ }: { params: { userId: string } }) {
+   const session = await getServerSession();
+   if (session?.user?.role !== "staff") {
+     notFound();
+   }
+
+   const [user, subscription, events] = await Promise.all([
+     prisma.user.findUniqueOrThrow({ where: { id: params.userId } }),
+     prisma.subscription.findUnique({ where: { userId: params.userId } }),
+     prisma.processedEvent.findMany({
+       where: { subscription: { userId: params.userId } },
+       orderBy: { createdAt: "desc" },
+       take: 20,
+     }),
+   ]);
+
+   return <AdminBillingView user={user} subscription={subscription} events={events} />;
+ }
```

Why this matters:
`notFound()` is preferred over a 403 to avoid leaking the existence of `/admin/billing/*` to non-staff users. Staff access patterns shouldn't be discoverable.

Reviewer should verify:
The same check exists on every action handler. Page-level guards alone are not sufficient — Server Actions are network-callable independently of the page that renders them.

### Server Action wiring

```diff
+ // app/admin/billing/[userId]/actions.ts
+ "use server";
+
+ export async function cancelSubscriptionAction(
+   subscriptionId: string,
+   reason: string,
+ ) {
+   const session = await getServerSession();
+   if (session?.user?.role !== "staff") {
+     throw new ForbiddenError();
+   }
+
+   await prisma.$transaction(async (tx) => {
+     await tx.auditLog.create({
+       data: {
+         actorId: session.user.id,
+         action: "subscription.cancel",
+         targetId: subscriptionId,
+         reason,
+       },
+     });
+     await applyTransition(subscriptionId, "canceled");
+   });
+
+   revalidatePath(`/admin/billing/${session.user.id}`);
+ }
```

Why this matters:
Server Actions feel like local function calls but are network-callable. They need the same role check **and** the same audit-log writes as a public route handler — and both must happen before the state mutation.

Reviewer should verify:
- The audit-log insert is in the same transaction as the state change. If the transition succeeds and the audit insert is fire-and-forget, a chargeback dispute later won't have the receipt.
- `revalidatePath` targets the right route — the bug above (`session.user.id` instead of the affected user's id) is exactly the kind of mistake that ships.

## Open questions

- Should refunds require two-staff approval, or is single-actor + audit log enough?
- Should the page render a banner when the user has no subscription, or 404?
