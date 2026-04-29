import React from "react";
import { createRoot } from "react-dom/client";
import { GitPullRequest } from "lucide-react";
import "./styles.css";

function App() {
  return (
    <main className="shell">
      <header className="header">
        <GitPullRequest aria-hidden="true" size={24} />
        <div>
          <h1>Git Diff Viewer</h1>
          <p>Viewer scaffold ready for diff rendering work.</p>
        </div>
      </header>
      <section className="panel">
        <h2>Next Contribution Areas</h2>
        <ul>
          <li>Session API client</li>
          <li>File tree</li>
          <li>Unified and split diff views</li>
          <li>Inline annotations</li>
        </ul>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
