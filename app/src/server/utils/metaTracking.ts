import { env } from "@/env/server.mjs";
import { isNativeUserAgent } from "@/libs/native/userAgent";
import {
  captureMetaTracking,
  captureMetaTutorialCompletion,
  clearWithdrawnMetaTracking,
  findLatestMetaWithdrawal,
  findLiveMetaTrackingAccount,
  lockMetaTrackingAccount,
  recordMetaConsent,
  withdrawMetaAccountConsent,
} from "@/queries/metaTracking";
import type { DrizzleClient, DrizzleTransaction } from "@/server/db";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import type { MetaTrackingInput } from "@/validators/metaTracking";

/** Keep consent and matching-data writes inside the account-retirement boundary. */
const withLiveMetaAccount = <T>(
  client: DrizzleClient,
  userId: string,
  work: (transaction: DrizzleTransaction) => Promise<T>,
) =>
  retryOnDeadlock(() =>
    // Consent and matching data occupy separate rows. A statement guard alone cannot stop
    // the second write outliving cleanup; retirement waits on this existing account row.
    // No external I/O or absent identity-alias locks are held in this transaction.
    client.transaction(async (transaction) => {
      if (!(await lockMetaTrackingAccount(transaction, userId)).length)
        return undefined;
      if (!(await findLiveMetaTrackingAccount(transaction, userId)).length)
        return undefined;
      return work(transaction);
    }),
  );

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
  if (!isMetaCapiConfigured() || !canCaptureMetaTracking(input, userAgent))
    return false;
  return (
    (await withLiveMetaAccount(client, userId, async (transaction) => {
      const withdrawal = await findLatestMetaWithdrawal(transaction, userId);
      if (
        withdrawal?.withdrawnAt &&
        new Date(input.decidedAt) <= withdrawal.withdrawnAt
      )
        return false;
      await recordMetaConsent(transaction, {
        consentId: input.consentId,
        decidedAt: new Date(input.decidedAt),
        granted: true,
        userId,
      });
      await captureMetaTracking(
        transaction,
        userId,
        input,
        userAgent ?? "",
        registrationAt,
      );
      return true;
    })) ?? false
  );
};

/** Signed-in withdrawal and grants serialize on the same account, including new browser IDs. */
export const withdrawMetaTracking = async (
  client: DrizzleClient,
  input: { consentId: string; decidedAt: Date },
  userId?: string,
) => {
  const withdraw = async (
    database: Pick<DrizzleClient, "insert" | "select" | "update" | "delete" | "query">,
    linkedUserId?: string,
  ) => {
    await recordMetaConsent(database, {
      ...input,
      granted: false,
      userId: linkedUserId,
    });
    if (userId) await withdrawMetaAccountConsent(database, userId, input.decidedAt);
    await clearWithdrawnMetaTracking(database, input.consentId, userId);
    return true;
  };
  if (
    userId &&
    (await withLiveMetaAccount(client, userId, (transaction) =>
      withdraw(transaction, userId),
    ))
  )
    return;
  // A signed-out or retired identity may still revoke its browser decision, without
  // recreating a link to the deleted account.
  await retryOnDeadlock(() => withdraw(client));
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
