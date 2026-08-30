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
  const [ghLogin, setGhLogin] = useState("");
  const [ghNonce, setGhNonce] = useState<string | null>(null);
  const [ghInstructions, setGhInstructions] = useState("");
  const [gistId, setGistId] = useState("");
  const [ghBusy, setGhBusy] = useState(false);
  const [ghMessage, setGhMessage] = useState<string | null>(null);

  // Step 1: ask the server for a one-time code bound to (game account, login).
  const requestCode = async () => {
    setGhBusy(true);
    setGhMessage(null);
    try {
      const res = await sidecar.requestGithubVerification(ghLogin.trim());
      if (!res.success) {
        setGhMessage(res.message ?? "Could not start verification");
        return;
      }
      setGhNonce(res.nonce ?? null);
      setGhInstructions(res.instructions ?? "");
    } catch (e) {
      setGhMessage(e instanceof Error ? e.message : "Could not start verification");
    } finally {
      setGhBusy(false);
    }
  };

  // Step 2: the server re-reads the gist and checks owner + code itself.
  const confirmCode = async () => {
    setGhBusy(true);
    setGhMessage(null);
    try {
      const res = await sidecar.confirmGithubVerification(
        ghLogin.trim(),
        gistId.trim(),
      );
      setGhMessage(res.message ?? (res.success ? "Verified" : "Could not verify"));
      if (res.success) {
        setGhNonce(null);
        setGistId("");
        onRefresh();
      }
    } catch (e) {
      setGhMessage(e instanceof Error ? e.message : "Could not verify");
    } finally {
      setGhBusy(false);
    }
  };

  const unlinkGithub = async () => {
    setGhBusy(true);
    setGhMessage(null);
    try {
      const res = await sidecar.unlinkGithubAccount();
      setGhMessage(res.message ?? null);
      if (res.success) onRefresh();
    } catch (e) {
      setGhMessage(e instanceof Error ? e.message : "Could not unlink");
    } finally {
      setGhBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const wanted = apiBase.trim();
      const saved = await sidecar.saveSettings({
        apiBase: wanted,
        claudeDailyTokenCap: Math.max(0, Number(claudeCap) || 0),
        codexDailyTokenCap: Math.max(0, Number(codexCap) || 0),
        autoRun,
      });
      // The sidecar silently ignores a game-server host it does not allow, so
      // reflect what was actually stored instead of reporting a clean save.
      if (saved.apiBase !== wanted) {
        setApiBase(saved.apiBase);
        setError(
          `"${wanted}" is not an allowed game server, so it was not saved. Other settings were.`,
        );
      } else {
        setMessage("Settings saved");
      }
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
        {status.auth.githubLogin ? (
          <>
            <p className="muted small">
              Verified as @{status.auth.githubLogin}. Rewards are paid against this
              account.
            </p>
            <button type="button" onClick={() => void unlinkGithub()} disabled={ghBusy}>
              Unlink GitHub account
            </button>
          </>
        ) : (
          <>
            <p className="muted small">
              Not linked yet. Rewards are paid against this account, so it can only be
              set by proving you own it: publish a one-time code in a public gist, then
              confirm it here.
            </p>
            <label htmlFor="ghlogin">Your GitHub login</label>
            <input
              id="ghlogin"
              value={ghLogin}
              placeholder="octocat"
              onChange={(e) => setGhLogin(e.target.value)}
            />
            {!ghNonce ? (
              <button
                type="button"
                onClick={() => void requestCode()}
                disabled={ghBusy || !ghLogin.trim()}
              >
                Get verification code
              </button>
            ) : (
              <>
                <p className="muted small">
                  Publish this code in a public gist, then paste the gist id below.
                </p>
                <pre className="code-block">{ghInstructions}</pre>
                <label htmlFor="gistid">Gist id</label>
                <input
                  id="gistid"
                  value={gistId}
                  placeholder="a1b2c3d4..."
                  onChange={(e) => setGistId(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => void confirmCode()}
                  disabled={ghBusy || !gistId.trim()}
                >
                  Confirm ownership
                </button>
              </>
            )}
          </>
        )}
        {ghMessage && <p className="muted small">{ghMessage}</p>}

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
