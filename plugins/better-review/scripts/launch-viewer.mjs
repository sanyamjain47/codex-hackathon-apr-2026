#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOST = "127.0.0.1";
const DEFAULT_PORT = Number.parseInt(process.env.PORT ?? "3020", 10);
const MAX_PORT_ATTEMPTS = Number.parseInt(
  process.env.BETTER_REVIEW_PORT_ATTEMPTS ?? "20",
  10
);
const PLUGIN_ROOT = fileURLToPath(new URL("../", import.meta.url));
const REPO_ROOT = path.resolve(PLUGIN_ROOT, "../..");
const TARGET_ROOT = path.resolve(process.env.BETTER_REVIEW_TARGET ?? REPO_ROOT);
const TEMPLATE_INDEX = path.join(REPO_ROOT, "examples", "BetterReview-Template.html");
const REVIEW_ROOT = path.join(TARGET_ROOT, ".better-review", "current");
const REVIEW_HTML = path.join(REVIEW_ROOT, "review.html");

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });

    server.listen(port, HOST);
  });
}

async function findAvailablePort(startPort) {
  for (let offset = 0; offset < MAX_PORT_ATTEMPTS; offset += 1) {
    const port = startPort + offset;

    if (await isBetterReviewRunning(port)) {
      return { port, reuse: true };
    }
  }

  for (let offset = 0; offset < MAX_PORT_ATTEMPTS; offset += 1) {
    const port = startPort + offset;

    if (await isPortAvailable(port)) {
      return { port, reuse: false };
    }
  }

  throw new Error(
    `No available local port found from ${startPort} to ${
      startPort + MAX_PORT_ATTEMPTS - 1
    }.`
  );
}

async function isBetterReviewRunning(port) {
  try {
    const response = await fetch(`http://${HOST}:${port}/api/health`, {
      signal: AbortSignal.timeout(1000)
    });

    if (!response.ok) {
      return false;
    }

    const body = await response.json();

    return body?.app === "better-review";
  } catch {
    return false;
  }
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function reviewHtmlExists() {
  try {
    await readFile(REVIEW_HTML, "utf8");
    return true;
  } catch {
    return false;
  }
}

async function buildReviewStatus() {
  const manifest = await readJsonIfPresent(path.join(REVIEW_ROOT, "manifest.json"));
  const hasReview = await reviewHtmlExists();

  return {
    ok: true,
    status: manifest?.status ?? "waiting",
    message: manifest
      ? "Review session found."
      : "No BetterReview session has started yet.",
    targetRoot: TARGET_ROOT,
    reviewRoot: REVIEW_ROOT,
    reviewHtml: REVIEW_HTML,
    hasReview,
    manifest
  };
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload, null, 2));
}

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url ?? "/", `http://${HOST}`);

  if (request.method === "GET" && requestUrl.pathname === "/api/health") {
    sendJson(response, 200, { ok: true, app: "better-review" });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/review-status") {
    sendJson(response, 200, await buildReviewStatus());
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/") {
    // Prefer the agent's generated review.html when present; otherwise fall
    // back to the editable template (which includes a sample PR_DATA so the
    // user sees a real UI even before any review has run).
    const sourcePath = (await reviewHtmlExists()) ? REVIEW_HTML : TEMPLATE_INDEX;
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    });
    response.end(await readFile(sourcePath, "utf8"));
    return;
  }

  sendJson(response, 404, {
    ok: false,
    message: "Not found."
  });
}

const { port, reuse } = await findAvailablePort(DEFAULT_PORT);
const url = `http://${HOST}:${port}`;

if (reuse) {
  console.log(`BetterReview is already running at ${url}`);
  console.log(`BETTER_REVIEW_URL=${url}`);
  process.exit(0);
}

console.log(`Starting BetterReview at ${url}`);
console.log(`BETTER_REVIEW_URL=${url}`);

const server = createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    sendJson(response, 500, {
      ok: false,
      message: error instanceof Error ? error.message : "Unexpected server error."
    });
  });
});

server.listen(port, HOST, () => {
  console.log(`BetterReview static viewer ready at ${url}`);
});
