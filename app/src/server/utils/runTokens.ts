/**
 * Signed minigame run tokens.
 *
 * A minigame's `startRun` signs the run's seed and configuration for one user. The
 * browser plays the run locally and returns the token with its action log when claiming;
 * the server verifies the signature and replays the log, so neither the configuration nor
 * the result can be forged. Each game's token schema names its own payload, so a token
 * signed for one game never parses as another's.
 */

import { createHmac } from "node:crypto";
import type { z } from "zod";
import { env } from "@/env/server.mjs";
import { constantTimeEquals } from "@/server/utils/constantTime";

/**
 * HMAC key for run tokens; required in production. Tower defense introduced it, so it
 * keeps that name for every minigame.
 */
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
export const signRunToken = (payload: object) => {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${signature(body)}`;
};

/** The signed payload, or null when the token was altered, malformed or another game's. */
export const verifyRunToken = <T>(token: string, schema: z.ZodType<T>): T | null => {
  const [body, mac, extra] = token.split(".");
  if (!body || !mac || extra !== undefined) return null;
  if (!constantTimeEquals(signature(body), mac)) return null;
  try {
    const parsed = schema.safeParse(
      JSON.parse(Buffer.from(body, "base64url").toString("utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};
