import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  IMG_DEFAULT_PROFILE_PICTURE,
  TUTORIAL_STARTER_QUEST_ID,
} from "@/drizzle/constants";
import {
  bloodline,
  bloodlineRolls,
  emailReminder,
  historicalIp,
  questHistory,
  referralSource,
  storeUserIdAlias,
  userAttribute,
  userData,
  village,
  visitorLog,
} from "@/drizzle/schema";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import {
  isDeletedStoreUserId,
  settleRecordedLedger,
} from "@/server/utils/purchases/grant";
import { checkForBadWords } from "@/utils/profanity";
import { secondsFromNow } from "@/utils/time";
import { registrationSchema, utmSourceSchema } from "@/validators/register";

export const registerRouter = createTRPCRouter({
  // Set referral source on sign-in (before character creation)
  setReferralSource: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Set referral source for analytics" } })
    .input(z.object({ utmSource: utmSourceSchema }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // If already set, no-op
      const existing = await ctx.drizzle.query.referralSource.findFirst({
        where: eq(referralSource.userId, ctx.userId),
      });
      if (existing) {
        return { success: true, message: "Referral source already set" };
      }

      // Determine source: provided utmSource or fallback from visitorLog by IP
      const provided = (input?.utmSource ?? "").trim();
      let source = provided;
      if (!source) {
        const ip = ctx.userIp ?? "unknown";
        if (ip !== "unknown") {
          const visit = await ctx.drizzle.query.visitorLog.findFirst({
            where: eq(visitorLog.ip, ip),
          });
          source = (visit?.utmSource ?? "").trim();
        }
      }

      if (!source) {
        return { success: true, message: "No UTM source found to set" };
      }

      // Ensure we map IP -> user for later analytics joins
      const ip = ctx.userIp ?? "unknown";
      if (ip !== "unknown") {
        const currentIp = await ctx.drizzle.query.historicalIp.findFirst({
          where: and(eq(historicalIp.ip, ip), eq(historicalIp.userId, ctx.userId)),
        });
        if (!currentIp) {
          await ctx.drizzle.insert(historicalIp).values({ userId: ctx.userId, ip });
        }
      }

      await ctx.drizzle.insert(referralSource).values({
        id: nanoid(),
        userId: ctx.userId,
        source,
      });
      return { success: true, message: "Referral source set" };
    }),
  // Create Character
  createCharacter: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Create a new character" } })
    .input(registrationSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [
        villageData,
        existingUser,
        usernameTaken,
        reminder,
        selectedBloodline,
        currentIp,
        moderationResult,
        storeAlias,
      ] = await Promise.all([
        ctx.drizzle.query.village.findFirst({
          where: eq(village.name, "Horizon"),
        }),
        ctx.drizzle.query.userData.findFirst({
          where: eq(userData.userId, ctx.userId),
        }),
        ctx.drizzle.query.userData.findFirst({
          where: eq(userData.username, input.username),
        }),
        ctx.drizzle.query.emailReminder.findFirst({
          where: eq(emailReminder.userId, ctx.userId),
        }),
        ctx.drizzle.query.bloodline.findFirst({
          where: eq(bloodline.id, input.bloodlineId),
        }),
        ctx.drizzle.query.historicalIp.findFirst({
          where: and(
            eq(historicalIp.ip, ctx.userIp ?? ""),
            eq(historicalIp.userId, ctx.userId),
          ),
        }),
        checkForBadWords(input.username),
        ctx.drizzle.query.storeUserIdAlias.findFirst({
          columns: { newUserId: true },
          where: eq(storeUserIdAlias.oldUserId, ctx.userId),
        }),
      ]);

      // Guard
      if (!moderationResult.success) return moderationResult;
      if (existingUser)
        return errorResponse("Character already created for this account");
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
      // The account row is written on its own before anything that references it, so
      // registration never leaves rows behind that look like orphans to the cleaner.
      //
      // Deleting a character retires the Clerk identity in the store ledger, so events for a
      // character that no longer exists are recorded without being delivered. The identity
      // coming back to make another character is the ordinary flow, and the web delete
      // deliberately leaves the player signed in for it, so the tombstone goes, and what the
      // ledger recorded meanwhile -- a renewal, an expiry, a transfer -- is settled once the
      // character exists below. Reputation points delivered to the deleted character stay
      // with it; every receipt is idempotent by transactionId, so nothing is delivered
      // twice. A rename alias is different: its target is a live character that this
      // identity's receipts route to, so it refuses.
      //
      // The tombstone delete and the insert are two statements rather than a guard folded
      // into one. Deletion writes its tombstone first and removes the account row last,
      // dozens of statements apart, so slipping a character past the alias read would take
      // the same identity deleting and registering at once, with the whole deletion landing
      // in between. The ledger records around a tombstone rather than dropping, so what that
      // would cost is push registration until the alias row is removed; closing it would
      // take an insert the builder cannot express.
      if (storeAlias && !isDeletedStoreUserId(storeAlias.newUserId)) {
        return errorResponse(
          "This account is linked to another character and cannot create a new one",
        );
      }
      if (storeAlias) {
        await ctx.drizzle
          .delete(storeUserIdAlias)
          .where(
            and(
              eq(storeUserIdAlias.oldUserId, ctx.userId),
              eq(storeUserIdAlias.newUserId, storeAlias.newUserId),
            ),
          );
      }
      const createdUser = await ctx.drizzle
        .insert(userData)
        .values({
          userId: ctx.userId,
          lastIp: ctx.userIp,
          recruiterId: input.recruiter_userid,
          username: input.username,
          gender: input.gender,
          avatar: IMG_DEFAULT_PROFILE_PICTURE,
          villageId: villageData.id,
          bloodlineId: selectedBloodline.id,
          approvedTos: true,
          sector: villageData.sector,
          extraJutsuSlots: 0,
          immunityUntil: secondsFromNow(24 * 3600),
          musicOn: input.musicOn ?? true,
          sfxOn: input.sfxOn ?? true,
          buttonSfxOn: input.buttonSfxOn ?? true,
          ...(reminder ? { earnedExperience: 10000 } : {}),
        })
        .onDuplicateKeyUpdate({ set: { userId: sql`userId` } });
      if (createdUser.rowsAffected === 0) {
        return errorResponse("Character already created for this account");
      }
      await ctx.drizzle
        .delete(userAttribute)
        .where(eq(userAttribute.userId, ctx.userId));
      await Promise.all([
        ctx.drizzle
          .insert(questHistory)
          .values({
            id: nanoid(),
            userId: ctx.userId,
            questId: TUTORIAL_STARTER_QUEST_ID,
            questType: "starter",
            startedAt: new Date(),
            endAt: null,
            completed: 0,
            previousCompletes: 0,
            previousAttempts: 1,
          })
          .onDuplicateKeyUpdate({ set: { id: sql`id` } }),
        ctx.drizzle
          .insert(userAttribute)
          .values(
            unique_attributes.map((attribute) => ({
              id: nanoid(),
              attribute: attribute,
              userId: ctx.userId,
            })),
          )
          .onDuplicateKeyUpdate({ set: { id: sql`id` } }),
        ctx.drizzle.insert(bloodlineRolls).values({
          id: nanoid(),
          userId: ctx.userId,
          type: "REGISTRATION",
          bloodlineId: selectedBloodline.id,
          goal: selectedBloodline.rank,
          used: 1,
          pityRolls: 0,
        }),
        ...(ctx.userIp && !currentIp
          ? [
              ctx.drizzle.insert(historicalIp).values({
                userId: ctx.userId,
                ip: ctx.userIp,
              }),
            ]
          : []),
        ...(input.recruiter_userid
          ? [
              ctx.drizzle
                .update(userData)
                .set({ nRecruited: sql`${userData.nRecruited} + 1` })
                .where(eq(userData.userId, input.recruiter_userid)),
            ]
          : []),
      ]);
      if (storeAlias) await settleRecordedLedger(ctx.drizzle, ctx.userId);
      return { success: true, message: "Character created" };
    }),
});
