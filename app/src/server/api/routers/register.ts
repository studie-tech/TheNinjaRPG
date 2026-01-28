import { nanoid } from "nanoid";
import { eq, sql, and } from "drizzle-orm";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { errorResponse, baseServerResponse } from "@/server/api/trpc";
import { registrationSchema, utmSourceSchema } from "@/validators/register";
import { historicalIp } from "@/drizzle/schema";
import { referralSource } from "@/drizzle/schema";
import { visitorLog } from "@/drizzle/schema";
import { secondsFromNow } from "@/utils/time";
import { checkForBadWords } from "@/utils/profanity";
import {
  TUTORIAL_STARTER_QUEST_ID,
  IMG_DEFAULT_PROFILE_PICTURE,
} from "@/drizzle/constants";
import {
  bloodline,
  bloodlineRolls,
  emailReminder,
  userAttribute,
  userData,
  questHistory,
  village,
} from "@/drizzle/schema";

export const registerRouter = createTRPCRouter({
  // Set referral source on sign-in (before character creation)
  setReferralSource: protectedProcedure
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
    .input(registrationSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Check for bad words
      const moderationResult = await checkForBadWords(input.username);
      if (!moderationResult.success) return moderationResult;
      // Query
      const [
        villageData,
        existingUser,
        usernameTaken,
        reminder,
        selectedBloodline,
        currentIp,
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
      ]);

      // Guard
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

      // Mutate
      const unique_attributes = [
        ...new Set([
          input.attribute_1,
          input.attribute_2,
          input.attribute_3,
          input.hair_color + " hair",
          input.eye_color + " eyes",
          input.skin_color + " skin",
        ]),
      ];
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
        ctx.drizzle.insert(userData).values({
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
          ...(reminder ? { earnedExperience: 10000 } : {}),
        }),
        ctx.drizzle.insert(bloodlineRolls).values({
          id: nanoid(),
          userId: ctx.userId,
          type: "REGISTRATION",
          bloodlineId: selectedBloodline.id,
          goal: selectedBloodline.rank,
          used: 1,
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
      return { success: true, message: "Character created" };
    }),
});
