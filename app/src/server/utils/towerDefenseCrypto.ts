/**
 * Signed tower-defense run tokens.
 *
 * `startRun` signs the run's seed, start wave, best wave and Guard Hall levels for one user.
 * The browser plays the run locally and returns the token with its action log when
 * claiming; the server verifies the signature and replays the log, so neither the
 * configuration nor the result can be forged.
 */

import { createHmac } from "node:crypto";
import { env } from "@/env/server.mjs";
import { constantTimeEquals } from "@/server/utils/constantTime";
import {
  type TowerDefenseRunToken,
  towerDefenseRunTokenSchema,
} from "@/validators/towerDefense";

/** HMAC key for run tokens; required in production. */
const getSecretKey = (): string => {
  if (env.TOWER_DEFENSE_HMAC_SECRET) return env.TOWER_DEFENSE_HMAC_SECRET;
  if (env.NODE_ENV === "production") {
    throw new Error("TOWER_DEFENSE_HMAC_SECRET must be configured in production");
  }
  return "development-tower-defense-secret";
};

const signature = (body: string) =>
  createHmac("sha256", getSecretKey()).update(body).digest("base64url");

/** `<base64url payload>.<base64url HMAC>` */
export const signRunToken = (payload: TowerDefenseRunToken) => {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${signature(body)}`;
};

/** The signed payload, or null when the token was altered or is malformed. */
export const verifyRunToken = (token: string): TowerDefenseRunToken | null => {
  const [body, mac, extra] = token.split(".");
  if (!body || !mac || extra !== undefined) return null;
  if (!constantTimeEquals(signature(body), mac)) return null;
  try {
    const parsed = towerDefenseRunTokenSchema.safeParse(
      JSON.parse(Buffer.from(body, "base64url").toString("utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};
