import { useCallback, useEffect, useState } from "react";
import { type HistoryEntry, openExternal, sidecar } from "../api";

export function HistoryView() {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await sidecar.history();
      setEntries(result.history);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load history");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="content">
      <div className="card">
        <div className="row" style={{ display: "flex", alignItems: "center" }}>
          <h2>Recent jobs</h2>
          <span className="spacer" />
          <button type="button" className="secondary" onClick={() => void load()}>
            Refresh
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {entries !== null && entries.length === 0 && (
          <p className="muted">No jobs finished yet.</p>
        )}
        {entries !== null && entries.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Agent</th>
                <th>Status</th>
                <th>Tokens (in/out)</th>
                <th>Reward</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={`${entry.jobId}-${entry.finishedAt}`}>
                  <td>
                    <button
                      type="button"
                      className="linklike"
                      onClick={() => void openExternal(entry.refUrl)}
                    >
                      {entry.jobType} #{entry.refNumber}
                    </button>
                    {entry.resultUrl && entry.resultUrl !== entry.refUrl && (
                      <div>
                        <button
                          type="button"
                          className="linklike small"
                          onClick={() => void openExternal(entry.resultUrl as string)}
                        >
                          result
                        </button>
                      </div>
                    )}
                  </td>
                  <td>{entry.agent}</td>
                  <td>
                    {entry.status === "COMPLETED" ? (
                      entry.verified ? (
                        <span className="good">verified</span>
                      ) : (
                        <span className="warn">unverified</span>
                      )
                    ) : (
                      <span className="error" title={entry.error ?? undefined}>
                        failed
                      </span>
                    )}
                  </td>
                  <td>
                    {entry.tokensIn.toLocaleString()} /{" "}
                    {entry.tokensOut.toLocaleString()}
                  </td>
                  <td>{entry.reward ?? "—"}</td>
                  <td>{new Date(entry.finishedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
