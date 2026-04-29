#!/usr/bin/env python3
"""Local Git Diff Viewer launcher.

Serves a single static page plus tiny JSON API over loopback.
Stdlib only.
"""
from __future__ import annotations

import argparse
import json
import os
import signal
import socket
import sys
import threading
import uuid
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

HOST = "127.0.0.1"
DEFAULT_PORT = 3000
PORT_ATTEMPTS = 20

STATIC_DIR = Path(__file__).resolve().parent / "static"
STATIC_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
}

feedback_lock = threading.Lock()


def find_free_port(start: int) -> int:
    for offset in range(PORT_ATTEMPTS):
        port = start + offset
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind((HOST, port))
            except OSError:
                continue
            return port
    raise RuntimeError(f"no free port in [{start}, {start + PORT_ATTEMPTS})")


def safe_join(root: Path, relative: str) -> Path | None:
    relative = unquote(relative).lstrip("/")
    if not relative:
        return None
    candidate = (root / relative).resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError:
        return None
    return candidate


def read_cards(review_dir: Path) -> dict:
    cards = []
    for path in sorted(review_dir.glob("*.md")):
        try:
            raw = path.read_text(encoding="utf-8")
        except OSError:
            continue
        if not raw.startswith("---"):
            continue
        first_line_end = raw.find("\n")
        if first_line_end == -1 or raw[:first_line_end].strip() != "---":
            continue
        try:
            mtime = path.stat().st_mtime
        except OSError:
            mtime = 0.0
        cards.append({"filename": path.name, "raw": raw, "mtime": mtime})

    if (review_dir / "_done").exists():
        state = "done"
    else:
        status_path = review_dir / "_status.json"
        state = "running"
        if status_path.exists():
            try:
                payload = json.loads(status_path.read_text(encoding="utf-8"))
                if payload.get("state") == "failed":
                    state = "failed"
            except (OSError, json.JSONDecodeError):
                pass
    return {"state": state, "cards": cards}


def append_feedback(review_dir: Path, batch: dict) -> None:
    feedback_path = review_dir / "feedback.jsonl"
    with feedback_lock:
        with feedback_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(batch, ensure_ascii=False) + "\n")


def make_handler(review_dir: Path) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = "GitDiffViewer/0.1"

        def log_message(self, format: str, *args) -> None:
            sys.stderr.write("[viewer] %s - %s\n" % (self.address_string(), format % args))

        def _send_json(self, status: int, payload: dict) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _send_file(self, path: Path) -> None:
            try:
                data = path.read_bytes()
            except OSError:
                self.send_error(HTTPStatus.NOT_FOUND, "not found")
                return
            ctype = STATIC_TYPES.get(path.suffix.lower(), "application/octet-stream")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self) -> None:  # noqa: N802
            url = urlsplit(self.path)
            path = url.path

            if path == "/" or path == "/index.html":
                self._send_file(STATIC_DIR / "index.html")
                return

            if path.startswith("/static/"):
                target = safe_join(STATIC_DIR, path[len("/static/"):])
                if target and target.is_file():
                    self._send_file(target)
                    return
                self.send_error(HTTPStatus.NOT_FOUND, "not found")
                return

            if path.startswith("/images/"):
                images_root = review_dir / "images"
                target = safe_join(images_root, path[len("/images/"):])
                if target and target.is_file():
                    self._send_file(target)
                    return
                self.send_error(HTTPStatus.NOT_FOUND, "not found")
                return

            if path == "/api/cards":
                payload = read_cards(review_dir)
                self._send_json(HTTPStatus.OK, payload)
                return

            self.send_error(HTTPStatus.NOT_FOUND, "not found")

        def do_POST(self) -> None:  # noqa: N802
            url = urlsplit(self.path)
            if url.path != "/api/feedback":
                self.send_error(HTTPStatus.NOT_FOUND, "not found")
                return

            length = int(self.headers.get("Content-Length", "0") or 0)
            if length <= 0 or length > 1_000_000:
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "message": "empty or oversized body"})
                return

            try:
                raw = self.rfile.read(length)
                body = json.loads(raw.decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "message": "invalid JSON"})
                return

            comments = body.get("comments") if isinstance(body, dict) else None
            if not isinstance(comments, list) or not comments:
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "message": "comments must be a non-empty list"})
                return

            cleaned = []
            for entry in comments:
                if not isinstance(entry, dict):
                    self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "message": "each comment must be an object"})
                    return
                comment = entry.get("comment")
                review_file = entry.get("review_file")
                if not isinstance(comment, str) or not isinstance(review_file, str):
                    self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "message": "comment and review_file are required strings"})
                    return
                comment = comment.strip()
                review_file = review_file.strip()
                if not comment or not review_file:
                    self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "message": "comment and review_file must be non-empty"})
                    return
                cleaned.append({"comment": comment, "review_file": review_file})

            batch_id = str(uuid.uuid4())
            sent_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            batch = {"batch_id": batch_id, "sent_at": sent_at, "comments": cleaned}
            try:
                append_feedback(review_dir, batch)
            except OSError as exc:
                self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "message": f"write failed: {exc}"})
                return

            self._send_json(HTTPStatus.OK, {"ok": True, "batch_id": batch_id, "received": len(cleaned)})

    return Handler


def main() -> int:
    parser = argparse.ArgumentParser(description="Launch the Git Diff Viewer locally.")
    repo_root = Path(__file__).resolve().parents[3]
    default_review = repo_root / "examples" / "review"
    parser.add_argument("--review-dir", type=Path, default=default_review, help="Path to the review markdown directory.")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", DEFAULT_PORT)), help="Preferred port (will pick next free if busy).")
    args = parser.parse_args()

    review_dir = args.review_dir.resolve()
    if not review_dir.is_dir():
        print(f"review dir not found: {review_dir}", file=sys.stderr)
        return 2

    try:
        port = find_free_port(args.port)
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    handler = make_handler(review_dir)
    server = ThreadingHTTPServer((HOST, port), handler)

    url = f"http://{HOST}:{port}"
    print(f"GIT_DIFF_VIEWER_URL={url}", flush=True)
    print(f"[viewer] serving {review_dir} at {url}", file=sys.stderr)

    stop = threading.Event()

    def shutdown(signum, frame):  # noqa: ARG001
        stop.set()
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    try:
        server.serve_forever()
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
