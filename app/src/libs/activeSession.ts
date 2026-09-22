/**
 * Key for the subtree that is rebuilt when the active Clerk session changes. The first
 * session clerk-js reports is the account whose cookie already rendered the page, so it
 * is not a change; every later session is.
 */
export const activeSessionKey = (state: {
  sessionId: string | null;
  firstSessionId: string | null;
}): string => {
  if (state.sessionId === state.firstSessionId) return "initial";
  return state.sessionId ?? "signed-out";
};
