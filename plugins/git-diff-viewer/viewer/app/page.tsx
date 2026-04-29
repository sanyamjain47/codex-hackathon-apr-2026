"use client";

import {
  AlertCircle,
  CheckCircle2,
  FolderGit2,
  GitCompare,
  GitPullRequest,
  Loader2,
  Play,
  TerminalSquare
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

type RuntimeInfo = {
  cwd: string;
  defaultDirectory: string;
};

type DiffResponse = {
  ok: boolean;
  message: string;
  directory?: string;
  gitRoot?: string;
  command: string;
  stdout: string;
  stderr: string;
};

export default function Home() {
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [directory, setDirectory] = useState("");
  const [result, setResult] = useState<DiffResponse | null>(null);
  const [runtimeError, setRuntimeError] = useState("");
  const [isLoadingRuntime, setIsLoadingRuntime] = useState(true);
  const [isRunningDiff, setIsRunningDiff] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadRuntime() {
      setIsLoadingRuntime(true);

      try {
        const response = await fetch("/api/runtime", { cache: "no-store" });

        if (!response.ok) {
          throw new Error("Could not load runtime details.");
        }

        const nextRuntime = (await response.json()) as RuntimeInfo;

        if (isMounted) {
          setRuntime(nextRuntime);
          setDirectory(nextRuntime.defaultDirectory);
          setRuntimeError("");
        }
      } catch (error) {
        if (isMounted) {
          setRuntimeError(
            error instanceof Error
              ? error.message
              : "Could not load runtime details."
          );
        }
      } finally {
        if (isMounted) {
          setIsLoadingRuntime(false);
        }
      }
    }

    void loadRuntime();

    return () => {
      isMounted = false;
    };
  }, []);

  const output = useMemo(() => {
    if (!result) {
      return "";
    }

    return [result.stdout, result.stderr].filter(Boolean).join("\n");
  }, [result]);

  async function runDiff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsRunningDiff(true);
    setResult(null);

    try {
      const response = await fetch("/api/git-diff", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ directory })
      });
      const payload = (await response.json()) as DiffResponse;

      setResult(payload);
    } catch (error) {
      setResult({
        ok: false,
        message:
          error instanceof Error ? error.message : "Unable to run git diff.",
        command: "git diff --no-color --no-ext-diff",
        stdout: "",
        stderr: ""
      });
    } finally {
      setIsRunningDiff(false);
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <div className="titleRow">
          <GitPullRequest aria-hidden="true" size={28} />
          <div>
            <p className="eyebrow">Codex App POC</p>
            <h1>Git Diff Viewer</h1>
          </div>
        </div>

        <p className="lede">
          Local sanity checks for the next phase: confirm the app runtime
          directory, choose a git work tree, and run a raw git diff from the
          browser surface.
        </p>
      </section>

      <section className="statusGrid" aria-label="Runtime details">
        <article className="panel">
          <TerminalSquare aria-hidden="true" size={20} />
          <h2>Running from</h2>
          <p className="pathText">
            {isLoadingRuntime ? "Loading runtime directory..." : runtime?.cwd}
          </p>
        </article>

        <article className="panel">
          <FolderGit2 aria-hidden="true" size={20} />
          <h2>Default git root</h2>
          <p className="pathText">
            {isLoadingRuntime
              ? "Resolving git work tree..."
              : runtime?.defaultDirectory}
          </p>
        </article>
      </section>

      <section className="workspace" aria-label="Git diff sanity check">
        <form className="controlPanel" onSubmit={runDiff}>
          <label htmlFor="directory">Git directory</label>
          <div className="inputRow">
            <input
              id="directory"
              value={directory}
              onChange={(event) => setDirectory(event.target.value)}
              placeholder="/absolute/path/to/git/repo"
              spellCheck={false}
            />
            <button
              type="submit"
              disabled={isRunningDiff || directory.trim().length === 0}
            >
              {isRunningDiff ? (
                <Loader2 aria-hidden="true" className="spin" size={18} />
              ) : (
                <Play aria-hidden="true" size={18} />
              )}
              Run check
            </button>
          </div>
          {runtimeError ? (
            <p className="message errorText">{runtimeError}</p>
          ) : (
            <p className="message">
              Enter any absolute path inside a local git work tree.
            </p>
          )}
        </form>

        <article className="resultPanel" aria-live="polite">
          <div className="resultHeader">
            <div>
              <p className="eyebrow">Command</p>
              <h2>{result?.command ?? "git diff --no-color --no-ext-diff"}</h2>
            </div>
            {result ? (
              result.ok ? (
                <CheckCircle2 aria-label="Success" size={22} />
              ) : (
                <AlertCircle aria-label="Error" size={22} />
              )
            ) : (
              <GitCompare aria-hidden="true" size={22} />
            )}
          </div>

          {result?.directory ? (
            <dl className="metaList">
              <div>
                <dt>Directory</dt>
                <dd>{result.directory}</dd>
              </div>
              <div>
                <dt>Git root</dt>
                <dd>{result.gitRoot}</dd>
              </div>
            </dl>
          ) : null}

          <p
            className={
              result?.ok === false ? "resultMessage errorText" : "resultMessage"
            }
          >
            {result?.message ??
              "Run the check to validate the selected directory and inspect the raw diff output."}
          </p>

          <pre className="diffOutput">
            {isRunningDiff
              ? "Running git diff..."
              : output || "No command output yet."}
          </pre>
        </article>
      </section>
    </main>
  );
}
