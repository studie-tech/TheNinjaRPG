/** Side effects are injected so failure/retry boundaries can be tested without real accounts. */
export const runDeletionStep = async (input: {
  phase: "QUEUED" | "IDENTITY_DELETED" | "COMPLETE";
  removeIdentity: () => Promise<void>;
  removeGameData: () => Promise<void>;
  advance: (phase: "IDENTITY_DELETED" | "COMPLETE", delayMs: number) => Promise<void>;
}) => {
  if (input.phase === "COMPLETE") return;
  if (input.phase === "QUEUED") {
    // Identity deletion revokes sessions and prevents new sessions. Allow outstanding
    // short-lived session tokens and in-flight requests to expire before data cleanup.
    await input.removeIdentity();
    await input.advance("IDENTITY_DELETED", 5 * 60_000);
    return;
  }
  await input.removeGameData();
  await input.advance("COMPLETE", 0);
};
