import { useState } from "react";
import { openExternal, sidecar } from "../api";

export function SignInView() {
  const [busy, setBusy] = useState(false);
  const [connectUrl, setConnectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await sidecar.signin();
      setConnectUrl(result.connectUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start sign-in");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card center">
      <h1>TheNinja-RPG Dev Client</h1>
      <p className="muted">
        Sign in with your game account to fetch dev jobs and earn in-game rewards. A
        browser window will open for the sign-in.
      </p>
      <button type="button" onClick={() => void start()} disabled={busy}>
        {busy ? "Opening browser…" : "Sign in with game account"}
      </button>
      {connectUrl && (
        <p>
          <button
            type="button"
            className="linklike"
            onClick={() => void openExternal(connectUrl)}
          >
            Open the sign-in page in your browser
          </button>
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
