---
id: change-03-admin-billing-ui
level: 2
title: Admin billing UI
parent: overview
order: 3
risk: medium
confidence: medium
status: unreviewed
labels:
  - ui
  - auth
  - admin
image: images/change-03-admin.svg
children:
  - evidence-03a-admin-dashboard
  - evidence-03b-status-badge
---

## What changed

A new `/admin/billing/[userId]` page renders the current subscription, the latest 20 webhook events, and three moderated actions: cancel, reactivate, refund last invoice. A reusable `StatusBadge` component normalizes status visuals across the user-facing settings page and the admin view.

## Why it matters

Support staff need first-class visibility into billing without reading the database directly. The actions exposed here all bypass normal user-driven flows, so authorization and audit logging matter more than usual — a chargeback dispute is harder to defend without a recorded reason.

## How it works

The page is a Server Component that loads the user, subscription, and recent events. Action buttons call Server Actions that re-check the staff role, append to an audit log, and then invoke `BillingService` (which itself routes through `applyTransition`).

## Spec / intent alignment

The spec mentions cancel and reactivate. Refund was added at the support team's request after spec sign-off — flagged for explicit approval rather than assumed.

## Review questions

- Is the staff-role check enforced in middleware **and** at the page **and** in each action handler? Server Actions feel like local function calls but are network-callable.
- Do destructive actions (refund, cancel) require a confirmation step?
- Is every staff-initiated action recorded with `actor`, `reason`, and the prior state — not just "what changed"?
- Does the page render reasonably when the user has no subscription at all?

## Risks

### Authorization

Three layers (middleware, page, action) need to agree on the role check. One weak link is enough; the most common mistake is omitting the check in a newly-added action handler.

### Audit

Refunds without a recorded reason are difficult to defend during a chargeback dispute. The audit-log call should not be a fire-and-forget side effect.

### Usability

A staff member who clicks "Cancel" expecting "cancel at period end" but gets immediate cancellation will create more support load than the action saved.

## Evidence to inspect

- Admin dashboard page
- Status badge
