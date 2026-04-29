---
id: evidence-03b-status-badge
level: 3
title: "Evidence: status badge component"
parent: change-03-admin-billing-ui
order: 2
risk: low
confidence: high
status: unreviewed
labels:
  - ui
  - component
  - code-evidence
image:
children: []
---

## What this evidence shows

The shared status visual used by both the admin billing page and the user-facing settings page.

## Relevant code

### Status → variant mapping

```diff
+ // components/billing/status-badge.tsx
+ const STATUS_VARIANT: Record<SubscriptionStatus, BadgeVariant> = {
+   trialing: "info",
+   active: "success",
+   past_due: "warning",
+   incomplete: "warning",
+   canceled: "neutral",
+ };
+
+ const STATUS_LABEL: Record<SubscriptionStatus, string> = {
+   trialing: "Trial",
+   active: "Active",
+   past_due: "Past due",
+   incomplete: "Setup incomplete",
+   canceled: "Canceled",
+ };
+
+ export function StatusBadge({ status }: { status: SubscriptionStatus }) {
+   return (
+     <Badge variant={STATUS_VARIANT[status]}>
+       {STATUS_LABEL[status]}
+     </Badge>
+   );
+ }
```

Why this matters:
A single mapping prevents the user-facing settings page and the admin page from disagreeing on what a given status looks like — which would make screenshots in support tickets confusing.

Reviewer should verify:
- Color is not the sole signal. The label text alone should be enough for a screen reader or a color-blind reviewer.
- Each `SubscriptionStatus` enum value has both a variant and a label entry. TypeScript's `Record` will catch the obvious case; harder to catch is when a new status is added to the enum and only one of these maps is updated.

## Open questions

- Should `past_due` surface a CTA in the user-facing version (e.g. "Update payment method"), or stay visual-only and let a separate banner own that?
- Should `canceled` show the cancellation date inline, or is that the parent component's responsibility?
