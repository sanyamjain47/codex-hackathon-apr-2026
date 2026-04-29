#!/usr/bin/env node
import { spawn } from "node:child_process";
import net from "node:net";

const HOST = "127.0.0.1";
const DEFAULT_PORT = Number.parseInt(process.env.PORT ?? "3020", 10);
const MAX_PORT_ATTEMPTS = Number.parseInt(
  process.env.GIT_DIFF_VIEWER_PORT_ATTEMPTS ?? "20",
  10
);
const HEALTH_MARKER = "data-git-diff-viewer-app";

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

    if (await isGitDiffViewerRunning(port)) {
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

async function isGitDiffViewerRunning(port) {
  try {
    const response = await fetch(`http://${HOST}:${port}`, {
      signal: AbortSignal.timeout(1000)
    });

    if (!response.ok) {
      return false;
    }

    const body = await response.text();

    return body.includes(HEALTH_MARKER);
  } catch {
    return false;
  }
}

const { port, reuse } = await findAvailablePort(DEFAULT_PORT);
const url = `http://${HOST}:${port}`;

if (reuse) {
  console.log(`Git Diff Viewer is already running at ${url}`);
  console.log(`GIT_DIFF_VIEWER_URL=${url}`);
  process.exit(0);
}

console.log(`Starting Git Diff Viewer at ${url}`);
console.log(`GIT_DIFF_VIEWER_URL=${url}`);

const child = spawn(
  "npm",
  [
    "run",
    "dev",
    "--workspace",
    "@git-diff-viewer/app",
    "--",
    "--port",
    String(port)
  ],
  {
    cwd: new URL("../../../", import.meta.url),
    stdio: "inherit"
  }
);

function stopChild(signal) {
  if (!child.killed) {
    child.kill(signal);
  }
}

process.on("SIGINT", () => stopChild("SIGINT"));
process.on("SIGTERM", () => stopChild("SIGTERM"));

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
