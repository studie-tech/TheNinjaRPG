import { useState } from "react";
import { type StatusResponse, sidecar } from "../api";

export function SettingsView({
  status,
  onRefresh,
}: {
  status: StatusResponse;
  onRefresh: () => void;
}) {
  const [apiBase, setApiBase] = useState(status.settings.apiBase);
  const [claudeCap, setClaudeCap] = useState(
    String(status.settings.claudeDailyTokenCap),
  );
  const [codexCap, setCodexCap] = useState(String(status.settings.codexDailyTokenCap));
  const [autoRun, setAutoRun] = useState(status.settings.autoRun);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await sidecar.saveSettings({
        apiBase: apiBase.trim(),
        claudeDailyTokenCap: Math.max(0, Number(claudeCap) || 0),
        codexDailyTokenCap: Math.max(0, Number(codexCap) || 0),
        autoRun,
      });
      setMessage("Settings saved");
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save settings");
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await sidecar.signout();
      setMessage(
        result.revoked
          ? "Signed out and device token revoked"
          : "Signed out (server revocation skipped)",
      );
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign out failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="content">
      <div className="card">
        <h2>Settings</h2>

        <label htmlFor="apibase">Game server</label>
        <input
          id="apibase"
          value={apiBase}
          onChange={(e) => setApiBase(e.target.value)}
        />

        <div className="label">GitHub account</div>
        <p className="muted small">
          {status.auth.githubLogin
            ? `Verified as @${status.auth.githubLogin}.`
            : "Not linked yet."}{" "}
          Rewards are paid against this account, so it can only be set by proving
          ownership: run <code>devContribution.requestGithubVerification</code> from the
          website, publish the code it gives you in a public gist, then confirm it. The
          desktop client cannot set it directly.
        </p>

        <div className="grid-2">
          <div>
            <label htmlFor="claudacap">Claude daily token cap (0 = unlimited)</label>
            <input
              id="claudacap"
              type="number"
              min={0}
              value={claudeCap}
              onChange={(e) => setClaudeCap(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="codexcap">Codex daily token cap (0 = unlimited)</label>
            <input
              id="codexcap"
              type="number"
              min={0}
              value={codexCap}
              onChange={(e) => setCodexCap(e.target.value)}
            />
          </div>
        </div>

        <div className="field-row">
          <input
            id="autorun"
            type="checkbox"
            checked={autoRun}
            onChange={(e) => setAutoRun(e.target.checked)}
          />
          <label htmlFor="autorun" style={{ margin: 0 }}>
            Automatically claim the next job after a finished one
          </label>
        </div>

        {error && <p className="error">{error}</p>}
        {message && <p className="good">{message}</p>}

        <div className="row" style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <button type="button" onClick={() => void save()} disabled={busy}>
            Save
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => void signOut()}
            disabled={busy}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
