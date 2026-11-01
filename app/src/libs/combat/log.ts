import type { SuperJSONResult } from "superjson";

/** Committed public log rows; oversized batches carry only a version/settlement signal. */
export type BattleUpdate = {
  version: number;
  /** Absent for state-only events; null when the delta exceeds the payload limit. */
  logEntries?: SuperJSONResult | null;
  /** A participant settled; other participants may still be fighting. */
  finished?: boolean;
};
