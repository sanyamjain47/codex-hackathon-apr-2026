#!/usr/bin/env python3
"""Minimal Python client for the Codex `app-server` JSON-RPC protocol.

Spawns `codex app-server` over stdio (newline-delimited JSON-RPC 2.0), runs
the required `initialize` / `initialized` handshake, then exposes a few
subcommands for inspecting and driving Codex threads.

Subcommands
-----------
  list                    Page through stored threads (vscode, cli, app-server).
  read <thread-id>        Fetch a thread's metadata without resuming it.
  new "<prompt>"          Start a new thread, send one prompt, stream the reply.
  resume <id> "<prompt>"  Resume an existing thread, send a prompt, stream reply.

Notes
-----
* `cwd` is bound at thread creation. `thread/start` accepts a `cwd` param;
  `thread/resume` ignores any cwd you pass — the thread keeps its original.
* Without `--cwd`, new threads default to wherever `codex app-server` was
  launched from (i.e. the cwd of this script's process).
* The script does *not* handle approvals — if Codex requests one for a
  shell command or file change, it logs to stderr and lets the turn proceed
  without responding. Fine for Q&A; not safe for autonomous file edits.
* Thread ids are printed to stdout (the streamed model reply goes to stdout
  too). All bookkeeping/diagnostics go to stderr, so you can pipe stdout.

Examples
--------
  python3 codex_client.py list
  python3 codex_client.py list --limit 5 --json
  python3 codex_client.py new --cwd /tmp "What directory are you in?"
  python3 codex_client.py resume 019dd72c-... "Summarise this thread."
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime
from itertools import count
from typing import Any, Iterator


# ---------------------------------------------------------------------------
# JSON-RPC client
# ---------------------------------------------------------------------------


class CodexAppServer:
    """Thin wrapper around a `codex app-server` subprocess.

    Speaks newline-delimited JSON-RPC 2.0 over stdio. Use as a context manager
    so the subprocess is shut down cleanly. Call `handshake()` before any
    other request — the server requires `initialize` + `initialized` first.
    """

    def __init__(self, cmd: list[str] | None = None) -> None:
        self.proc = subprocess.Popen(
            cmd or ["codex", "app-server"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=sys.stderr,
            text=True,
            bufsize=1,
        )
        self._ids = count(1)

    def __enter__(self) -> "CodexAppServer":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # -- low level -----------------------------------------------------------

    def _send(self, payload: dict[str, Any]) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps(payload) + "\n")
        self.proc.stdin.flush()

    def _messages(self) -> Iterator[dict[str, Any]]:
        """Yield every JSON-RPC message the server emits, until EOF."""
        assert self.proc.stdout is not None
        for line in self.proc.stdout:
            line = line.strip()
            if line:
                yield json.loads(line)

    # -- protocol ------------------------------------------------------------

    def request(self, method: str, params: dict[str, Any] | None = None) -> Any:
        """Send a request and block until its matching response arrives.

        Server-initiated notifications received in the interim are discarded.
        Use `stream_until` if you need to observe them.
        """
        rid = next(self._ids)
        self._send({"method": method, "id": rid, "params": params or {}})
        for msg in self._messages():
            if msg.get("id") == rid:
                if "error" in msg:
                    raise RuntimeError(f"{method} failed: {msg['error']}")
                return msg.get("result")
        raise RuntimeError(f"server closed before responding to {method!r}")

    def notify(self, method: str, params: dict[str, Any] | None = None) -> None:
        """Send a one-way notification (no `id`, no response expected)."""
        self._send({"method": method, "params": params or {}})

    def stream_until(self, *terminal_methods: str) -> Iterator[dict[str, Any]]:
        """Yield server-sent notifications until one of `terminal_methods` arrives.

        Terminal message is yielded *and then* iteration stops.
        Plain responses (those with `id`) are skipped.
        """
        for msg in self._messages():
            if "method" not in msg:
                continue
            yield msg
            if msg["method"] in terminal_methods:
                return

    def handshake(self, client_name: str = "codex-py-client") -> dict[str, Any]:
        info = self.request(
            "initialize",
            {"clientInfo": {"name": client_name, "title": client_name, "version": "0.1.0"}},
        )
        self.notify("initialized")
        return info

    def close(self) -> None:
        if self.proc.stdin and not self.proc.stdin.closed:
            self.proc.stdin.close()
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.proc.kill()


# ---------------------------------------------------------------------------
# Subcommands
# ---------------------------------------------------------------------------


def _fmt_ts(ts: Any) -> str:
    if isinstance(ts, (int, float)):
        return datetime.fromtimestamp(ts).isoformat(timespec="seconds")
    return str(ts or "")


def cmd_list(args: argparse.Namespace) -> int:
    """Page through stored Codex threads via `thread/list`.

    Notes on the API: response items live under `result.data` (not `items`),
    pagination is via `nextCursor`, and passing `archived: false` filters out
    older threads that have no `archived` field at all — so we omit it.
    """
    with CodexAppServer() as s:
        s.handshake()
        cursor: str | None = None
        threads: list[dict[str, Any]] = []
        while True:
            params: dict[str, Any] = {"limit": args.limit}
            if cursor:
                params["cursor"] = cursor
            result = s.request("thread/list", params)
            threads.extend(result.get("data") or [])
            cursor = result.get("nextCursor")
            if not cursor or (args.max and len(threads) >= args.max):
                break
        if args.max:
            threads = threads[: args.max]

    if args.json:
        print(json.dumps(threads, indent=2))
    else:
        for t in threads:
            print(
                f"{t.get('id','?')}  {_fmt_ts(t.get('updatedAt'))}  "
                f"[{t.get('source','?')}]  {t.get('cwd','')}"
            )
            print(f"    {t.get('name') or '(untitled)'}")
        print(f"\n{len(threads)} threads", file=sys.stderr)
    return 0


def cmd_read(args: argparse.Namespace) -> int:
    """Fetch a thread's metadata without resuming it (`thread/read`)."""
    with CodexAppServer() as s:
        s.handshake()
        result = s.request("thread/read", {"threadId": args.thread_id})
    print(json.dumps(result, indent=2))
    return 0


