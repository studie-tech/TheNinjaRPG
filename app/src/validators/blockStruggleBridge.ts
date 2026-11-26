import { Schema } from "effect";

export const BlockStruggleBridgeConfig = Schema.Struct({
  apiOrigin: Schema.String,
  siteOrigin: Schema.String,
  cookieKey: Schema.String,
  trustedVercelSource: Schema.optional(Schema.Literal("true", "false")),
});

export const BlockStrugglePlayerId = Schema.String.pipe(
  Schema.pattern(/^[A-Za-z0-9_-]{1,128}$/),
  Schema.filter((id) => !Object.hasOwn(Object.prototype, id)),
);

export const BlockStruggleSession = Schema.Struct({
  token: Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{43}$/)),
  playerId: BlockStrugglePlayerId,
  expiresAt: Schema.String,
});

export const BlockStruggleBridgeCookie = Schema.Struct({
  version: Schema.Literal(2),
  playerId: BlockStrugglePlayerId,
  token: BlockStruggleSession.fields.token,
  userId: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(256)),
  sessionId: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(256)),
  expiresAt: Schema.Number.pipe(Schema.int(), Schema.positive()),
});
