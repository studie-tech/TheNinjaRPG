import superjson, { type SuperJSONResult } from "superjson";
import type { Agent, SerializedJob } from "./types";

// Minimal tRPC v11 HTTP client (single-call wire format, superjson codec)
// speaking directly to the game server. The sidecar holds the device token,
// so the UI never touches it.
//
// Wire format (single, non-batch):
//   mutation: POST {base}/api/trpc/{router}.{procedure}, body = superjson(input)
//   query:    GET  {base}/api/trpc/{router}.{procedure}?input=<superjson>
//   response: [ { result: { data: <superjson> } } ] | [ { error: {...} } ]

export class TrpcError extends Error {
  readonly code: string | undefined;
  readonly httpStatus: number | undefined;

  constructor(message: string, code?: string, httpStatus?: number) {
    super(message);
    this.name = "TrpcError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

interface TrpcItem {
  result?: { data?: SuperJSONResult };
  error?: {
    message?: string;
    code?: string;
    data?: { code?: string; httpStatus?: number };
  };
}

export interface GameApiOptions {
  getApiBase: () => string;
  getDeviceToken: () => string | null;
  fetchImpl?: typeof fetch;
}

const ROUTER = "devContribution";

export class GameApi {
  private readonly getApiBase: () => string;
  private readonly getDeviceToken: () => string | null;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: GameApiOptions) {
    this.getApiBase = opts.getApiBase;
    this.getDeviceToken = opts.getDeviceToken;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async call<T>(
    kind: "query" | "mutation",
    procedure: string,
    input?: unknown,
  ): Promise<T> {
    const base = this.getApiBase().replace(/\/+$/, "");
    const headers: Record<string, string> = {};
    const token = this.getDeviceToken();
    if (token) headers.authorization = `Bearer ${token}`;

    let res: Response;
    if (kind === "mutation") {
      res = await this.fetchImpl(`${base}/api/trpc/${ROUTER}.${procedure}`, {
        method: "POST",
        headers:
          input === undefined
            ? headers
            : { ...headers, "content-type": "application/json" },
        body: input === undefined ? undefined : superjson.stringify(input),
      });
    } else {
      const query =
        input === undefined
          ? ""
          : `?input=${encodeURIComponent(superjson.stringify(input))}`;
      res = await this.fetchImpl(`${base}/api/trpc/${ROUTER}.${procedure}${query}`, {
        method: "GET",
        headers,
      });
    }

    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      throw new TrpcError(
        `Game server returned a non-JSON response (${res.status})`,
        undefined,
        res.status,
      );
    }

    const item = (Array.isArray(payload) ? payload[0] : payload) as
      | TrpcItem
      | undefined;
    if (!res.ok || !item || "error" in item) {
      const err = item && "error" in item ? item.error : undefined;
      throw new TrpcError(
        err?.message ?? `Game server request failed (${res.status})`,
        err?.data?.code ?? err?.code,
        res.status,
      );
    }

    const data = item.result?.data;
    if (data === undefined) return null as T;
    return superjson.deserialize(data) as T;
  }

  // ── Public (no device token) ──────────────────────────────────────────────

  exchangeConnectCode(input: {
    code: string;
    codeVerifier: string;
  }): Promise<ExchangeConnectCodeOutput> {
    return this.call<ExchangeConnectCodeOutput>(
      "mutation",
      "exchangeConnectCode",
      input,
    );
  }

  // ── Protected (device token) ──────────────────────────────────────────────

  getProfile(): Promise<ProfileOutput> {
    return this.call<ProfileOutput>("query", "getProfile");
  }

  updateProfile(input: {
    claudeDailyTokenCap?: number;
    codexDailyTokenCap?: number;
    autoRun?: boolean;
    githubLogin?: string;
  }): Promise<BaseOutput> {
    return this.call<BaseOutput>("mutation", "updateProfile", input);
  }

  revokeDeviceToken(): Promise<BaseOutput> {
    return this.call<BaseOutput>("mutation", "revokeDeviceToken");
  }

  claimNextJob(agent: Agent): Promise<ClaimNextJobOutput> {
    return this.call<ClaimNextJobOutput>("mutation", "claimNextJob", { agent });
  }

  heartbeat(jobId: number): Promise<BaseOutput> {
    return this.call<BaseOutput>("mutation", "heartbeat", { jobId });
  }

  completeJob(input: {
    jobId: number;
    tokensIn?: number;
    tokensOut?: number;
    resultUrl?: string;
  }): Promise<CompleteJobOutput> {
    return this.call<CompleteJobOutput>("mutation", "completeJob", input);
  }

  failJob(input: { jobId: number; error?: string }): Promise<BaseOutput> {
    return this.call<BaseOutput>("mutation", "failJob", input);
  }

  getMyJobs(limit?: number): Promise<GetMyJobsOutput> {
    return this.call<GetMyJobsOutput>("query", "getMyJobs", {
      limit: limit ?? 50,
    });
  }
}

// ── Output shapes (mirror the server router) ────────────────────────────────

export interface BaseOutput {
  success: boolean;
  message?: string;
}

export interface ExchangeConnectCodeOutput extends BaseOutput {
  deviceToken?: string;
  expiresAt?: number;
}

export interface ProfileOutput extends BaseOutput {
  profile: {
    userId: string;
    githubLogin: string | null;
    claudeDailyTokenCap: number;
    codexDailyTokenCap: number;
    autoRun: boolean;
    totalJobsCompleted: number;
    totalTokensContributed: number;
    lastSeenAt: Date | null;
  };
  today: {
    date: string;
    usageByAgent: Record<string, { tokens: number; jobsCompleted: number }>;
  };
}

export interface ClaimNextJobOutput extends BaseOutput {
  claimed: boolean;
  job?: SerializedJob;
}

export interface CompleteJobOutput extends BaseOutput {
  reward: string | null;
  verified: boolean;
}

export interface GetMyJobsOutput extends BaseOutput {
  jobs: SerializedJob[];
}
