/**
 * Tower Defense run claims.
 *
 * A claim is only as trustworthy as the result it pays out, so the result is never taken
 * from the claimant: the server reads the session's completed_run row from SpacetimeDB,
 * which the module's own game loop writes. The HMAC session signature then proves the
 * row's starting parameters and user were issued by `initiateSecureSession`, and the
 * TowerDefenseClaimReceipt unique key makes each signed session claimable once.
 */

import { env } from "@/env/server.mjs";
import {
  getSpacetimeDBConfig,
  getSpacetimeDBHttpOrigin,
} from "@/libs/spacetimedb/config";
import {
  type SpacetimeCompletedRun,
  spacetimeCompletedRunSchema,
  spacetimeSqlResultSchema,
} from "@/validators/towerDefense";

export const TOWER_DEFENSE_CLAIMS_PAUSED_MESSAGE =
  "Tower defense rewards are temporarily paused.";

/**
 * Claims stay off unless `TOWER_DEFENSE_CLAIMS_ENABLED` is exactly "true". The switch is
 * checked inside the procedure, so it covers every caller: the browser, the MCP adapter and
 * any other server-side caller.
 */
export const areTowerDefenseClaimsEnabled = (): boolean =>
  env.TOWER_DEFENSE_CLAIMS_ENABLED === "true";

/**
 * The receipt key for a claim. The nonce is server-generated and covered by the session
 * signature, so one `initiateSecureSession` call can pay out at most once, however many
 * SpacetimeDB sessions are created from it.
 */
export const towerDefenseClaimKey = (nonce: string): string => `nonce:${nonce}`;

/** Turns a SpacetimeDB SQL response into rows keyed by column name. */
export const parseSpacetimeSqlRows = (body: unknown): Record<string, unknown>[] => {
  const [result] = spacetimeSqlResultSchema.parse(body);
  if (!result) return [];
  const columns = result.schema.elements.map((element) => element.name?.some ?? "");
  return result.rows.map((row) =>
    Object.fromEntries(columns.map((column, index) => [column, row[index]])),
  );
};

let cachedToken: string | undefined;

/**
 * Reads a session's completed_run row from SpacetimeDB. Returns null when the session has
 * no completed run (still playing, already cleaned up, or never existed).
 */
export const fetchSpacetimeCompletedRun = async (
  sessionId: string,
): Promise<SpacetimeCompletedRun | null> => {
  if (!/^\d{1,20}$/.test(sessionId)) return null;
  const config = getSpacetimeDBConfig();
  const origin = getSpacetimeDBHttpOrigin(config.host);
  const url = `${origin}/v1/database/${encodeURIComponent(config.moduleName)}/sql`;
  const query = `SELECT * FROM completed_run WHERE session_id = ${sessionId}`;

  const send = (token: string | undefined) =>
    fetch(url, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: query,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });

  let response = await send(cachedToken);
  if (response.status === 401 || response.status === 403) {
    // completed_run is public; any identity may read it. Mint one when anonymous reads
    // are refused, and reuse it for later claims.
    cachedToken = await mintSpacetimeToken(origin);
    response = await send(cachedToken);
  }
  if (!response.ok) {
    throw new Error(`SpacetimeDB SQL request failed with status ${response.status}`);
  }

  const rows = parseSpacetimeSqlRows(await response.json());
  const row = rows.find((candidate) => String(candidate.session_id) === sessionId);
  return row ? spacetimeCompletedRunSchema.parse(row) : null;
};

const mintSpacetimeToken = async (origin: string): Promise<string> => {
  const response = await fetch(`${origin}/v1/identity`, {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(
      `SpacetimeDB identity request failed with status ${response.status}`,
    );
  }
  const body = (await response.json()) as { token?: unknown };
  if (typeof body.token !== "string") {
    throw new Error("SpacetimeDB identity response had no token");
  }
  return body.token;
};
