# Skills

This directory holds the Codex skills the BetterReview plugin contributes.

## `better-review`

The single entrypoint skill. Triggers on `/better-review` and on natural
phrasings like "BetterReview this branch" or "review this PR with
BetterReview". Its full instruction set is in
[`better-review/SKILL.md`](./better-review/SKILL.md).

### What it does

Orchestrates the BetterReview review pipeline from a host Codex thread:

1. Verifies `codex` CLI is installed (the worker depends on `codex app-server`).
2. Launches (or reuses) a local static viewer on `127.0.0.1:3020`.
3. Opens that URL in the user's browser.
4. Runs `start-review.mjs` to spawn a fire-and-forget review worker.
5. Reports back with the URL and yields — does **not** block on the worker.

The worker is a separate Codex agent that writes a single
`.better-review/current/review.html` file. The viewer serves that file once it
exists; until then it serves the editable template
(`examples/BetterReview-Template.html`), which renders a sample mock review on
its own.

### Why a single skill instead of several

Earlier iterations had separate skills for "launch viewer" and "trigger
review". They drifted out of sync. The single orchestrator keeps the host
agent's job small and the failure modes easy to diagnose: if anything goes
wrong, the manifest at `.better-review/current/manifest.json` tells the agent
exactly where to look.

For the deeper architectural picture — including the host-agent-vs-worker-agent
split, the session directory contract, and error recovery — read
[`better-review/SKILL.md`](./better-review/SKILL.md) directly. It is also what
Codex itself reads at runtime when the skill is invoked.