def _render_turn(msg: dict[str, Any]) -> None:
    """Print streamed turn output to stdout, diagnostics to stderr."""
    method = msg.get("method", "")
    params = msg.get("params", {})

    if method == "item/agentMessage/delta":
        sys.stdout.write(params.get("delta") or params.get("text") or "")
        sys.stdout.flush()
    elif method == "item/completed":
        item = params.get("item", {})
        itype = item.get("type")
        if itype == "agentMessage":
            sys.stdout.write("\n")
        elif itype == "commandExecution":
            cmd = " ".join(item.get("command", []))
            print(f"[exec] {cmd} (exit={item.get('exitCode')})", file=sys.stderr)
        elif itype == "fileChange":
            paths = [c.get("path") for c in item.get("changes", [])]
            print(f"[fileChange] {paths}", file=sys.stderr)
        elif itype and itype != "reasoning":
            print(f"[item:{itype}]", file=sys.stderr)
    elif method.endswith("requestApproval"):
        print(f"[approval requested: {method}] (not handled)", file=sys.stderr)
    elif method == "turn/completed":
        usage = params.get("usage", {})
        print(f"--- turn complete (usage={usage}) ---", file=sys.stderr)
    elif method == "turn/failed":
        print(f"[turn failed] {params}", file=sys.stderr)


def _run_turn(s: CodexAppServer, thread_id: str, prompt: str, model: str | None) -> None:
    params: dict[str, Any] = {
        "threadId": thread_id,
        "input": [{"type": "text", "text": prompt}],
    }
    if model:
        params["model"] = model
    s.request("turn/start", params)
    for msg in s.stream_until("turn/completed", "turn/failed"):
        _render_turn(msg)


def cmd_new(args: argparse.Namespace) -> int:
    """Start a fresh thread and run one turn against it.

    `cwd` is set here at thread creation. Without it, the new thread inherits
    the cwd of this Python process. The thread id is printed to stdout
    (first line) so callers can capture it.
    """
    with CodexAppServer() as s:
        s.handshake()
        start_params: dict[str, Any] = {}
        if args.cwd:
            start_params["cwd"] = args.cwd
        if args.model:
            start_params["model"] = args.model
        result = s.request("thread/start", start_params)
        thread_id = result["thread"]["id"]
        print(thread_id)
        sys.stdout.flush()
        print(f"[new thread {thread_id} cwd={result['thread'].get('cwd')}]", file=sys.stderr)
        _run_turn(s, thread_id, args.prompt, args.model)
    return 0


def cmd_resume(args: argparse.Namespace) -> int:
    """Resume an existing thread and run one turn against it.

    The thread keeps its original `cwd` regardless of where this script is
    invoked from — `thread/resume` does not accept a cwd override.
    """
    with CodexAppServer() as s:
        s.handshake()
        result = s.request("thread/resume", {"threadId": args.thread_id})
        cwd = (result.get("thread") or {}).get("cwd")
        print(f"[resumed {args.thread_id} cwd={cwd}]", file=sys.stderr)
        _run_turn(s, args.thread_id, args.prompt, args.model)
    return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="codex_client",
        description="Minimal Python client for `codex app-server`.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    pl = sub.add_parser("list", help="list stored threads")
    pl.add_argument("--limit", type=int, default=50, help="page size (default 50)")
    pl.add_argument("--max", type=int, default=0, help="stop after N threads (0 = all)")
    pl.add_argument("--json", action="store_true", help="emit raw JSON instead of a table")
    pl.set_defaults(func=cmd_list)

    pr = sub.add_parser("read", help="fetch a thread's metadata without resuming")
    pr.add_argument("thread_id")
    pr.set_defaults(func=cmd_read)

    pn = sub.add_parser("new", help="start a new thread and send a prompt")
    pn.add_argument("prompt")
    pn.add_argument("--cwd", help="working directory to bind the thread to")
    pn.add_argument("--model", help="override the model (e.g. gpt-5.4)")
    pn.set_defaults(func=cmd_new)

    pres = sub.add_parser("resume", help="resume a thread and send a prompt")
    pres.add_argument("thread_id")
    pres.add_argument("prompt")
    pres.add_argument("--model", help="override the model for this turn")
    pres.set_defaults(func=cmd_resume)

    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
