import { env } from "@/env/server.mjs";
import { isNativeUserAgent } from "@/libs/native/userAgent";
import {
  captureMetaTracking,
  captureMetaTutorialCompletion,
  recordMetaConsent,
} from "@/queries/metaTracking";
import type { DrizzleClient } from "@/server/db";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import type { MetaTrackingInput } from "@/validators/metaTracking";

/** Keep capture and outbound delivery off until the consent rollout and credentials are ready. */
export const isMetaCapiConfigured = () =>
  env.META_CAPI_ENABLED === "true" &&
  Boolean(env.META_CAPI_ACCESS_TOKEN && env.NEXT_PUBLIC_META_PIXEL_ID) &&
  env.NODE_ENV === "production";

/** Reject expired/future consent and native clients before retaining any matching data. */
export const canCaptureMetaTracking = (
  input: MetaTrackingInput,
  userAgent?: string,
  now = Date.now(),
) => {
  const timestamp = Date.parse(input.decidedAt);
  return Boolean(
    userAgent &&
      !isNativeUserAgent(userAgent) &&
      timestamp <= now &&
      timestamp > now - 180 * 86_400_000 &&
      (input.fbc || input.fbp),
  );
};

/** Save an explicit grant before capturing a confirmed character's attribution. */
export const saveMetaTracking = async (
  client: DrizzleClient,
  userId: string,
  input: MetaTrackingInput,
  userAgent?: string,
  registrationAt?: Date,
) => {
  if (!isMetaCapiConfigured() || !canCaptureMetaTracking(input, userAgent)) return;
  await retryOnDeadlock(async () => {
    await recordMetaConsent(client, {
      consentId: input.consentId,
      decidedAt: new Date(input.decidedAt),
      granted: true,
      userId,
    });
    await captureMetaTracking(client, userId, input, userAgent ?? "", registrationAt);
  });
};

/** A native completion must not become a website conversion from an earlier web signup. */
export const saveMetaTutorialCompletion = async (
  client: DrizzleClient,
  userId: string,
  userAgent?: string,
) => {
  if (!isMetaCapiConfigured() || !userAgent || isNativeUserAgent(userAgent)) return;
  await captureMetaTutorialCompletion(client, userId, userAgent);
};
