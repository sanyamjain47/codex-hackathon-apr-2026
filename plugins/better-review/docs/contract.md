# Minimal frontmatter contract

Use the same lightweight frontmatter for every card:

```yaml
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
  - correctness
  - external-integration
  - tests
image: images/change-02-stripe-webhooks.png
children:
  - evidence-02a-webhook-handler
  - evidence-02b-webhook-tests
---
```

That’s probably enough.

## Field meanings

```yaml
id: stable unique card id
level: 1 | 2 | 3
title: display title
parent: parent card id, null/omitted for overview
order: reading order among siblings
risk: low | medium | high
confidence: low | medium | high
status: unreviewed | approved | flagged | needs-change
labels: flexible review tags
image: optional image path
children: child card ids
```

That gives the UI:

* tree navigation
* card ordering
* badges
* progress state
* optional visuals
* drilldown links

And it does **not** over-prescribe the content.

---

# The 3 levels

## Level 1 — Overview

Purpose:

> Orient the reviewer and define the recommended review path.

Frontmatter:

```yaml
---
id: overview
level: 1
title: Review Overview
order: 0
risk: high
confidence: medium
status: unreviewed
labels:
  - overview
  - review-plan
image: images/overview.png
children:
  - change-01-billing-state
  - change-02-stripe-webhooks
  - change-03-admin-ui
---
```

Markdown body:

```md
## What changed

Briefly explain the overall change in human language.

## Review path

1. Billing state model
2. Stripe webhook processing
3. Admin billing UI
4. Tests and config

## Why this order

Explain why the reviewer should read it in this sequence.

## Main risks

- Webhook idempotency
- State transition correctness
- Admin route authorization
- Test coverage gaps

## Context used

Mention the available spec, prompt, issue, PR description, or lack of context.
```

The agent instruction:

> At Level 1, do not summarize files. Summarize the change set. Identify the conceptual review path and the highest-risk areas. Use the spec/prompt/PR description when available.

---

## Level 2 — Change Card

Purpose:

> Explain one conceptual change deeply enough that a developer can decide whether they agree with it.

Frontmatter:

```yaml
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
  - idempotency
  - tests
image: images/change-02-sequence.png
children:
  - evidence-02a-webhook-handler
  - evidence-02b-subscription-service
  - evidence-02c-webhook-tests
---
```

Markdown body:

```md
## What changed

Explain the conceptual change.

## Why it matters

Explain why a human reviewer should care.

## How it works

Describe the implementation flow at a high level.

## Spec / intent alignment

Explain whether this appears to match the provided spec, prompt, issue, or PR description.

## Review questions

- Is webhook handling idempotent?
- Are out-of-order events safe?
- Are unsupported external states handled?
- Are error paths observable and retry-safe?

## Risks

### Correctness
...

### Security / data safety
...

### Maintainability
...

### Tests
...

## Evidence to inspect

- Webhook handler evidence
- Subscription service evidence
- Webhook test evidence
```

The agent instruction:

> At Level 2, the unit is a conceptual change, not a file. Mention files only when useful, in natural language. Do not produce a file inventory. Explain what decision the reviewer is being asked to make, why it matters, what could go wrong, and which evidence cards support the claim.

---

## Level 3 — Evidence Card

Purpose:

> Prove the Level 2 explanation with concrete code evidence.

This is the only level where file-level specificity belongs.

Frontmatter:

```yaml
---
id: evidence-02a-webhook-handler
level: 3
title: Evidence: webhook handler
parent: change-02-stripe-webhooks
order: 1
risk: high
confidence: high
status: unreviewed
labels:
  - diff
  - webhook
  - code-evidence
image:
children: []
---
```

Markdown body:

````md
## What this evidence shows

Explain what this file/hunk proves about the parent change.

## Relevant code

### Failed invoice handling

```diff
+ case "invoice.payment_failed":
+   await billingService.markPastDue(subscriptionId)
```

Why this matters:
This is where failed payment events start mutating internal subscription state.

Reviewer should verify:
The event has been deduplicated before this side effect runs.

### Subscription update handling

```diff
+ case "customer.subscription.updated":
+   await billingService.syncStatus(subscriptionId, stripeStatus)
```

Why this matters:
This maps external Stripe lifecycle state into the internal domain model.

Reviewer should verify:
Unsupported Stripe states are handled explicitly.

## Open questions

- Is signature verification done before this point?
- Is event ID persistence atomic with side effects?
- Are retries safe?
````

The agent instruction:

> At Level 3, be precise. Show only the code evidence needed to support the parent card. Include relevant hunks, explain why each hunk matters, and state what the reviewer should verify. Avoid restating the full Level 2 summary.

---

# Recommended labels

Keep labels flexible, but give the agent a suggested vocabulary:

```yaml
labels:
  - architecture
  - correctness
  - security
  - auth
  - data-model
  - migration
  - external-integration
  - api-contract
  - ui
  - tests
  - config
  - maintainability
  - performance
  - observability
  - generated
  - low-risk
```

This is better than many structured fields. It gives the UI enough to render badges and filters without forcing the agent into a rigid schema.

---

# The important simplification

Remove these from frontmatter:

```yaml
files:
spec_alignment:
review_focus:
hunks:
symbols:
raw_diff_ref:
agent_confidence_reason:
```

Those are useful ideas, but they belong in markdown body, not YAML.

The agent can still say:

```md
## Spec / intent alignment

This matches the billing lifecycle spec around syncing subscription state from Stripe, but the spec does not explicitly mention idempotency.
```

That is much more natural and less likely to distort the abstraction.

---

# The contract I’d give Codex

```text
Generate a 3-level review tree using markdown files with lightweight YAML frontmatter.

The three levels are:

Level 1: Review Overview
- Summarize the overall change.
- Recommend the order in which a human should review it.
- Identify major risks and context used.
- Do not summarize files one by one.

Level 2: Change Card
- Each card represents one conceptual change.
- Explain what changed, why it matters, how it works, alignment with the spec/prompt, risks, review questions, and evidence to inspect.
- Do not make files the primary unit.
- Mention files only naturally when they help explain the change.

Level 3: Evidence Card
- Each card provides concrete code evidence for one parent Change Card.
- This can be file-level or hunk-level.
- Include relevant diff snippets, why they matter, and what the reviewer should verify.
- Do not include unrelated hunks.

Use frontmatter only for UI metadata:
id, level, title, parent, order, risk, confidence, status, labels, image, children.

Use markdown body for all semantic review content.

Every important Level 1 or Level 2 claim should be supported by one or more Level 3 evidence cards.
Prefer fewer, higher-quality cards over many shallow cards.
```

---

# The resulting product shape

```text
Overview
  ├── Change: Billing state model
  │     ├── Evidence: schema changes
  │     └── Evidence: state transition logic
  │
  ├── Change: Stripe webhook processing
  │     ├── Evidence: webhook handler
  │     ├── Evidence: subscription service
  │     └── Evidence: webhook tests
  │
  └── Change: Admin billing UI
        ├── Evidence: dashboard page
        └── Evidence: status badge component
```

The UI remains simple:

```text
Tree metadata comes from frontmatter.
Review content comes from markdown.
Code trust comes from Level 3 evidence.
```

This keeps the architecture clean without overfitting the agent to files.
