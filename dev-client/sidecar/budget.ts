import { readFileSync, writeFileSync } from "node:fs";
import { usagePath } from "./state";
import type { Agent } from "./types";

// Local daily token ledger, mirroring the server's per-agent daily usage.
// Shape: { "<utc-date>": { CLAUDE: n, CODEX: n } }. The local ledger is the
// fast pre-flight check; the server remains the source of truth.
type UsageLedger = Record<string, Record<Agent, number>>;

const LEDGER_KEEP_DAYS = 14;

export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function loadLedger(): UsageLedger {
  try {
    const raw = readFileSync(usagePath(), "utf8");
    return JSON.parse(raw) as UsageLedger;
  } catch {
    return {};
  }
}

export function saveLedger(ledger: UsageLedger): void {
  const keys = Object.keys(ledger).sort();
  while (keys.length > LEDGER_KEEP_DAYS) {
    const oldest = keys.shift();
    if (oldest === undefined) break;
    delete ledger[oldest];
  }
  writeFileSync(usagePath(), JSON.stringify(ledger, null, 2), "utf8");
}

export function tokensUsedToday(agent: Agent, now: Date = new Date()): number {
  return loadLedger()[todayUtc(now)]?.[agent] ?? 0;
}

// Same semantics as the server: cap 0 = unlimited.
export function isTokenCapExceeded(tokensUsed: number, cap: number): boolean {
  return cap > 0 && tokensUsed >= cap;
}

export function recordUsage(
  agent: Agent,
  tokens: number,
  now: Date = new Date(),
): void {
  if (tokens <= 0) return;
  const ledger = loadLedger();
  const day = todayUtc(now);
  const current = ledger[day] ?? { CLAUDE: 0, CODEX: 0 };
  current[agent] = (current[agent] ?? 0) + tokens;
  ledger[day] = current;
  saveLedger(ledger);
}
