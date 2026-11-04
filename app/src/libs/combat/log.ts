import type { SuperJSONResult } from "superjson";

/** Battle log entries per page when a request names no limit. */
export const BATTLE_LOG_PAGE_SIZE = 30;

/** Committed public combat changes; oversized payloads retain version/settlement recovery. */
export type BattleUpdate = {
  version: number;
  /** Public changes with exact baselines and server-validated viewer eligibility. */
  stateUpdate?: SuperJSONResult;
  /** Absent for state-only events; null when the delta exceeds the payload limit. */
  logEntries?: SuperJSONResult | null;
  /** A participant settled; other participants may still be fighting. */
  finished?: boolean;
};
