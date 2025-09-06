import { nanoid } from "nanoid";
import { eq, sql, and } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { errorResponse, baseServerResponse } from "@/server/api/trpc";
import { registrationSchema } from "@/validators/register";
import { historicalIp } from "@/drizzle/schema";
import { secondsFromNow } from "@/utils/time";
import { checkForBadWords } from "@/utils/profanity";
import { referralSource } from "@/drizzle/schema";
import { abEvent } from "@/drizzle/schema";
import {
  bloodline,
  bloodlineRolls,
  emailReminder,
  userAttribute,
  userData,
  village,
} from "@/drizzle/schema";

export const registerRouter = createTRPCRouter({
  // Create Character
  createCharacter: protectedProcedure
    .input(registrationSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Check for bad words
      const moderationResult = await checkForBadWords(input.username);
      if (!moderationResult.success) return moderationResult;
      // Query
      const [villageData, user, reminder, selectedBloodline, currentIp] =
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
          villageId: villageData.id,
          bloodlineId: selectedBloodline.id,
          approvedTos: 1,
          sector: villageData.sector,
          immunityUntil: secondsFromNow(24 * 3600),
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
        ...(ctx.abWelcomeVariant
          ? [
              ctx.drizzle.insert(abEvent).values({
                id: nanoid(),
                userId: ctx.userId,
                experiment: "welcome_optimized_ab",
                variant: ctx.abWelcomeVariant,
                event: "register",
              }),
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
        ...(input.utm_source
          ? [
              ctx.drizzle.insert(referralSource).values({
                id: nanoid(),
                userId: ctx.userId,
                source: input.utm_source,
              }),
            ]
          : []),
      ]);
      return { success: true, message: "Character created" };
    }),
});
