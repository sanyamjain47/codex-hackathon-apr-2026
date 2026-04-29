import { GitPullRequest, Play, Sparkles } from "lucide-react";

export default function Home() {
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
          This Next.js UI is running locally. The proof of concept is complete
          when Codex launches this app after the user invokes Git Diff Viewer and
          opens it in the Codex browser.
        </p>
      </section>

      <section className="grid" aria-label="Proof of concept checkpoints">
        <article className="panel">
          <Play aria-hidden="true" size={20} />
          <h2>Launch</h2>
          <p>Codex runs the local Next.js dev server on 127.0.0.1:3000.</p>
        </article>

        <article className="panel">
          <Sparkles aria-hidden="true" size={20} />
          <h2>Open</h2>
          <p>Codex opens the local URL in its browser surface.</p>
        </article>
      </section>
    </main>
  );
}
