# BetterReview Architecture

## Goal

Build a Codex plugin that launches a local static UI when the user invokes BetterReview from a Codex thread, then starts a fire-and-forget Codex App Server review worker that writes Markdown review cards.

## Recommended Shape

```text
Codex thread
  |
  | user invokes BetterReview
  v
Plugin skill
  |
  | npm run dev:app + npm run start-review
  v
Launcher reuses or starts app, then prints BETTER_REVIEW_URL=http://127.0.0.1:<port>
  |
  v
Static viewer on 127.0.0.1:<port>
  |
  | polls .better-review/current
  v
Visible BetterReview UI
  ^
  |
Codex App Server review worker writes .better-review/current/cards/*.md
```

The default model is `gpt-5.4` with `serviceTier: "fast"` and `effort: "low"`,
because the local App Server currently advertises `gpt-5.4` as fast-capable and
does not list `gpt-5.5`. Override with `BETTER_REVIEW_MODEL` when a newer model
is available.

## Packages

### Plugin Shell

Path: `plugins/better-review`

Owns Codex plugin metadata:

- `.codex-plugin/plugin.json`
- `.app.json`
- `skills/`
- package-level scripts that reuse or start the static viewer through the local launcher

### Viewer

Path: `plugins/better-review/viewer`

Initial responsibility:

- Provide a minimal static viewer.
- Prove Codex can start and open the local UI.

Future responsibility:

- Render full review card content.
- Show annotations once the review engine is ready.

## MVP Boundary

The first implementation should prove this:

- the plugin can be invoked from a Codex thread
- Codex can start the local static viewer
- Codex can open the `BETTER_REVIEW_URL=` URL in the browser
- the review worker can prepare `.better-review/current`
- the static viewer can show review status and card count
- generated cards validate against `docs/contract.md`

## Security Notes

- Bind local HTTP only to `127.0.0.1`.
- Keep the skill launch command narrow.
- MCP is not required for the proof of concept.
- The review worker must write only inside `.better-review/current/cards`.
