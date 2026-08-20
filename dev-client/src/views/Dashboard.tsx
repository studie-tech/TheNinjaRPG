import { useState } from "react";
import { type Agent, openExternal, type StatusResponse, sidecar } from "../api";

const PHASE_LABEL: Record<string, string> = {
  idle: "Idle",
  preparing: "Preparing worktree",
  agent: "Agent is working",
  submitting: "Submitting result",
  completed: "Completed",
  failed: "Failed",
};

export function DashboardView({
  status,
  onRefresh,
}: {
  status: StatusResponse;
  onRefresh: () => void;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<Agent | null>(null);

  const run = status.run;
  // Bound once so the click handlers below narrow correctly.
  const activeJob = run.job;
  const busy =
    run.phase === "preparing" || run.phase === "agent" || run.phase === "submitting";

  const claim = async (agent: Agent) => {
    setClaiming(agent);
    setMessage(null);
    try {
      const result = await sidecar.claim(agent);
      if (!result.claimed) setMessage(result.message ?? "No jobs available");
      onRefresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Claim failed");
    } finally {
      setClaiming(null);
    }
  };

  const abort = async () => {
    await sidecar.abort();
    onRefresh();
  };

  return (
    <div className="content">
      <div className="grid-2">
        {(["CLAUDE", "CODEX"] as const).map((agent) => {
          const info = agent === "CLAUDE" ? status.clis.claude : status.clis.codex;
          const budget = status.budget.byAgent[agent];
          const unlimited = budget.cap === 0;
          const pct = unlimited
            ? 0
            : Math.min(100, Math.round((budget.used / budget.cap) * 100));
          return (
            <div className="card agent-card" key={agent}>
              <div className="row">
                <h2>{agent === "CLAUDE" ? "Claude Code" : "OpenAI Codex"}</h2>
                <span className="badge">{PHASE_LABEL[run.phase] ?? run.phase}</span>
                <span className="spacer" />
                {info ? (
                  <span className="badge good">v{info.version}</span>
                ) : (
                  <span className="badge bad">not found</span>
                )}
              </div>
              <div>
                <div className="muted small">
                  {unlimited
                    ? `Used ${budget.used.toLocaleString()} tokens today (unlimited)`
                    : `Used ${budget.used.toLocaleString()} of ${budget.cap.toLocaleString()} tokens today`}
                </div>
                {!unlimited && (
                  <div className="bar" style={{ marginTop: 4 }}>
                    <div style={{ width: `${pct}%` }} />
                  </div>
                )}
              </div>
              <div className="row">
                <button
                  type="button"
                  onClick={() => void claim(agent)}
                  disabled={busy || claiming !== null || !info}
                >
                  {claiming === agent ? "Claiming…" : "Claim next job"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {message && (
        <div className="card">
          <p className="warn">{message}</p>
        </div>
      )}

      {activeJob && (
        <div className="card">
          <h2>
            {activeJob.jobType}{" "}
            <button
              type="button"
              className="linklike"
              onClick={() => void openExternal(activeJob.refUrl)}
            >
              #{activeJob.refNumber}
            </button>
            {activeJob.context.title ? ` — ${activeJob.context.title}` : ""}
          </h2>
          <p className="muted small">
            {PHASE_LABEL[run.phase] ?? run.phase}
            {run.startedAt
              ? ` · started ${new Date(run.startedAt).toLocaleTimeString()}`
              : ""}
          </p>
          <div className="log">{run.log.slice(-40).join("\n")}</div>
          <div className="row" style={{ marginTop: 10 }}>
            {busy && (
              <button type="button" className="danger" onClick={() => void abort()}>
                Stop job
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
