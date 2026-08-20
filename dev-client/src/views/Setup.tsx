import { useState } from "react";
import { type StatusResponse, sidecar } from "../api";

export function SetupView({
  status,
  onDone,
}: {
  status: StatusResponse;
  onDone: () => void;
}) {
  const [repoPath, setRepoPath] = useState(status.settings.repoPath);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await sidecar.saveSettings({ repoPath: repoPath.trim() });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save settings");
    } finally {
      setSaving(false);
    }
  };

  const cli = (agent: "CLAUDE" | "CODEX") =>
    agent === "CLAUDE" ? status.clis.claude : status.clis.codex;

  return (
    <div className="content">
      <div className="card">
        <h1>Welcome to the TNR Dev Client</h1>
        <p>
          The client runs your local AI coding agents on dev jobs from the game
          repository. Configure where it should work:
        </p>

        <div className="grid-2">
          {(["CLAUDE", "CODEX"] as const).map((agent) => {
            const info = cli(agent);
            return (
              <div className="card" key={agent}>
                <h2>{agent === "CLAUDE" ? "Claude Code" : "OpenAI Codex"}</h2>
                {info ? (
                  <p className="good">
                    Found {info.command} v{info.version}
                  </p>
                ) : (
                  <p className="warn">Not found. Install it to use this agent.</p>
                )}
              </div>
            );
          })}
        </div>

        <label htmlFor="repopath">
          Local clone of the target repository (your fork)
        </label>
        <div className="field-row">
          <input
            id="repopath"
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            placeholder="/path/to/TheNinjaRPG"
          />
        </div>

        <p className="muted small">
          Implementation jobs run in a disposable git worktree of this clone and open a
          pull request against the upstream repository.
        </p>

        {error && <p className="error">{error}</p>}
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !repoPath.trim()}
        >
          {saving ? "Saving…" : "Save and continue"}
        </button>
      </div>
    </div>
  );
}
