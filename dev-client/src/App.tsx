import { useCallback, useEffect, useState } from "react";
import { type StatusResponse, sidecar, startSidecar } from "./api";
import { DashboardView } from "./views/Dashboard";
import { HistoryView } from "./views/History";
import { SettingsView } from "./views/Settings";
import { SetupView } from "./views/Setup";
import { SignInView } from "./views/SignIn";

type Tab = "dashboard" | "history" | "settings";

export function App() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [sidecarError, setSidecarError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("dashboard");

  const refresh = useCallback(async () => {
    try {
      const next = await sidecar.status();
      setStatus(next);
      setSidecarError(null);
      return;
    } catch {
      // The sidecar may simply not be up yet (first launch in the Tauri
      // shell): ask the shell to start it, then retry once.
      const info = await startSidecar();
      if (info?.running) {
        await new Promise((resolve) => setTimeout(resolve, 750));
        try {
          const next = await sidecar.status();
          setStatus(next);
          setSidecarError(null);
          return;
        } catch {
          // fall through to the error state
        }
      }
      setSidecarError("Sidecar is not running yet. Retry in a moment.");
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 3000);
    return () => clearInterval(interval);
  }, [refresh]);

  if (sidecarError || !status) {
    return (
      <div className="card center">
        <h1>TNR Dev Client</h1>
        <p className="muted">{sidecarError ?? "Connecting to the local sidecar…"}</p>
        <button type="button" onClick={() => void refresh()}>
          Retry
        </button>
      </div>
    );
  }

  const authenticated = status.auth.connected && !status.auth.tokenExpired;
  const needsSetup = authenticated && !status.settings.repoPath;

  return (
    <div className="shell">
      {needsSetup ? (
        <SetupView status={status} onDone={() => void refresh()} />
      ) : (
        <>
          <nav className="tabs">
            {(
              [
                ["dashboard", "Dashboard"],
                ["history", "History"],
                ["settings", "Settings"],
              ] as [Tab, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={tab === id ? "tab active" : "tab"}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
            <span className="spacer" />
            <span className="muted small">
              {status.auth.githubLogin ? `@${status.auth.githubLogin}` : "game account"}
            </span>
          </nav>
          {tab === "dashboard" && (
            <DashboardView status={status} onRefresh={() => void refresh()} />
          )}
          {tab === "history" && <HistoryView />}
          {tab === "settings" && (
            <SettingsView status={status} onRefresh={() => void refresh()} />
          )}
        </>
      )}
      {!authenticated && (
        <div className="overlay">
          <SignInView />
        </div>
      )}
    </div>
  );
}
