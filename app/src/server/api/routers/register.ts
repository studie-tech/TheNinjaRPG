import { z } from "zod";
import { AdClickConsents, IMG_DEFAULT_PROFILE_PICTURE } from "@/drizzle/constants";
import type { userData } from "@/drizzle/schema";
import {
  findLatestUnlinkedAdClickByIp,
  findUnlinkedAdClickByClickId,
  linkAdClickToUser,
} from "@/queries/adConversions";
import { fetchBloodline } from "@/queries/bloodline";
import { findUserEmailReminder } from "@/queries/emailReminder";
import {
  deleteUserAttributes,
  findUserById,
  upsertHistoricalIp,
} from "@/queries/profile";
import { findStoreUserIdAlias } from "@/queries/purchases";
import {
  deleteStoreUserIdAliasForCreateCharacter,
  executeCreatedUserForCreateCharacter,
  findPaypalSubscriptionForCreateCharacter,
  findReferralSourceForSetReferralSource,
  findStorePurchaseForCreateCharacter,
  findStripePaymentForCreateCharacter,
  findUserDataForCreateCharacter2,
  findUserDataForCreateCharacter3,
  findVillageForCreateCharacter,
  findVisitorLogForSetReferralSource,
  insertBloodlineRollsForCreateCharacter,
  insertQuestHistoryForCreateCharacter,
  insertRecruitReferralForCreateCharacter,
  insertReferralSourceForSetReferralSource,
  insertStarterHomeItems,
  insertUserAttributeForCreateCharacter,
  listUserReportForCreateCharacter,
  updateUserDataForCreateCharacter,
} from "@/queries/register";
import { fetchActiveSanctionTombstones } from "@/queries/reports";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import { adClickConsentFor } from "@/server/utils/adConversions";
import { isMysqlDuplicateKeyError, retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { settleRecordedLedger } from "@/server/utils/purchases/grant";
import { isDeletedStoreUserId } from "@/server/utils/purchases/storeIdentity";
import { checkRecruitSignupEligibility, isKnownIp } from "@/server/utils/recruitment";
import {
  carryoverReportId,
  discardUnpublishedSanctions,
  fetchSanctionIdentity,
  matchSanctionTombstones,
  reapplySanctions,
} from "@/server/utils/sanctionTombstone";
import { settleStripePayments } from "@/server/utils/stripe/fulfillment";
import { checkForBadWords } from "@/utils/profanity";
import { secondsFromNow } from "@/utils/time";
import { registrationSchema, utmSourceSchema } from "@/validators/register";

export const registerRouter = createTRPCRouter({
  // Set referral source on sign-in (before character creation)
  setReferralSource: protectedProcedure
    .meta({ mcp: { description: "Set referral source for analytics" } })
    .input(z.object({ utmSource: utmSourceSchema }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // If already set, no-op
      const existing = await findReferralSourceForSetReferralSource(ctx.drizzle, ctx);
      if (existing) {
        return { success: true, message: "Referral source already set" };
      }

      // Determine source: provided utmSource or fallback from visitorLog by IP
      const provided = (input?.utmSource ?? "").trim();
      let source = provided;
      const ip = ctx.userIp ?? "unknown";
      if (!source && ip !== "unknown") {
        const visit = await findVisitorLogForSetReferralSource(ctx.drizzle, ip);
        source = (visit?.utmSource ?? "").trim();
      }

      if (!source) {
        return { success: true, message: "No UTM source found to set" };
      }

      // Ensure we map IP -> user for later analytics joins
      if (ip !== "unknown") await upsertHistoricalIp(ctx.drizzle, ctx.userId, ip);

      await insertReferralSourceForSetReferralSource(ctx.drizzle, ctx, source);
      return { success: true, message: "Referral source set" };
    }),
  // Create Character
  createCharacter: protectedProcedure
    .meta({ mcp: { description: "Create a new character" } })
    // Campaign attribution is recorded separately; open forms may still send this hint.
    .input(
      registrationSchema.safeExtend({
        utm_source: utmSourceSchema,
        // The registrant's own marketing cookie choice decides whether an ad click is
        // linked; clients that do not send it are treated as declined.
        marketingConsent: z.enum([...AdClickConsents, "declined"]).optional(),
        // The click remembered on the device since the visitor landed from an ad.
        adClickId: z.string().max(512).optional(),
      }),
    )
    .output(
      baseServerResponse.extend({
        registrationId: z.string().optional(),
        isAdClickLinked: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const adClickConsent = adClickConsentFor(
        input.marketingConsent ?? "declined",
        ctx.userCountry,
      );
      // Query
      const [
        villageData,
        existingUser,
        usernameTaken,
        reminder,
        selectedBloodline,
        moderationResult,
        storeAlias,
        storeHistory,
        paypalHistory,
        stripeHistory,
        recruitEligibility,
        tombstones,
        carryoverReports,
        storedAdClick,
        ipAdClick,
      ] = await Promise.all([
        findVillageForCreateCharacter(ctx.drizzle),
        findUserById(ctx.drizzle, ctx.userId),
        findUserDataForCreateCharacter2(ctx.drizzle, input),
        findUserEmailReminder(ctx.drizzle, ctx),
        fetchBloodline(ctx.drizzle, input.bloodlineId),
        checkForBadWords(input.username),
        findStoreUserIdAlias(ctx.drizzle, ctx.userId),
        findStorePurchaseForCreateCharacter(ctx.drizzle, ctx),
        findPaypalSubscriptionForCreateCharacter(ctx.drizzle, ctx),
        findStripePaymentForCreateCharacter(ctx.drizzle, ctx),
        input.recruiter_userid
          ? checkRecruitSignupEligibility({
              client: ctx.drizzle,
              recruitUserId: ctx.userId,
              recruiterId: input.recruiter_userid,
              signupIp: ctx.userIp,
            })
          : Promise.resolve(null),
        fetchActiveSanctionTombstones(ctx.drizzle),
        listUserReportForCreateCharacter(ctx.drizzle, ctx),
        adClickConsent && input.adClickId
          ? findUnlinkedAdClickByClickId(ctx.drizzle, input.adClickId)
          : null,
        adClickConsent && isKnownIp(ctx.userIp)
          ? findLatestUnlinkedAdClickByIp(ctx.drizzle, ctx.userIp)
          : null,
      ]);
      // The click stored on the device is the registrant's own; the IP match is a fallback.
      const adClick = storedAdClick ?? ipAdClick;
      // Whatever the ledger holds for this identity is settled once a character row exists,
      // on every path that reaches one. A tombstone seen here means receipts can still be
      // landing under it until it is removed below; payment history means there is
      // a tier or a delivery to derive. A plain first registration has none of these.
      const hasLedger = Boolean(
        storeAlias || storeHistory || paypalHistory || stripeHistory,
      );
      const settleLedger = () =>
        Promise.all([
          settleRecordedLedger(ctx.drizzle, ctx.userId),
          settleStripePayments(ctx.drizzle, ctx.userId),
        ]);

      // Guard
      if (!moderationResult.success) return moderationResult;
      if (existingUser) {
        // A retry after registration failed part-way settles what it did not get to.
        if (hasLedger) await settleLedger();
        return errorResponse("Character already created for this account");
      }
      if (usernameTaken) return errorResponse("Username already taken");
      if (!villageData) return errorResponse("Horizon village not found");
      if (villageData.type !== "VILLAGE")
        return errorResponse("Can only join villages");
      if (!selectedBloodline) return errorResponse("Bloodline not found");
      if (selectedBloodline.rank !== "D")
        return errorResponse("Only D-ranked bloodlines are allowed for new users");
      if (selectedBloodline.hidden)
        return errorResponse("Hidden bloodlines are not allowed for new users");

      // Mutate. Sorted so concurrent inserts for the same account take the
      // UserAttribute unique-index locks in the same order and cannot deadlock.
      const unique_attributes = [
        ...new Set([
          input.attribute_1,
          input.attribute_2,
          input.attribute_3,
          `${input.hair_color} hair`,
          `${input.eye_color} eyes`,
          `${input.skin_color} skin`,
        ]),
      ].sort();
      // Deleting a character retires the Clerk identity in the store ledger, so events for a
      // character that no longer exists are recorded without being delivered. The identity
      // coming back to make another character is the ordinary flow, and the web delete
      // deliberately leaves the player signed in for it, so the tombstone goes, and what the
      // ledger recorded meanwhile -- a renewal, an expiry, a transfer -- is settled as soon
      // as the character row exists, whichever request that turns out to be. Reputation points delivered to the deleted character stay
      // with it; every receipt is idempotent by transactionId, so nothing is delivered
      // twice. A rename alias is different: its target is a live character that this
      // identity's receipts route to, so it refuses.
      //
      // The tombstone delete and the insert are two statements rather than a guard folded
      // into one. Deletion writes its tombstone first and removes the account row last,
      // dozens of statements apart, so slipping a character past the alias read would take
      // the same identity deleting and registering at once, with the whole deletion landing
      // in between. The ledger records around a tombstone rather than dropping, so what that
      // would cost is push registration until the alias row is removed. That cost is
      // confined to one account and support can undo it, so the race is accepted.
      if (storeAlias && !isDeletedStoreUserId(storeAlias.newUserId)) {
        return errorResponse(
          "This account is linked to another character and cannot create a new one",
        );
      }
      // A ban or silence still running on a deleted account carries over to this one. The
      // Clerk lookup is only needed while some deleted account has a running sanction.
      const sanctionIdentity = tombstones.length
        ? await fetchSanctionIdentity(ctx.userId)
        : undefined;
      const sanctions = matchSanctionTombstones(
        tombstones,
        ctx.userId,
        sanctionIdentity ?? null,
        ctx.userIp,
      );
      const sanctionGuard = await reapplySanctions(
        ctx.drizzle,
        ctx.userId,
        sanctions,
        carryoverReports.map((report) => report.id),
        sanctionIdentity,
        ctx.userIp,
      );
      const values = {
        userId: ctx.userId,
        lastIp: ctx.userIp,
        recruiterId: input.recruiter_userid,
        username: input.username,
        gender: input.gender,
        spriteBodyStyle: input.spriteBodyStyle,
        avatar: IMG_DEFAULT_PROFILE_PICTURE,
        villageId: villageData.id,
        // New characters start at day zero rather than inheriting the backdated schema default.
        joinedVillageAt: new Date(),
        bloodlineId: selectedBloodline.id,
        approvedTos: true,
        sector: villageData.sector,
        extraJutsuSlots: 0,
        immunityUntil: secondsFromNow(24 * 3600),
        musicOn: input.musicOn ?? true,
        sfxOn: input.sfxOn ?? true,
        buttonSfxOn: input.buttonSfxOn ?? true,
        isBanned: sanctions.some((match) => match.sanction === "BAN"),
        isSilenced: sanctions.some((match) => match.sanction === "SILENCE"),
        // Experience is earned through the Academy Trials rather than handed out
        // up front; an email-reminder signup keeps its promised bonus.
        earnedExperience: reminder ? 10000 : 0,
      } satisfies typeof userData.$inferInsert;

      const discardSanctions = () =>
        discardUnpublishedSanctions(
          ctx.drizzle,
          ctx.userId,
          sanctions.map((match) => carryoverReportId(ctx.userId, match)),
        );

      // INSERT SELECT publishes flags only with durable cases and unchanged sources.
      const createdUser = await retryOnDeadlock(() =>
        executeCreatedUserForCreateCharacter(ctx.drizzle, values, sanctionGuard, input),
      ).catch(async (error: unknown) => {
        if (isMysqlDuplicateKeyError(error)) return { rowsAffected: 0 };
        await discardSanctions();
        throw error;
      });
      if (createdUser.rowsAffected === 0) {
        const currentUser = await findUserDataForCreateCharacter3(
          ctx.drizzle,
          ctx,
          input,
        );
        if (!currentUser || currentUser.userId !== ctx.userId) {
          await discardSanctions();
          return errorResponse(
            currentUser
              ? "Username already taken"
              : "Account sanctions changed, please try again",
          );
        }
      }
      if (storeAlias) {
        await deleteStoreUserIdAliasForCreateCharacter(ctx.drizzle, ctx, storeAlias);
      }
      // The row exists either way now, so settle before answering a duplicate.
      if (hasLedger) await settleLedger();
      if (createdUser.rowsAffected === 0) {
        return errorResponse("Character already created for this account");
      }
      await deleteUserAttributes(ctx.drizzle, ctx.userId);
      const [adClickLink] = await Promise.all([
        adClick && adClickConsent
          ? linkAdClickToUser(ctx.drizzle, {
              id: adClick.id,
              userId: ctx.userId,
              consent: adClickConsent,
            })
          : null,
        insertStarterHomeItems(ctx.drizzle, ctx.userId),
        insertQuestHistoryForCreateCharacter(ctx.drizzle, ctx),
        insertUserAttributeForCreateCharacter(ctx.drizzle, unique_attributes, ctx),
        insertBloodlineRollsForCreateCharacter(ctx.drizzle, ctx, {
          id: selectedBloodline.id,
          rank: selectedBloodline.rank,
        }),
        ...(isKnownIp(ctx.userIp)
          ? [upsertHistoricalIp(ctx.drizzle, ctx.userId, ctx.userIp)]
          : []),
        ...(input.recruiter_userid
          ? [
              updateUserDataForCreateCharacter(ctx.drizzle, {
                recruiter_userid: input.recruiter_userid,
              }),
            ]
          : []),
        // Every recruit counts as a recruit; eligibility only gates rank milestone rewards.
        ...(input.recruiter_userid && recruitEligibility
          ? [
              insertRecruitReferralForCreateCharacter(
                ctx.drizzle,
                ctx,
                { recruiter_userid: input.recruiter_userid },
                recruitEligibility,
              ),
            ]
          : []),
      ]);
      return {
        success: true,
        message: "Character created",
        registrationId: ctx.userId,
        isAdClickLinked: (adClickLink?.rowsAffected ?? 0) > 0,
      };
    }),
});
