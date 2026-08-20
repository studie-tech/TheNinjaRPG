// Shared types for the TNR dev client sidecar.

export type Agent = "CLAUDE" | "CODEX";

export type JobType = "ISSUE_TRIAGE" | "ISSUE_IMPLEMENT" | "PR_REVIEW";

export type RefKind = "ISSUE" | "PULL_REQUEST";

// Snapshot of the GitHub ref captured at job creation time (mirrors the
// server's JobContext).
export interface JobContext {
  title?: string;
  labels?: string[];
  body?: string;
  authorLogin?: string;
  isCrossFork?: boolean;
  [key: string]: unknown;
}

// Mirrors the server's SerializedJob (dates arrive as Date via superjson).
export interface SerializedJob {
  id: number;
  jobType: JobType;
  refKind: RefKind;
  refNumber: number;
  refUrl: string;
  context: JobContext;
  agent: Agent | null;
  claimedAt: Date | null;
  heartbeatAt: Date | null;
  staleThresholdMs: number;
}

export interface CliInfo {
  name: Agent;
  command: string;
  path: string;
  version: string;
}

export interface Settings {
  // Game server base URL, e.g. https://www.theninja-rpg.com
  apiBase: string;
  // Local clone of the target repository the agent works in.
  repoPath: string;
  // 0 = unlimited.
  claudeDailyTokenCap: number;
  codexDailyTokenCap: number;
  autoRun: boolean;
  githubLogin: string | null;
}

export interface RewardSummary {
  money: number;
  exp: number;
  reputation: number;
}

export interface HistoryEntry {
  jobId: number;
  jobType: JobType;
  refUrl: string;
  refNumber: number;
  agent: Agent;
  status: "COMPLETED" | "FAILED";
  verified: boolean | null;
  reward: string | null;
  tokensIn: number;
  tokensOut: number;
  resultUrl: string | null;
  finishedAt: number;
  error?: string;
}

export type RunPhase =
  | "idle"
  | "preparing"
  | "agent"
  | "submitting"
  | "completed"
  | "failed";

export interface RunState {
  job: SerializedJob | null;
  agent: Agent | null;
  phase: RunPhase;
  log: string[];
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
}

export interface StatusResponse {
  sidecar: "ok";
  version: string;
  port: number;
  auth: {
    connected: boolean;
    githubLogin: string | null;
    tokenExpiresAt: number | null;
    tokenExpired: boolean;
  };
  settings: Settings;
  clis: {
    claude: CliInfo | null;
    codex: CliInfo | null;
  };
  budget: {
    today: string;
    byAgent: Record<Agent, { used: number; cap: number; remaining: number }>;
  };
  run: RunState;
}
