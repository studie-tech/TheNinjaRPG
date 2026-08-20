import { useCallback, useEffect, useRef, useState } from "react";
import {
  SidecarError,
  type StatusResponse,
  sidecar,
  sidecarInfo,
  startSidecar,
} from "./api";
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
  const bootstrapped = useRef(false);
  const refreshing = useRef(false);

  const refresh = useCallback(async () => {
    try {
      // Adopt the shell's port/token before the first call so an overridden
      // TNR_DEV_CLIENT_PORT is honoured instead of the built-in default.
      if (!bootstrapped.current) {
        bootstrapped.current = true;
        await sidecarInfo();
      }
      const next = await sidecar.status();
      setStatus(next);
      setSidecarError(null);
      return;
    } catch (first) {
      // A 401/403 means something IS answering on this port but is not our
      // sidecar — most likely one orphaned by an earlier crash, or a second
      // instance. Restarting ours cannot fix that, and retrying every tick
      // would spawn a doomed process forever, so say what is wrong instead.
      if (
        first instanceof SidecarError &&
        (first.status === 401 || first.status === 403)
      ) {
        setSidecarError(
          "Another process is already using the dev client's port. Quit the other " +
            "copy (or any leftover tnr-dev-client process) and reopen this app.",
        );
        setStatus(null);
        return;
      }
      // Otherwise the sidecar may simply not be up yet (first launch in the
      // Tauri shell): ask the shell to start it, then retry once.
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
    // Guard against overlapping ticks: a slow /status would otherwise stack up
    // and, on the failure path, re-invoke start_sidecar on every tick.
    const tick = async () => {
      if (refreshing.current) return;
      refreshing.current = true;
      try {
        await refresh();
      } finally {
        refreshing.current = false;
      }
    };
    void tick();
    const interval = setInterval(() => void tick(), 3000);
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
