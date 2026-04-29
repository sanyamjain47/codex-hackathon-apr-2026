---
name: better-review
description: Use when the user tags or invokes BetterReview and wants Codex to launch the local review UI and start a BetterReview card-generation run for the current branch.
---

# BetterReview

When the user invokes BetterReview, launch the local static UI in the Codex browser and start a fire-and-forget BetterReview card-generation run for the current branch. Prefer reusing an already-running viewer before starting a new process.

## Workflow

1. From the repo root, run the launcher:

```bash
npm run dev:app
```

The launcher is idempotent. If BetterReview is already running on the preferred local port, it prints the existing URL and exits successfully. Otherwise, it starts the local static viewer server.

2. Read the launcher output and capture the local URL from the line prefixed with:

```text
BETTER_REVIEW_URL=
```

3. If the launcher started a server process, wait for the dev server to report that it is ready. If the launcher exited after reporting an already-running viewer, open the URL immediately.

4. Open the captured local URL in the Codex browser. The preferred URL is:

```text
http://127.0.0.1:3020
```

5. Start card generation from the repo root:

```bash
npm run start-review --workspace better-review
```

Use `--target <absolute-path>` when the user wants to review a different git work tree, and use `--base <branch-or-sha>` only when the script cannot infer the branch base.

6. Do not wait for generation to complete. Tell the user the UI is running, provide the local URL, and say that progress appears in the browser as `.better-review/current/cards` fills in.

## Notes

- Do not build review prompts inside the skill. The script owns prompt construction.
- Do not manually edit `.better-review/current/cards`; the App Server worker writes those files.
- Do not stage or commit generated review cards.
- The launcher uses port `3020` when available and otherwise chooses the next available local port.
