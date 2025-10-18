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
import { abEvent } from "@/drizzle/schema";
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
      const [villageData, user, reminder, selectedBloodline, currentIp, abLoadedEvent] =
        await Promise.all([
          ctx.drizzle.query.village.findFirst({
            where: eq(village.name, "Horizon"),
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
          ctx.drizzle.query.abEvent.findFirst({
            where: and(
              eq(abEvent.ip, ctx.userIp ?? ""),
              eq(abEvent.experiment, "ab_music_welcome_to_seichi"),
              eq(abEvent.event, "loaded"),
            ),
          }),
        ]);

      // Guard
      if (user) return errorResponse("Username already taken");
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
        ctx.drizzle.insert(userAttribute).values(
          unique_attributes.map((attribute) => ({
            id: nanoid(),
            attribute: attribute,
            userId: ctx.userId,
          })),
        ),
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
        // Log AB variant used for welcome page when registering, if present
        ...(ctx.abWelcomeVariant && abLoadedEvent
          ? [
              ctx.drizzle
                .insert(abEvent)
                .values({
                  id: nanoid(),
                  userId: ctx.userId,
                  experiment: "ab_music_welcome_to_seichi",
                  variant: ctx.abWelcomeVariant,
                  event: "register",
                  source: input.utm_source ?? undefined,
                  ip: ctx.userIp && ctx.userIp !== "unknown" ? ctx.userIp : undefined,
                  userAgent:
                    typeof ctx.userAgent === "string"
                      ? ctx.userAgent.slice(0, 180)
                      : undefined,
                })
                .onDuplicateKeyUpdate({ set: { id: sql`id` } }),
            ]
          : []),
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
