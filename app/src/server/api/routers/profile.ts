import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  like,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { customAlphabet, nanoid } from "nanoid";
import { z } from "zod";
import {
  ACTIVE_VOTING_SITES,
  ALLIANCEHALL_LAT,
  ALLIANCEHALL_LONG,
  BasicElementName,
  COST_CHANGE_USERNAME,
  getUserCaps,
  IMG_AVATAR_DEFAULT,
  KAGE_MIN_PRESTIGE,
  KAGE_PRESTIGE_REQUIREMENT,
  MAX_ATTRIBUTES,
  MAX_SKILL_POINTS,
  MAX_SKILL_POINTS_FROM_LEVELING,
  REGEN_SECONDS,
  RYO_CAP,
  SENSEI_MAX_STUDENT_LEVEL,
  SHRINE_BOOST_TYPES,
  SKILL_POINT_MAX_LEVEL,
  SKILL_POINT_MIN_LEVEL,
  TUTORIAL_STEPS_COUNT,
  UserRanks,
  UserRolesWithSkillTreeAccess,
  VILLAGE_SYNDICATE_ID,
} from "@/drizzle/constants";
import type {
  Bloodline,
  BloodlineReskin,
  Clan,
  Quest,
  UserData,
  UserItem,
  UserJutsu,
  UserQuest,
  UserVote,
  Village,
  VillageAlliance,
  VillageStructure,
} from "@/drizzle/schema";
import {
  abEvent,
  actionLog,
  battleHistory,
  gameSetting,
  historicalIp,
  insertAiSchema,
  item,
  jutsu,
  mpvpBattleQueue,
  notification,
  poll,
  quest,
  questHistory,
  recruitmentRewards,
  staffApplication,
  staffApplicationApproval,
  supportTicket,
  userAttribute,
  userBlackList,
  userData,
  userItem,
  userJutsu,
  userNindo,
  userPollVote,
  userReport,
  userVote,
  village,
  war,
} from "@/drizzle/schema";
import { getReskinnedBloodline } from "@/libs/bloodline";
import {
  getGameSetting,
  getGameSettingBoost,
  updateGameSetting,
} from "@/libs/gamesettings";
import type { NavBarDropdownLink } from "@/libs/menus";
import { moderateContent, validateUserUpdateReason } from "@/libs/moderator";
import {
  calcActiveUserRegen,
  calcCP,
  calcHP,
  calcLevelRequirements,
  calcSP,
  capUserStats,
  scaleUserStats,
} from "@/libs/profile";
import { getServerPusher } from "@/libs/pusher";
import {
  controlShownQuestLocationInformation,
  getNewTrackers,
  isAvailableUserQuests,
  mockAchievementHistoryEntries,
} from "@/libs/quest";
import { getRaidObjectiveData } from "@/libs/raids";
import { createThumbnail } from "@/libs/replicate";
import { callDiscordContent } from "@/libs/socials";
import { getReducedGainsDays } from "@/libs/train";
import { fetchSquad, removeFromSquad } from "@/routers/anbu";
import { fetchClan, removeFromClan } from "@/routers/clan";
import { fetchKageReplacement } from "@/routers/kage";
import { handleQuestConsequences, insertNextQuest } from "@/routers/quests";
import { fetchVillage } from "@/routers/village";
import { deleteUser } from "@/server/api/routers/staff";
import type { DrizzleClient } from "@/server/db";
import { getRandomElement } from "@/utils/array";
import { calculateContentDiff } from "@/utils/diff";
import {
  canAwardExperience,
  canChangeContent,
  canChangeUserRolesTo,
  canDeleteUsers,
  canEditBloodline,
  canEditCustomTitle,
  canEditItems,
  canEditJutsus,
  canEditRank,
  canEditRankedLp,
  canEditStaffAccountFlag,
  canEditUsername,
  canEditVillage,
  canInteractWithPolls,
  canModerateRoles,
  canOnlyEditSelf,
  canSeeIps,
  canSeeSecretData,
  getApprovalGroup,
} from "@/utils/permissions";
import sanitize from "@/utils/sanitize";
import {
  getTimeOfLastReset,
  isDifferentDay,
  secondsFromNow,
  secondsPassed,
} from "@/utils/time";
import { setEmptyStringsToNulls } from "@/utils/typeutils";
import { getShrineBoost } from "@/utils/village";
import { createStatSchema } from "@/validators/combat";
import { mutateContentSchema } from "@/validators/comments";
import { attributes, colors, skin_colors, usernameSchema } from "@/validators/register";
import type { GetPublicUsersSchema } from "@/validators/user";
import {
  getPublicUsersSchema,
  updateUserPreferencesSchema,
  updateUserSchema,
} from "@/validators/user";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
  serverError,
} from "../trpc";

const pusher = getServerPusher();

export const profileRouter = createTRPCRouter({
  // Update battle description setting
  updateBattleDescription: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Toggle battle description visibility" },
    })
    .input(z.object({ showBattleDescription: z.boolean() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Mutate
      const result = await ctx.drizzle
        .update(userData)
        .set({ showBattleDescription: input.showBattleDescription })
        .where(eq(userData.userId, ctx.userId));
      // Potential errors
      if (result.rowsAffected === 0) {
        return errorResponse("Could not update battle description setting");
      }
      // Information
      return {
        success: true,
        message: `Battle descriptions ${input.showBattleDescription ? "enabled" : "disabled"}`,
      };
    }),
  // Update tutorial step
  updateTutorialStep: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Update user's tutorial progress step" },
    })
    .input(z.object({ step: z.number() }))
    .output(
      baseServerResponse.extend({
        data: z.object({ tutorialStep: z.number() }).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Update the database
      await ctx.drizzle
        .update(userData)
        .set({ tutorialStep: input.step })
        .where(eq(userData.userId, ctx.userId));

      // AB Test success
      if (input.step === TUTORIAL_STEPS_COUNT) {
        const abLoadedEvent = await ctx.drizzle.query.abEvent.findFirst({
          where: and(
            eq(abEvent.ip, ctx.userIp ?? ""),
            eq(abEvent.experiment, "ab_lemu_replacement_2"),
            eq(abEvent.event, "loaded"),
          ),
        });
        if (ctx.abLemuReplacementVariant && abLoadedEvent) {
          await ctx.drizzle
            .insert(abEvent)
            .values({
              id: nanoid(),
              userId: ctx.userId,
              experiment: "ab_lemu_replacement_2",
              variant: ctx.abLemuReplacementVariant,
              event: "success",
              source: abLoadedEvent.source,
              ip: ctx.userIp && ctx.userIp !== "unknown" ? ctx.userIp : undefined,
              userAgent:
                typeof ctx.userAgent === "string"
                  ? ctx.userAgent.slice(0, 180)
                  : undefined,
            })
            .onDuplicateKeyUpdate({ set: { id: sql`id` } });
        }
      }

      // Return success response
      return {
        success: true,
        message: `Tutorial step updated to ${input.step}`,
        data: { tutorialStep: input.step },
      };
    }),
  // Update user preferences
  updatePreferences: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Update user game preferences" } })
    .input(updateUserPreferencesSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.drizzle
        .update(userData)
        .set({
          ...(input.tutorialOn !== undefined ? { tutorialOn: input.tutorialOn } : {}),
          ...(input.musicOn !== undefined ? { musicOn: input.musicOn } : {}),
          ...(input.sfxOn !== undefined ? { sfxOn: input.sfxOn } : {}),
          ...(input.iframesMuted !== undefined
            ? { iframesMuted: input.iframesMuted }
            : {}),
          ...(input.preferredStat !== undefined
            ? { preferredStat: input.preferredStat }
            : {}),
          ...(input.preferredGeneral1 !== undefined
            ? { preferredGeneral1: input.preferredGeneral1 }
            : {}),
          ...(input.preferredGeneral2 !== undefined
            ? { preferredGeneral2: input.preferredGeneral2 }
            : {}),
        })
        .where(eq(userData.userId, ctx.userId));
      return {
        success: result.rowsAffected > 0,
        message:
          result.rowsAffected > 0
            ? "Updated preferences"
            : "Failed to update preferences",
      };
    }),
  // Get user blacklist
  getBlacklist: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get user's blocked players list" } })
    .query(async ({ ctx }) => {
      return await ctx.drizzle.query.userBlackList.findMany({
        where: eq(userBlackList.creatorUserId, ctx.userId),
        with: {
          target: { columns: { username: true, userId: true, avatar: true } },
        },
      });
    }),
  toggleBlacklistEntry: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Add or remove a player from blacklist" },
    })
    .input(z.object({ userId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [entry, target] = await Promise.all([
        ctx.drizzle.query.userBlackList.findFirst({
          where: and(
            eq(userBlackList.creatorUserId, ctx.userId),
            eq(userBlackList.targetUserId, input.userId),
          ),
        }),
        ctx.drizzle.query.userData.findFirst({
          where: eq(userData.userId, input.userId),
        }),
      ]);
      // Guard
      if (!target) return errorResponse("User not found");
      if (ctx.userId === input.userId) return errorResponse("Not yourself");
      // Derived
      const targetName = target.username;
      // Mutate
      if (!entry) {
        const result = await ctx.drizzle.insert(userBlackList).values({
          creatorUserId: ctx.userId,
          targetUserId: input.userId,
        });
        if (result.rowsAffected === 0) {
          return { success: false, message: `Failed to add ${targetName}` };
        } else {
          return { success: true, message: `Added ${targetName} to blacklist` };
        }
      } else {
        await ctx.drizzle.delete(userBlackList).where(eq(userBlackList.id, entry.id));
        return { success: true, message: `Removed ${targetName} from blacklist` };
      }
    }),
  // Get all AI names
  getAllAiNames: publicProcedure
    .meta({ mcp: { enabled: true, description: "Get list of all AI character names" } })
    .query(async ({ ctx }) => {
      return ctx.drizzle.query.userData.findMany({
        where: and(eq(userData.isAi, true), ne(userData.rank, "ELDER")),
        columns: {
          userId: true,
          username: true,
          level: true,
          avatar: true,
          isSummon: true,
          inArena: true,
          aiProfileId: true,
        },
        orderBy: asc(userData.level),
      });
    }),
  // Update user with new level
  levelUp: protectedProcedure
    .meta({
      mcp: {
        enabled: true,
        description: "Level up user when experience threshold met",
      },
    })
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      // Query
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });
      // Guard
      if (!user) return errorResponse("User not found");
      const expRequired = calcLevelRequirements(user.level) - user.experience;
      const { lvl_cap } = getUserCaps(user.rank);
      if (user.level >= lvl_cap)
        return errorResponse("User at max level for this rank!");
      if (expRequired > 0) return errorResponse("No enough experience for level");
      if (user.village?.name === "Horizon" && user.level > 9) {
        return errorResponse(
          "Horizon users cannot level beyond level 9. To progress, go to the academy to take a quest for joining one of the main villages.",
        );
      }
      // Mutate
      const newLevel = user.level + 1;
      const { trackers } = getNewTrackers(user, [
        { task: "user_level", value: newLevel },
      ]);
      // Calculate skill points reward for chunin+ ranks - levels 21-40 give 1 skill point each
      const isChunin = UserRolesWithSkillTreeAccess.includes(user.rank);
      // Calculate how many skillpoints they should have from leveling (max 20)
      // Chunin+ ranks get 1 skillpoint per level from levels 21-40
      const expectedSkillPointsFromLeveling =
        isChunin && newLevel >= SKILL_POINT_MIN_LEVEL
          ? Math.min(
              newLevel - SKILL_POINT_MIN_LEVEL + 1,
              MAX_SKILL_POINTS_FROM_LEVELING,
            )
          : 0;
      // Only give skillpoints if they haven't received all their leveling skillpoints yet
      const skillPointsGain =
        isChunin &&
        newLevel >= SKILL_POINT_MIN_LEVEL &&
        newLevel <= SKILL_POINT_MAX_LEVEL &&
        expectedSkillPointsFromLeveling <= MAX_SKILL_POINTS_FROM_LEVELING
          ? 1
          : 0;

      const result = await ctx.drizzle
        .update(userData)
        .set({
          level: newLevel,
          maxHealth: calcHP(newLevel),
          maxStamina: calcSP(newLevel),
          maxChakra: calcCP(newLevel),
          questData: trackers,
          ...(skillPointsGain > 0
            ? {
                skillPoints: sql`LEAST(${userData.skillPoints} + 1, ${MAX_SKILL_POINTS})`,
              }
            : {}),
          ...(newLevel > SENSEI_MAX_STUDENT_LEVEL && user.senseiId
            ? { senseiId: null }
            : {}),
        })
        .where(and(eq(userData.userId, ctx.userId), eq(userData.level, user.level)));
      if (result.rowsAffected > 0 && user.recruiterId) {
        const amount = 10 * newLevel * newLevel * newLevel;
        await Promise.all([
          ctx.drizzle
            .update(userData)
            .set({ bank: sql`${userData.bank} + ${amount}` })
            .where(eq(userData.userId, user.recruiterId)),
          ctx.drizzle.insert(recruitmentRewards).values({
            id: nanoid(),
            userId: user.recruiterId,
            recruitedUserId: ctx.userId,
            amount: amount,
            type: "MONEY",
          }),
        ]);
      }
      // Return response
      if (result.rowsAffected === 0) return errorResponse("Could not update level");
      const skillPointMessage =
        skillPointsGain > 0 ? ` and gained ${skillPointsGain} skill point!` : "";
      return {
        success: true,
        message: `User leveled up to ${newLevel}${skillPointMessage}`,
      };
    }),
  // Get all information on logged in user
  getUser: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Get current user's full profile data" },
    })
    .query(async ({ ctx }) => {
      // Query
      const { user, settings, toastMessages, hasUnvotedPolls } = await fetchUpdatedUser(
        {
          client: ctx.drizzle,
          userId: ctx.userId,
          userIp: ctx.userIp,
          // forceRegen: true, // This should be disabled in prod to save on DB calls
        },
      );
      // Figure out notifications
      const notifications: NavBarDropdownLink[] = [];

      // Add any notifications from fetching user to toasts
      toastMessages.forEach((msg) => {
        notifications.push({ name: msg, color: "toast", href: "/profile" });
      });

      // Shrine notifications (use Set to avoid duplicate sectors)
      const userWithRelations = user as UserWithRelations;
      const shrineDefenseSectors = [
        ...new Set(
          userWithRelations?.shrineBattles
            ?.filter((b) => b.defenderEntityId === user?.villageId)
            .map((b) => b.sector)
            .filter(Boolean) ?? [],
        ),
      ];
      const shrineOffenseSectors = [
        ...new Set(
          userWithRelations?.shrineBattles
            ?.filter((b) => b.attackerEntityId === user?.villageId)
            .map((b) => b.sector)
            .filter(Boolean) ?? [],
        ),
      ];

      if (shrineDefenseSectors.length > 0) {
        notifications.push({
          href: "/travel",
          name: `${shrineDefenseSectors.length > 1 ? "Shrines" : "Shrine"} under attack (${shrineDefenseSectors.length > 1 ? "Sectors" : "Sector"} ${shrineDefenseSectors.join(", ")})`,
          color: "red",
          alwaysShow: true,
        });
      }
      if (shrineOffenseSectors.length > 0) {
        notifications.push({
          href: "/travel",
          name: `We are attacking ${shrineOffenseSectors.length > 1 ? "Shrines" : "Shrine"} (${shrineOffenseSectors.length > 1 ? "Sectors" : "Sector"} ${shrineOffenseSectors.join(", ")})`,
          color: "blue",
          alwaysShow: true,
        });
      }

      // Gather sectors under war attack for this user's village (use Set to avoid duplicate sectors)
      const warDefenseSectors = [
        ...new Set(
          userWithRelations?.activeWars
            ?.filter((w) => {
              const isDefender = w.defenderVillageId === user?.villageId;
              const isDefenderAlly = w.warAllies?.some(
                (a) =>
                  a.villageId === user?.villageId &&
                  a.supportVillageId === w.defenderVillageId,
              );
              return (isDefender || isDefenderAlly) && w.sector;
            })
            .map((w) => w.sector)
            .filter(Boolean) ?? [],
        ),
      ];

      const warOffenseSectors = [
        ...new Set(
          userWithRelations?.activeWars
            ?.filter((w) => {
              const isAttacker = w.attackerVillageId === user?.villageId;
              const isAttackerAlly = w.warAllies?.some(
                (a) =>
                  a.villageId === user?.villageId &&
                  a.supportVillageId === w.attackerVillageId,
              );
              return (isAttacker || isAttackerAlly) && w.sector;
            })
            .map((w) => w.sector)
            .filter(Boolean) ?? [],
        ),
      ];

      if (warDefenseSectors.length > 0) {
        notifications.push({
          href: "/travel",
          name: `${warDefenseSectors.length > 1 ? "Sectors" : "Sector"} under attack (${warDefenseSectors.length > 1 ? "Sectors" : "Sector"} ${warDefenseSectors.join(", ")})`,
          color: "red",
          alwaysShow: true,
        });
      }
      if (warOffenseSectors.length > 0) {
        notifications.push({
          href: "/travel",
          name: `We are attacking ${warOffenseSectors.length > 1 ? "Sectors" : "Sector"} (${warOffenseSectors.length > 1 ? "Sectors" : "Sector"} ${warOffenseSectors.join(", ")})`,
          color: "blue",
          alwaysShow: true,
        });
      }

      // Raid notifications
      const openRaids =
        userWithRelations?.activeRaids?.filter((r) => r.raidType === "open") ?? [];
      const exclusiveRaids =
        userWithRelations?.activeRaids?.filter((r) => r.raidType === "exclusive") ?? [];

      // Group by sector to avoid duplicate sector mentions
      const openRaidSectors = [...new Set(openRaids.map((r) => r.sector))];
      const exclusiveRaidSectors = [...new Set(exclusiveRaids.map((r) => r.sector))];

      if (openRaidSectors.length > 0) {
        notifications.push({
          href: "/travel",
          name: `Open ${openRaidSectors.length > 1 ? "Raids" : "Raid"} available (${openRaidSectors.length > 1 ? "Sectors" : "Sector"} ${openRaidSectors.join(", ")})`,
          color: "red",
          alwaysShow: true,
        });
      }

      if (exclusiveRaidSectors.length > 0) {
        notifications.push({
          href: "/travel",
          name: `Village ${exclusiveRaidSectors.length > 1 ? "Raids" : "Raid"} active (${exclusiveRaidSectors.length > 1 ? "Sectors" : "Sector"} ${exclusiveRaidSectors.join(", ")})`,
          color: "red",
          alwaysShow: true,
        });
      }

      // Add notification for unvoted polls
      if (
        user &&
        hasUnvotedPolls &&
        hasUnvotedPolls.length > 0 &&
        canInteractWithPolls(user.rank)
      ) {
        notifications.push({
          href: "/manual/polls",
          name: "Unvoted Polls",
          color: "blue",
        });
      }
      // Add a voting link
      let hasVoted = true;
      ACTIVE_VOTING_SITES.forEach((site) => {
        if (!user?.votes || user.votes[site] !== true) {
          hasVoted = false;
        }
      });
      if (!hasVoted) {
        notifications.push({
          href: "/profile/recruit",
          name: `Vote for Us`,
          color: "hidden",
          notificationCount: 1,
        });
      }
      // Settings
      const trainingBoost = getGameSettingBoost("trainingGainMultiplier", settings);
      if (trainingBoost) {
        notifications.push({
          href: "/traininggrounds",
          name: `Global: ${trainingBoost.value}X gains | ${trainingBoost.daysLeft} days`,
          color: "green",
          group: "Active boosts",
        });
      }
      const regenBoost = getGameSettingBoost("regenGainMultiplier", settings);
      if (regenBoost) {
        notifications.push({
          href: "/profile",
          name: `Global: ${regenBoost.value}X regen | ${regenBoost.daysLeft} days`,
          color: "green",
          group: "Active boosts",
        });
      }
      const battleExpBoost = getGameSettingBoost("battleExpMultiplier", settings);
      if (battleExpBoost) {
        notifications.push({
          href: "/battlearena",
          name: `Global: ${battleExpBoost.value}X battle exp | ${battleExpBoost.daysLeft} days`,
          color: "green",
          group: "Active boosts",
        });
      }
      const missionExpBoost = getGameSettingBoost("missionExpMultiplier", settings);
      if (missionExpBoost) {
        notifications.push({
          href: "/missionhall",
          name: `Global: ${missionExpBoost.value}X mission exp | ${missionExpBoost.daysLeft} days`,
          color: "green",
          group: "Active boosts",
        });
      }
      const jutsuExpBoost = getGameSettingBoost("jutsuExpMultiplier", settings);
      if (jutsuExpBoost) {
        notifications.push({
          href: "/jutsus",
          name: `Global: ${jutsuExpBoost.value}X jutsu exp | ${jutsuExpBoost.daysLeft} days`,
          color: "green",
          group: "Active boosts",
        });
      }
      // User specific
      if (user) {
        // War-time regen boost
        const warRegenName = `war-${user.village?.id}-regen`;
        const warRegenSetting = settings.find((s) => s.name === warRegenName);
        const warRegenBoost = getGameSettingBoost(warRegenName, settings);
        if (warRegenBoost) {
          notifications.push({
            href: "/profile",
            name: `War: +${warRegenBoost.value}% regen | ${warRegenBoost.daysLeft} days`,
            color: "green",
            group: "Active boosts",
          });
        }
        if (!warRegenSetting) {
          await ctx.drizzle.insert(gameSetting).values({
            id: nanoid(),
            name: warRegenName,
            value: 0,
            time: new Date(),
          });
        }

        // War-time training boost
        const warTrainingName = `war-${user.village?.id}-train`;
        const warTrainingSetting = settings.find((s) => s.name === warTrainingName);
        const warTrainingBoost = getGameSettingBoost(warTrainingName, settings);
        if (warTrainingBoost) {
          notifications.push({
            href: "/profile",
            name: `War: +${warTrainingBoost.value}% gains | ${warTrainingBoost.daysLeft} days`,
            color: "green",
            group: "Active boosts",
          });
        }
        if (!warTrainingSetting) {
          await ctx.drizzle.insert(gameSetting).values({
            id: nanoid(),
            name: warTrainingName,
            value: 0,
            time: new Date(),
          });
        }

        // Shrine boosts
        const shrineBoosts = user.village?.shrineSettings?.activeBoosts;
        if (shrineBoosts) {
          const sectors = user.village?.sectors?.length ?? 0;
          SHRINE_BOOST_TYPES.forEach((boostType) => {
            const boost = getShrineBoost(sectors, boostType, user.village) * 100;
            if (boost > 0) {
              notifications.push({
                href: "/shrine",
                name: `Shrine: +${boost}% ${boostType} gains`,
                color: "green",
                group: "Active boosts",
              });
            }
          });
        }

        // Get moderation and application counts in parallel for eligible staff.
        const approvalGroup = getApprovalGroup(user.role);
        if (canModerateRoles.includes(user.role) || approvalGroup) {
          const [reportCounts, ticketCounts, applicationCounts] = await Promise.all([
            canModerateRoles.includes(user.role)
              ? ctx.drizzle
                  .select({ count: sql`count(*)`.mapWith(Number) })
                  .from(userReport)
                  .innerJoin(userData, eq(userData.userId, userReport.reportedUserId))
                  .where(inArray(userReport.status, ["UNVIEWED", "BAN_ESCALATED"]))
              : null,
            canModerateRoles.includes(user.role)
              ? ctx.drizzle
                  .select({ count: sql`count(*)`.mapWith(Number) })
                  .from(supportTicket)
                  .where(
                    inArray(supportTicket.status, [
                      "OPEN",
                      "IN_PROGRESS",
                      "WAITING_FOR_STAFF",
                    ]),
                  )
              : null,
            approvalGroup
              ? ctx.drizzle
                  .select({ count: sql`count(*)`.mapWith(Number) })
                  .from(staffApplication)
                  .leftJoin(
                    staffApplicationApproval,
                    and(
                      eq(staffApplication.id, staffApplicationApproval.applicationId),
                      eq(staffApplicationApproval.group, approvalGroup),
                      eq(staffApplicationApproval.approverUserId, user.userId),
                    ),
                  )
                  .where(
                    and(
                      eq(staffApplication.state, "PENDING"),
                      isNull(staffApplicationApproval.applicationId),
                    ),
                  )
              : null,
          ]);

          const userReports = reportCounts?.[0]?.count ?? 0;
          if (userReports > 0) {
            notifications.push({
              href: "/reports",
              name: `${userReports} waiting!`,
              color: "hidden",
              notificationCount: userReports,
            });
          }
          const userTickets = ticketCounts?.[0]?.count ?? 0;
          if (userTickets > 0) {
            notifications.push({
              href: "/support",
              name: `${userTickets} waiting!`,
              color: "hidden",
              notificationCount: userTickets,
            });
          }

          const adminAppCount = applicationCounts?.[0]?.count ?? 0;
          if (adminAppCount > 0) {
            notifications.push({
              href: "/manual/staff/applications",
              name: `Applications (${adminAppCount})`,
              color: "blue",
              notificationCount: adminAppCount,
            });
          }
        }
        // Check if user is banned
        if (user.isBanned) {
          notifications.push({
            href: "/reports",
            name: "Banned!",
            color: "red",
          });
        }
        // Check if user is trade banned
        if (user.isTradeBanned) {
          notifications.push({
            href: "/reports",
            name: "Trade Banned!",
            color: "red",
          });
        }
        // Unused experience points - only show if not all stats are capped
        if (user.earnedExperience > 0) {
          const { stats_cap, gens_cap } = getUserCaps(user.rank);
          const allStatsCapped =
            user.ninjutsuOffence >= stats_cap &&
            user.ninjutsuDefence >= stats_cap &&
            user.genjutsuOffence >= stats_cap &&
            user.genjutsuDefence >= stats_cap &&
            user.taijutsuOffence >= stats_cap &&
            user.taijutsuDefence >= stats_cap &&
            user.bukijutsuOffence >= stats_cap &&
            user.bukijutsuDefence >= stats_cap &&
            user.strength >= gens_cap &&
            user.speed >= gens_cap &&
            user.intelligence >= gens_cap &&
            user.willpower >= gens_cap;

          if (!allStatsCapped) {
            notifications.push({
              id: "tutorial-unassigned-stats",
              href: "/profile/experience",
              name: "Assign XP",
              color: "blue",
            });
          }
        }
        // Check if reduced gains
        const reducedDays = getReducedGainsDays(user);
        if (reducedDays > 0) {
          notifications.push({
            href: "/village",
            name: `Slowed ${Math.ceil(reducedDays)} days`,
            color: "red",
          });
        }
        // Add deletion timer to notifications
        if (user?.deletionAt) {
          notifications?.push({
            href: "/profile",
            name: "Being deleted",
            color: "red",
          });
        }
        // Is in combat
        if (user.status === "BATTLE") {
          notifications?.push({
            href: "/combat",
            name: "In combat",
            color: "red",
          });
        }
        // Is in hospital
        if (user.status === "HOSPITALIZED") {
          notifications?.push({
            href: "/hospital",
            name: "In hospital",
            color: "red",
          });
        }
        // Stuff in inbox
        if (user.inboxNews > 0) {
          notifications?.push({
            href: "/inbox",
            name: `${user.inboxNews} messages`,
            color: "hidden",
            notificationCount: user.inboxNews,
          });
        }
        // Stuff in news
        if (user.unreadNews > 0) {
          notifications?.push({
            href: "/news",
            name: `${user.unreadNews} news`,
            color: "hidden",
            notificationCount: user.unreadNews,
          });
        }
        if (user.unreadNotifications > 0) {
          const [unread] = await Promise.all([
            ctx.drizzle.query.notification.findMany({
              limit: user.unreadNotifications,
              orderBy: desc(notification.createdAt),
            }),
            ctx.drizzle
              .update(userData)
              .set({ unreadNotifications: 0 })
              .where(eq(userData.userId, ctx.userId)),
          ]);
          unread?.forEach((n) => {
            notifications?.push({
              href: "/news",
              name: n.content,
              color: "toast",
            });
          });
        }
      }
      return {
        userData: user,
        notifications: notifications,
        serverTime: Date.now(),
        userAgent: ctx.userAgent,
      };
    }),
  // Get an AI
  getAi: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get AI character details by ID" } })
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      const user = await ctx.drizzle.query.userData.findFirst({
        where: and(eq(userData.userId, input.userId), eq(userData.isAi, true)),
        with: { jutsus: { with: { jutsu: true } }, items: { with: { item: true } } },
      });
      // Filter off entries that do not exist
      if (user) {
        user.jutsus = user.jutsus.filter((j) => j.jutsu);
        user.items = user.items.filter((i) => i.item);
      }
      // Return user
      return user ?? null;
    }),
  // Create new AI
  create: protectedProcedure
    .meta({
      mcp: {
        enabled: true,
        description: "Create a new AI character (content editors)",
      },
    })
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (canChangeContent(user.role)) {
        const id = nanoid();
        await ctx.drizzle.insert(userData).values({
          userId: id,
          username: `New AI - ${id}`,
          gender: "Unknown",
          avatar: IMG_AVATAR_DEFAULT,
          avatarLight: IMG_AVATAR_DEFAULT,
          villageId: null,
          approvedTos: true,
          sector: 0,
          level: 100,
          isAi: true,
        });
        return { success: true, message: id };
      } else {
        return { success: false, message: `Not allowed to create AI` };
      }
    }),
  // Clone an existing AI
  cloneAi: protectedProcedure
    .meta({
      mcp: {
        enabled: true,
        description: "Clone an existing AI character (content editors)",
      },
    })
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, aiData, jutsuData, itemData, nindoData] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.userData.findFirst({
          where: eq(userData.userId, input.id),
        }),
        ctx.drizzle.query.userJutsu.findMany({
          where: eq(userJutsu.userId, input.id),
        }),
        ctx.drizzle.query.userItem.findMany({ where: eq(userItem.userId, input.id) }),
        ctx.drizzle.query.userNindo.findFirst({
          where: eq(userNindo.userId, input.id),
        }),
      ]);
      // Guard
      if (!aiData) return errorResponse("AI not found");
      if (!aiData.isAi) return errorResponse("Not an AI");
      if (!canChangeContent(user.role)) return errorResponse("Not allowed");

      // Create new AI with copied data
      aiData.userId = nanoid();
      aiData.username = `${aiData.username} - copy`;
      aiData.createdAt = new Date();
      aiData.updatedAt = new Date();
      // Run all inserts at once
      await Promise.all([
        ctx.drizzle.insert(userData).values(aiData),
        ...(jutsuData.length > 0
          ? [
              ctx.drizzle.insert(userJutsu).values(
                jutsuData.map((jutsu) => ({
                  id: nanoid(),
                  userId: aiData.userId,
                  jutsuId: jutsu.jutsuId,
                  level: jutsu.level,
                })),
              ),
            ]
          : []),
        ...(itemData.length > 0
          ? [
              ctx.drizzle.insert(userItem).values(
                itemData.map((item) => ({
                  id: nanoid(),
                  userId: aiData.userId,
                  itemId: item.itemId,
                  quantity: item.quantity,
                })),
              ),
            ]
          : []),
        ...(nindoData ? [ctx.drizzle.insert(userNindo).values(nindoData)] : []),
      ]);

      return { success: true, message: aiData.userId };
    }),
  // Delete a AI
  delete: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Delete an AI character (content editors)" },
    })
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      const ai = await fetchUser(ctx.drizzle, input.id);
      if (ai?.isAi && canChangeContent(user.role)) {
        await deleteUser(ctx.drizzle, ai.userId);
        return { success: true, message: `AI deleted` };
      } else {
        return { success: false, message: `Not allowed to delete AI` };
      }
    }),
  // Update user
  updateUser: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Update user profile data (content editors)" },
    })
    .input(z.object({ id: z.string(), data: updateUserSchema }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Queries
      const [user, target, village] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.userData.findFirst({
          where: eq(userData.userId, input.id),
          with: { jutsus: true, items: true },
        }),
        fetchVillage(ctx.drizzle, input.data?.villageId || VILLAGE_SYNDICATE_ID),
      ]);
      // Basic existence guards
      if (!village) return errorResponse("Village not found");
      if (!target) return errorResponse("User not found");
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      // Roles that can only edit themselves
      if (canOnlyEditSelf(user.role) && user.userId !== target.userId) {
        return errorResponse("You can only edit your own profile");
      }

      // Prepare jutsu & item id arrays for permission checks and later DB update
      const oldJutsuIds = target.jutsus.map((j) => j.jutsuId);
      const newJutsuIds = input.data.jutsus ?? [];
      const oldItemIds = target.items.map((i) => i.itemId);
      const newItemIds = input.data.items ?? [];

      // Guard attribute-by-attribute permissions
      const usernameChanged = input.data.username !== target.username;
      if (usernameChanged && !canEditUsername(user.role)) {
        return errorResponse("Not allowed to change username");
      }

      const customTitleChanged =
        input.data.customTitle !== undefined &&
        input.data.customTitle !== target.customTitle;
      if (customTitleChanged && !canEditCustomTitle(user.role)) {
        return errorResponse("Not allowed to change custom title");
      }

      const bloodlineChanged = input.data.bloodlineId !== target.bloodlineId;
      if (bloodlineChanged && !canEditBloodline(user.role)) {
        return errorResponse("Not allowed to change bloodline");
      }
      const bloodlineReskinChanged =
        "bloodlineReskinId" in input.data &&
        input.data.bloodlineReskinId !== target.bloodlineReskinId;
      if (bloodlineReskinChanged && !canEditBloodline(user.role)) {
        return errorResponse("Not allowed to change bloodline reskin");
      }

      const villageChanged = village.id !== target.villageId;
      if (villageChanged && !canEditVillage(user.role)) {
        return errorResponse("Not allowed to change village");
      }

      const rankChanged = input.data.rank !== target.rank;
      if (rankChanged && !canEditRank(user.role)) {
        return errorResponse("Not allowed to change rank");
      }

      const staffAccountChanged =
        input.data.staffAccount !== undefined &&
        input.data.staffAccount !== target.staffAccount;
      if (staffAccountChanged && !canEditStaffAccountFlag(user.role)) {
        return errorResponse("Not allowed to toggle staff account flag");
      }

      const rankedLpChanged =
        input.data.rankedLp !== undefined && input.data.rankedLp !== target.rankedLp;
      if (rankedLpChanged && !canEditRankedLp(user.role)) {
        return errorResponse("Not allowed to change ranked LP");
      }

      // Check permissions for jutsus/items before performing updates
      const jutsuChanged =
        newJutsuIds.slice().sort().join(",") !== oldJutsuIds.slice().sort().join(",");
      if (jutsuChanged && !canEditJutsus(user.role)) {
        return errorResponse("Not allowed to modify jutsus");
      }

      const itemChanged =
        newItemIds.slice().sort().join(",") !== oldItemIds.slice().sort().join(",");
      if (itemChanged && !canEditItems(user.role)) {
        return errorResponse("Not allowed to modify items");
      }

      // Role-change permissions (availableRoles) still apply below
      const roleChanged = input.data.role !== target.role;
      const availableRoles = canChangeUserRolesTo(user.role);
      if (roleChanged && !availableRoles.includes(target.role)) {
        return errorResponse(`Not allowed to change: ${target.role}`);
      }
      if (roleChanged && !availableRoles.includes(input.data.role)) {
        return errorResponse(`Only available roles: ${availableRoles.join(", ")}`);
      }
      // Block promoting USER to staff role - must go through application process
      // Demotions (to USER) are allowed without restrictions
      // CODING-ADMIN can bypass this restriction
      if (
        roleChanged &&
        input.data.role !== "USER" &&
        target.role === "USER" &&
        user.role !== "CODING-ADMIN"
      ) {
        return errorResponse(
          "Promotion of users to staff must go through the staff application process. See manual.",
        );
      }
      if (village.id !== target.villageId) {
        const clanName = target.isOutlaw ? "Faction" : "Clan";
        if (target.anbuId) return errorResponse("Leave ANBU first");
        if (target.clanId) return errorResponse(`Leave ${clanName} first`);
        if (target.status !== "AWAKE") return errorResponse("AWAKE to change village");
      }
      // Update jutsus & items
      const { jutsuChanges, itemChanges } = await updateUserContent({
        client: ctx.drizzle,
        userId: target.userId,
        oldJutsuIds,
        newJutsuIds,
        oldItemIds,
        newItemIds,
      });
      // Calculate diff
      delete input.data.jutsus;
      delete input.data.items;
      const diff = calculateContentDiff(
        Object.fromEntries(
          Object.entries(target).filter(([k]) => Object.keys(input.data).includes(k)),
        ),
        input.data,
      )
        .concat(jutsuChanges)
        .concat(itemChanges);
      // AI moderation of reason
      const aiCheck = await validateUserUpdateReason(
        diff.join(". "),
        input.data.reason,
      );
      if (!aiCheck.allowUpdate) {
        await ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "user",
          changes: [],
          relatedId: target.userId,
          relatedMsg: `Updated attempted. Reason rejected by AI: ${input.data.reason}`,
          relatedImage: target.avatarLight,
        });
        return errorResponse(aiCheck.comment);
      }

      // Update database
      await Promise.all([
        ctx.drizzle
          .update(userData)
          .set({
            userId: target.userId,
            ...(usernameChanged ? { username: input.data.username } : {}),
            ...(customTitleChanged ? { customTitle: input.data.customTitle } : {}),
            ...(bloodlineChanged ? { bloodlineId: input.data.bloodlineId } : {}),
            ...(villageChanged ? { villageId: input.data.villageId } : {}),
            ...(rankChanged ? { rank: input.data.rank } : {}),
            ...(bloodlineReskinChanged
              ? { bloodlineReskinId: input.data.bloodlineReskinId ?? null }
              : {}),
            ...(staffAccountChanged ? { staffAccount: input.data.staffAccount } : {}),
            ...(rankedLpChanged ? { rankedLp: input.data.rankedLp } : {}),
            ...(roleChanged ? { role: input.data.role } : {}),
            ...(villageChanged
              ? {
                  isOutlaw: village.type === "OUTLAW",
                  sector: village.sector,
                  longitude: ALLIANCEHALL_LONG,
                  latitude: ALLIANCEHALL_LAT,
                }
              : {}),
          })
          .where(eq(userData.userId, target.userId)),
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "user",
          changes: diff,
          relatedId: target.userId,
          relatedMsg: input.data.reason,
          relatedImage: target.avatarLight,
        }),
      ]);
      return { success: true, message: `Data updated: ${diff.join(". ")}` };
    }),
  // Update a AI
  updateAi: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Update AI character data (content editors)" },
    })
    .input(z.object({ id: z.string(), data: insertAiSchema }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Set empty strings to null
      setEmptyStringsToNulls(input.data);
      input.data.customTitle = input.data.customTitle ?? "";

      // Queries
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      const ai = await ctx.drizzle.query.userData.findFirst({
        where: eq(userData.userId, input.id),
        with: { jutsus: true, items: true },
      });

      // Guards
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!ai) return errorResponse("AI not found");
      if (!ai.isAi) return errorResponse("Not an AI");
      if (!canChangeContent(user.role)) return errorResponse("Not allowed");

      // Update jutsus & items
      // Extract new item ids from ids-with-number array
      const itemIdWithChance = (input.data.items ?? []).flatMap((o) =>
        o.ids.map((id) => ({ id, chance: o.number })),
      );
      const newItemIds = itemIdWithChance.map((x) => x.id);

      const { jutsuChanges, itemChanges } = await updateUserContent({
        client: ctx.drizzle,
        userId: ai.userId,
        oldJutsuIds: ai.jutsus.map((j) => j.jutsuId),
        newJutsuIds: input.data.jutsus ?? [],
        oldItemIds: ai.items.map((j) => j.itemId),
        newItemIds,
      });
      delete input.data.jutsus;
      delete input.data.items;

      // Update input data based on level
      const newAi = { ...ai, ...input.data } as UserData;

      // Level-based stats / pools
      scaleUserStats(newAi);

      // Calculate diff
      const oldContent = Object.fromEntries(
        Object.entries(ai).filter(([k]) => Object.keys(input.data).includes(k)),
      );
      const newContent = Object.fromEntries(
        Object.entries(newAi).filter(([k]) => Object.keys(input.data).includes(k)),
      );
      const diff = calculateContentDiff(oldContent, newContent)
        .concat(jutsuChanges)
        .concat(itemChanges);

      // Update database
      await Promise.all([
        ctx.drizzle.update(userData).set(newAi).where(eq(userData.userId, input.id)),
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "ai",
          changes: diff,
          relatedId: ai.userId,
          relatedMsg: `Update: ${ai.username}`,
          relatedImage: ai.avatar,
        }),
        ...itemIdWithChance.map(({ id, chance }) =>
          ctx.drizzle
            .update(userItem)
            .set({ dropChancePerc: chance })
            .where(and(eq(userItem.userId, ai.userId), eq(userItem.itemId, id))),
        ),
      ]);

      // Update discord channel
      if (process.env.NODE_ENV !== "development") {
        await callDiscordContent(user.username, ai.username, diff, ai.avatar);
      }
      return { success: true, message: `Data updated: ${diff.join(". ")}` };
    }),
  // Get user attributes
  getUserAttributes: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get user's character attributes" } })
    .query(async ({ ctx }) => {
      return fetchAttributes(ctx.drizzle, ctx.userId);
    }),
  // Check if username exists in database already
  getUsername: publicProcedure
    .meta({ mcp: { enabled: true, description: "Check if a username is taken" } })
    .input(
      z.object({
        username: z.string().trim(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const username = await ctx.drizzle.query.userData.findFirst({
        columns: { username: true, userId: true },
        where: eq(userData.username, input.username),
      });
      return username || null;
    }),
  // Update username
  updateUsername: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Change user's username for reputation cost" },
    })
    .input(z.object({ username: usernameSchema }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, target] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.userData.findFirst({
          columns: { username: true },
          where: eq(userData.username, input.username),
        }),
      ]);
      // Guard
      if (user.username === input.username) {
        return errorResponse("Username is the same");
      }
      if (user.reputationPoints < COST_CHANGE_USERNAME) {
        return errorResponse("Not enough reputation points");
      }
      if (user.isBanned) return errorResponse("You are banned");
      if (target) return errorResponse("Username already taken");
      // Mutate
      const result = await ctx.drizzle
        .update(userData)
        .set({
          username: input.username,
          reputationPoints: sql`reputationPoints - ${COST_CHANGE_USERNAME}`,
        })
        .where(eq(userData.userId, ctx.userId));
      if (result.rowsAffected === 0) {
        return { success: false, message: "Could not update user" };
      } else {
        await ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "user",
          changes: [`Username changed from ${user.username} to ${input.username}`],
          relatedId: ctx.userId,
          relatedMsg: `Update: ${user.username} -> ${input.username}`,
          relatedImage: user.avatarLight,
        });
        return { success: true, message: "Username updated" };
      }
    }),
  // Use earned experience points for stats
  useUnusedExperiencePoints: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Assign earned experience to stats" } })
    .input(createStatSchema(0, 0).schema)
    .output(
      baseServerResponse.extend({
        data: z
          .object({
            ninjutsuOffence: z.number(),
            taijutsuOffence: z.number(),
            genjutsuOffence: z.number(),
            bukijutsuOffence: z.number(),
            ninjutsuDefence: z.number(),
            taijutsuDefence: z.number(),
            genjutsuDefence: z.number(),
            bukijutsuDefence: z.number(),
            strength: z.number(),
            speed: z.number(),
            intelligence: z.number(),
            willpower: z.number(),
            experience: z.number(),
            earnedExperience: z.number(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Derived
      const inputSum = Object.values(input).reduce(
        (a, b) => Math.floor(a) + Math.floor(b),
        0,
      );
      // Guard
      if (inputSum <= 0) return errorResponse("No stats to assign");
      if (user.earnedExperience <= 0) return errorResponse("No experience left");
      if (inputSum > user.earnedExperience) {
        return errorResponse("Trying to assign more stats than available");
      }
      // Mutate & cap
      user.ninjutsuOffence += Math.floor(input.ninjutsuOffence);
      user.taijutsuOffence += Math.floor(input.taijutsuOffence);
      user.genjutsuOffence += Math.floor(input.genjutsuOffence);
      user.bukijutsuOffence += Math.floor(input.bukijutsuOffence);
      user.ninjutsuDefence += Math.floor(input.ninjutsuDefence);
      user.taijutsuDefence += Math.floor(input.taijutsuDefence);
      user.genjutsuDefence += Math.floor(input.genjutsuDefence);
      user.bukijutsuDefence += Math.floor(input.bukijutsuDefence);
      user.strength += Math.floor(input.strength);
      user.speed += Math.floor(input.speed);
      user.intelligence += Math.floor(input.intelligence);
      user.willpower += Math.floor(input.willpower);
      capUserStats(user);
      // Update
      const data = {
        ninjutsuOffence: user.ninjutsuOffence,
        taijutsuOffence: user.taijutsuOffence,
        genjutsuOffence: user.genjutsuOffence,
        bukijutsuOffence: user.bukijutsuOffence,
        ninjutsuDefence: user.ninjutsuDefence,
        taijutsuDefence: user.taijutsuDefence,
        genjutsuDefence: user.genjutsuDefence,
        bukijutsuDefence: user.bukijutsuDefence,
        strength: user.strength,
        speed: user.speed,
        intelligence: user.intelligence,
        willpower: user.willpower,
        experience: user.experience + inputSum,
        earnedExperience: user.earnedExperience - inputSum,
      };
      const result = await ctx.drizzle
        .update(userData)
        .set(data)
        .where(
          and(
            eq(userData.userId, ctx.userId),
            gte(userData.earnedExperience, inputSum),
          ),
        );
      if (result.rowsAffected === 0) {
        return errorResponse("Could not update user");
      } else {
        return { success: true, message: "User stats updated", data };
      }
    }),
  // Get nindo text of user
  getNindo: publicProcedure
    .meta({
      mcp: { enabled: true, description: "Get user's nindo (way of ninja) text" },
    })
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      const nindo = await ctx.drizzle.query.userNindo.findFirst({
        where: eq(userNindo.userId, input.userId),
      });
      return nindo ? nindo.content : "";
    }),
  // Update nindo
  updateNindo: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Update user's nindo text" } })
    .input(mutateContentSchema.extend({ userId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (user.isBanned) return errorResponse("You are banned");
      if (user.isSilenced) return errorResponse("You are silenced");
      if (ctx.userId !== input.userId && !canSeeSecretData(user.role)) {
        return errorResponse("You can't change for other users");
      }
      // Mutate
      return updateNindo(ctx.drizzle, input.userId, input.content, "userNindo");
    }),
  // Insert attribute
  insertAttribute: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Add a character attribute to user" } })
    .input(
      z.object({
        attribute: z.enum([...attributes, "Hair", "Skin", "Eyes"]),
        color: z.enum([...colors, ...skin_colors]).optional(),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const existingAttributes = await fetchAttributes(ctx.drizzle, ctx.userId);
      // Construct the attribute name
      const name =
        ["Hair", "Skin", "Eyes"].includes(input.attribute) && input.color
          ? `${input.color} ${input.attribute}`
          : input.attribute;
      // Guards
      if (existingAttributes.length >= MAX_ATTRIBUTES) {
        return errorResponse(`Only ${MAX_ATTRIBUTES} attributes allowed`);
      }
      if (existingAttributes.some((attr) => attr.attribute === name)) {
        return errorResponse(`You already have the attribute "${name}"`);
      }
      // Mutate - use onDuplicateKeyUpdate to handle race conditions
      const result = await ctx.drizzle
        .insert(userAttribute)
        .values({
          id: nanoid(),
          userId: ctx.userId,
          attribute: name,
        })
        .onDuplicateKeyUpdate({ set: { id: sql`id` } });
      if (result.rowsAffected === 0) {
        return { success: false, message: "Failed to insert attribute" };
      } else {
        return { success: true, message: "Attribute inserted" };
      }
    }),
  // Delete attribute
  deleteAttribute: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Remove a character attribute from user" },
    })
    .input(z.object({ attribute: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.drizzle
        .delete(userAttribute)
        .where(
          and(
            eq(userAttribute.attribute, input.attribute),
            eq(userAttribute.userId, ctx.userId),
          ),
        );
      if (result.rowsAffected === 0) {
        return { success: false, message: "Failed to delete attribute" };
      } else {
        return { success: true, message: "Attribute deleted" };
      }
    }),
  // Return list of 5 most similar users in database
  searchUsers: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Search users by username" } })
    .input(
      z.object({
        username: z.string().trim(),
        showYourself: z.boolean(),
        showAi: z.boolean(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.drizzle.query.userData.findMany({
        columns: {
          userId: true,
          username: true,
          avatar: true,
          rank: true,
          isOutlaw: true,
          level: true,
          role: true,
          federalStatus: true,
          isAi: true,
        },
        where: and(
          like(userData.username, `%${input.username}%`),
          eq(userData.approvedTos, true),
          ...(input.showAi ? [] : [eq(userData.isAi, false)]),
          ...(input.showYourself ? [] : [sql`${userData.userId} != ${ctx.userId}`]),
        ),
        orderBy: [sql`LENGTH(${userData.username}) asc`],
        limit: 5,
      });
    }),
  // Get public information on a user
  getPublicUser: publicProcedure
    .meta({ mcp: { enabled: true, description: "Get public profile info for a user" } })
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Query
      const [requester, user] = await Promise.all([
        ctx.drizzle.query.userData.findFirst({
          where: eq(userData.userId, ctx.userId ?? ""),
          columns: { role: true },
        }),
        ctx.drizzle.query.userData.findFirst({
          where: and(eq(userData.userId, input.userId)),
          columns: {
            aiProfileId: true,
            avatar: true,
            avatarLight: true,
            bloodlineId: true,
            curChakra: true,
            curHealth: true,
            curStamina: true,
            customTitle: true,
            deletionAt: true,
            earnedExperience: true,
            experience: true,
            federalStatus: true,
            gender: true,
            isAi: true,
            isBanned: true,
            isSilenced: true,
            isOutlaw: true,
            lastIp: true,
            level: true,
            maxChakra: true,
            maxHealth: true,
            maxStamina: true,
            movedTooFastCount: true,
            pveFights: true,
            rank: true,
            rankedLp: true,
            reputationPoints: true,
            role: true,
            senseiId: true,
            status: true,
            userId: true,
            username: true,
            villageId: true,
            tavernMessages: true,
            staffAccount: true,
            bloodlineReskinId: true,
          },
          with: {
            village: true,
            bloodline: true,
            nindo: true,
            clan: true,
            jutsus: { with: { jutsu: { columns: { id: true, name: true } } } },
            items: { with: { item: { columns: { id: true, name: true } } } },
            badges: { with: { badge: true } },
            activeReskin: true,
            recruitedUsers: {
              columns: {
                userId: true,
                username: true,
                level: true,
                rank: true,
                isOutlaw: true,
                avatar: true,
              },
            },
            students: {
              columns: {
                userId: true,
                username: true,
                level: true,
                rank: true,
                isOutlaw: true,
                avatar: true,
              },
            },
            sensei: {
              columns: {
                userId: true,
                username: true,
              },
            },
            anbuSquad: {
              columns: {
                name: true,
              },
            },
            battleHistory: {
              columns: {
                battleType: true,
                createdAt: true,
              },
              where: and(
                eq(battleHistory.attackedId, input.userId),
                notInArray(battleHistory.battleType, ["SPARRING", "COMBAT"]),
                gte(battleHistory.createdAt, getTimeOfLastReset()),
              ),
            },
          },
        }),
      ]);
      // Guard
      if (!user) return null;
      // Hide secrets
      const isSelf = ctx.userId === user.userId;
      if (!isSelf && (!requester || !canSeeSecretData(requester.role))) {
        user.earnedExperience = 8008;
        user.isBanned = false;
        user.aiProfileId = null;
      }
      if (!isSelf && requester?.role === "USER") {
        user.jutsus = [];
        user.items = [];
      }
      if (!requester || !canSeeIps(requester.role)) {
        user.lastIp = "hidden";
      }
      if (user.bloodline && user.activeReskin) {
        user.bloodline = getReskinnedBloodline(user.bloodline, user.activeReskin);
      }
      // Filter off entries that do not exist
      user.jutsus = user.jutsus.filter((j) => j.jutsu);
      user.items = user.items.filter((i) => i.item);
      // If no avatarLight version, create one
      if (!user.avatarLight && user.avatar) {
        const thumbnail = await createThumbnail(user.avatar);
        await ctx.drizzle
          .update(userData)
          .set({ avatarLight: thumbnail })
          .where(eq(userData.userId, user.userId));
      }
      // Return
      return user;
    }),
  countOnlineUsers: publicProcedure
    .meta({
      mcp: { enabled: true, description: "Get count of currently online users" },
    })
    .query(async ({ ctx }) => {
      // Fetch
      const [current, daily, maxOnline] = await Promise.all([
        ctx.drizzle
          .select({ count: count() })
          .from(userData)
          .where(gte(userData.updatedAt, secondsFromNow(-1800))), // 30 minutes = 1800 seconds
        ctx.drizzle
          .select({ count: count() })
          .from(userData)
          .where(gte(userData.updatedAt, secondsFromNow(-3600 * 24))),
        getGameSetting(ctx.drizzle, "onlineUsers"),
      ]);
      // Derived
      const onlineNow = current?.[0]?.count ?? 0;
      const onlineDay = daily?.[0]?.count ?? 0;
      const newMax = maxOnline.value < onlineNow;
      if (newMax) {
        await updateGameSetting(ctx.drizzle, "onlineUsers", onlineNow, new Date());
      }
      // Return
      return { onlineNow, onlineDay, maxOnline: newMax ? onlineNow : maxOnline.value };
    }),
  // Get public users
  getPublicUsers: publicProcedure
    .meta({
      mcp: { enabled: true, description: "Get paginated list of users with filters" },
    })
    .input(getPublicUsersSchema)
    .query(async ({ ctx, input }) => {
      return fetchPublicUsers({ client: ctx.drizzle, input, userId: ctx.userId });
    }),

  // Get recruitment rewards for current user
  getRecruitmentRewards: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Get user's recruitment bonus history" },
    })
    .input(
      z.object({
        cursor: z.number().nullish(),
        limit: z.number().min(1).max(500),
      }),
    )
    .query(async ({ ctx, input }) => {
      const currentCursor = input.cursor ?? 0;
      const skip = currentCursor * input.limit;
      const results = await ctx.drizzle.query.recruitmentRewards.findMany({
        where: eq(recruitmentRewards.userId, ctx.userId),
        with: {
          recruitedUser: {
            columns: { userId: true, username: true, avatar: true },
          },
        },
        offset: skip,
        limit: input.limit,
        orderBy: desc(recruitmentRewards.createdAt),
      });
      const nextCursor = results.length < input.limit ? null : currentCursor + 1;
      return { data: results, nextCursor };
    }),
  // Toggle deletion of user
  toggleDeletionTimer: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, target] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.userId),
      ]);
      // Guard
      if (target.isBanned || target.isSilenced) {
        return errorResponse("User has to serve the ban/silence first");
      }
      if (ctx.userId !== input.userId && !canDeleteUsers(user.role)) {
        return errorResponse("You can't delete other users");
      }
      // Muate
      await ctx.drizzle
        .update(userData)
        .set({
          deletionAt: target.deletionAt ? null : new Date(Date.now() + 2 * 86400000),
        })
        .where(eq(userData.userId, input.userId));
      return { success: true, message: "Deletion timer toggled" };
    }),
  // Delete user
  confirmDeletion: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Confirm and execute account deletion" },
    })
    .input(z.object({ userId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, target] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.userId),
      ]);
      // Guard
      if (!target.deletionAt || target.deletionAt > new Date()) {
        return errorResponse("Deletion timer not passed yet");
      }
      if (target.isBanned || target.isSilenced) {
        return errorResponse("You have to serve your ban first");
      }
      if (ctx.userId !== input.userId && !canSeeSecretData(user.role)) {
        return errorResponse("You can't delete other users");
      }
      if (target.anbuId) {
        return errorResponse("Please leave ANBU first.");
      }
      if (target.clanId) {
        return errorResponse("Please leave clan or faction first.");
      }
      // Mutate
      await deleteUser(ctx.drizzle, input.userId);
      return { success: true, message: "User deleted" };
    }),
  claimVotes: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Claim reputation points for voting" } })
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      // Get user's vote record
      const userVoteRecord = await ctx.drizzle.query.userVote.findFirst({
        where: eq(userVote.userId, ctx.userId),
      });
      // Guard
      if (!userVoteRecord) {
        return errorResponse("No vote record found");
      }
      const completedVotes = ACTIVE_VOTING_SITES.every((site) => userVoteRecord[site]);
      if (!completedVotes) {
        return errorResponse("Not all votes are completed");
      }
      if (userVoteRecord.claimed) {
        return errorResponse("Votes already claimed");
      }
      // Update user's reputation points and mark votes as claimed
      const smallNanoid = customAlphabet(
        "1234567890abcdefghijklmnopqrstuvwxyzABCDEF",
        8,
      );
      const result = await ctx.drizzle
        .update(userVote)
        .set({
          claimed: true,
          totalClaims: sql`${userVote.totalClaims} + 1`,
          secret: smallNanoid(),
        })
        .where(eq(userVote.userId, ctx.userId));
      if (result.rowsAffected === 0) {
        return errorResponse("Failed to update user vote record");
      }
      await ctx.drizzle
        .update(userData)
        .set({
          reputationPoints: sql`${userData.reputationPoints} + 1`,
          reputationPointsTotal: sql`${userData.reputationPointsTotal} + 1`,
        })
        .where(eq(userData.userId, ctx.userId));

      return {
        success: true,
        message: "Successfully claimed reputation points for voting",
      };
    }),
  // Award experience to a user (staff only)
  awardExperience: protectedProcedure
    .input(
      z.object({
        targetUserId: z.string(),
        amount: z.number().min(1).max(100000),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [awarder, target] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.targetUserId),
      ]);

      // Guards
      if (!awarder || !target) {
        return errorResponse("User not found");
      }

      if (awarder.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!canAwardExperience(awarder)) {
        return errorResponse("You don't have permission to award experience");
      }

      // Mutation
      const result = await ctx.drizzle
        .update(userData)
        .set({
          earnedExperience: sql`${userData.earnedExperience} + ${input.amount}`,
        })
        .where(eq(userData.userId, input.targetUserId));

      if (result.rowsAffected === 0) {
        return errorResponse("Failed to award experience");
      }

      // Log the action
      await ctx.drizzle.insert(actionLog).values({
        id: nanoid(),
        userId: ctx.userId,
        tableName: "user",
        changes: [`Awarded ${input.amount} experience points`],
        relatedId: target.userId,
        relatedMsg: `Experience awarded to ${target.username}`,
        relatedImage: target.avatarLight,
      });

      return {
        success: true,
        message: `Awarded ${input.amount} experience points to ${target.username}`,
      };
    }),
  // Award experience to all users (staff only)
  awardExperienceToAll: protectedProcedure
    .input(
      z.object({
        amount: z.number().min(1).max(100000),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const awarder = await fetchUser(ctx.drizzle, ctx.userId);

      // Guards
      if (awarder.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!canAwardExperience(awarder)) {
        return errorResponse("You don't have permission to award experience");
      }

      // Mutation - update all users
      const result = await ctx.drizzle.update(userData).set({
        earnedExperience: sql`${userData.earnedExperience} + ${input.amount}`,
      });

      if (result.rowsAffected === 0) {
        return errorResponse("Failed to award experience to users");
      }

      // Log the action
      await ctx.drizzle.insert(actionLog).values({
        id: nanoid(),
        userId: ctx.userId,
        tableName: "user",
        changes: [`Mass awarded ${input.amount} experience points to all users`],
        relatedId: null,
        relatedMsg: `Mass experience awarded`,
        relatedImage: awarder.avatarLight,
      });

      return {
        success: true,
        message: `Awarded ${input.amount} experience points to all users`,
      };
    }),
});

export const updateNindo = async (
  client: DrizzleClient,
  userId: string,
  content: string,
  type: "userNindo" | "clanOrder" | "anbuOrder" | "kageOrder",
) => {
  const nindo = await client.query.userNindo.findFirst({
    where: eq(userNindo.userId, userId),
  });
  const sanitized = sanitize(content);
  await Promise.all([
    moderateContent(client, {
      content: sanitized,
      userId: userId,
      relationType: type,
      relationId: userId,
    }),
    nindo
      ? client
          .update(userNindo)
          .set({ content: content })
          .where(eq(userNindo.userId, userId))
      : client.insert(userNindo).values({
          id: nanoid(),
          userId: userId,
          content: content,
        }),
  ]);
  return { success: true, message: "Content updated" };
};

/**
 * Fetch a user by id
 * @param client - The database client
 * @param userId - The id of the user
 * @returns The user
 *
 * NOTE: This function is used across the codebase. Use fetchUpdatedUser
 * if more information is required on the user object, so that we keep this method "light"
 */
export const fetchUser = async (client: DrizzleClient, userId: string) => {
  const user = await client.query.userData.findFirst({
    where: eq(userData.userId, userId),
  });
  if (!user) {
    throw serverError(
      "NOT_FOUND",
      `User not found: ${userId}. Please complete registration.`,
    );
  }
  return user;
};

export const updateUserContent = async (props: {
  client: DrizzleClient;
  userId: string;
  oldJutsuIds: string[];
  newJutsuIds: string[];
  oldItemIds: string[];
  newItemIds: string[];
}) => {
  // Destructure
  const { client, userId, oldJutsuIds, newJutsuIds, oldItemIds, newItemIds } = props;

  // Store any new jutsus
  const newJ = oldJutsuIds.sort().join(",") !== newJutsuIds.sort().join(",");
  const newI = oldItemIds.sort().join(",") !== newItemIds.sort().join(",");

  // difference arrays
  let jutsuChanges: string[] = [];
  let itemChanges: string[] = [];

  // If jutsus are different, then update with jutsu names for diff calculation only
  if (newJ || newI) {
    const [jutsuData, itemData] = await Promise.all([
      client.query.jutsu.findMany({
        where: inArray(jutsu.id, oldJutsuIds.concat(newJutsuIds).concat(["non-empty"])),
        columns: { id: true, name: true },
      }),
      client.query.item.findMany({
        where: inArray(item.id, oldItemIds.concat(newItemIds).concat(["non-empty"])),
        columns: { id: true, name: true },
      }),
    ]);
    jutsuChanges = calculateContentDiff(
      { jutsus: oldJutsuIds.map((id) => jutsuData.find((j) => j.id === id)?.name) },
      { jutsus: newJutsuIds.map((id) => jutsuData.find((j) => j.id === id)?.name) },
    );
    itemChanges = calculateContentDiff(
      { items: oldItemIds.map((id) => itemData.find((j) => j.id === id)?.name) },
      { items: newItemIds.map((id) => itemData.find((j) => j.id === id)?.name) },
    );

    // Updated content
    const deletedJ = oldJutsuIds.filter((id) => !newJutsuIds.includes(id));
    const deletedI = oldItemIds.filter((id) => !newItemIds.includes(id));
    const insertedJ = newJutsuIds.filter((id) => !oldJutsuIds.includes(id));
    const insertedI = newItemIds.filter((id) => !oldItemIds.includes(id));

    // Run updates
    await Promise.all([
      ...(deletedJ.length > 0
        ? [
            client
              .delete(userJutsu)
              .where(
                and(eq(userJutsu.userId, userId), inArray(userJutsu.jutsuId, deletedJ)),
              ),
          ]
        : []),
      ...(deletedI.length > 0
        ? [
            client
              .delete(userItem)
              .where(
                and(eq(userItem.userId, userId), inArray(userItem.itemId, deletedI)),
              ),
          ]
        : []),
      // Use onDuplicateKeyUpdate to handle race conditions
      ...(insertedJ.length > 0
        ? [
            client
              .insert(userJutsu)
              .values(
                insertedJ.map((jutsuId) => ({
                  id: nanoid(),
                  userId: userId,
                  jutsuId: jutsuId,
                  level: 1,
                  equipped: true,
                })),
              )
              .onDuplicateKeyUpdate({ set: { id: sql`id` } }),
          ]
        : []),
      ...(insertedI.length > 0
        ? [
            client.insert(userItem).values(
              insertedI.map((itemId) => ({
                id: nanoid(),
                userId: userId,
                itemId: itemId,
                equipped: "CHEST" as const,
              })),
            ),
          ]
        : []),
    ]);
  }

  return { jutsuChanges, itemChanges };
};

/**
 * Fetch user with bloodline & village relations. Occasionally updates the user with regeneration
 * of pools, or optionally forces regeneration with forceRegen=true
 */
export const fetchUpdatedUser = async (props: {
  client: DrizzleClient;
  userId: string;
  userIp?: string;
  forceRegen?: boolean;
  hideInformation?: boolean;
}) => {
  // Destructure
  const { client, userId, userIp, hideInformation = true } = props;
  let { forceRegen } = props;
  const now = new Date();

  // Ensure we can fetch the user
  const [
    achievements,
    settings,
    user,
    hasUnvotedPolls,
    allActiveWars,
    activeShrineBattles,
    activeRaids,
  ] = await Promise.all([
    client
      .select()
      .from(quest)
      .where(and(eq(quest.questType, "achievement"), eq(quest.hidden, false))),
    client.select().from(gameSetting),
    client.query.userData.findFirst({
      where: eq(userData.userId, userId),
      with: {
        bloodline: true,
        activeReskin: true,
        clan: true,
        village: {
          with: {
            structures: true,
            relationshipA: true,
            relationshipB: true,
            sectors: { columns: { sector: true } },
          },
        },
        anbuSquad: {
          columns: { name: true },
        },
        loadout: {
          columns: { jutsuIds: true },
        },
        promotions: {
          limit: 1,
        },
        items: { where: ne(userItem.equipped, "NONE") },
        userQuests: {
          where: or(
            and(isNull(questHistory.endAt), eq(questHistory.completed, 0)),
            eq(questHistory.questType, "achievement"),
          ),
          with: {
            quest: true,
          },
          orderBy: sql`FIELD(${questHistory.questType}, 'daily', 'tier') ASC`,
        },
        completedQuests: {
          columns: { id: true, questId: true, completed: true },
          where: gte(questHistory.completed, 1),
        },
        votes: true,
      },
    }),
    client
      .select({ id: poll.id })
      .from(poll)
      .leftJoin(
        userPollVote,
        and(eq(userPollVote.pollId, poll.id), eq(userPollVote.userId, userId)),
      )
      .where(
        and(
          eq(poll.isActive, true),
          // Either endDate is null or endDate is in the future
          or(isNull(poll.endDate), sql`${poll.endDate} > ${now}`),
          // User hasn't voted on this poll
          isNull(userPollVote.id),
        ),
      )
      .limit(1),
    // Fetch all active wars for enemy_village sector type resolution
    client.query.war.findMany({
      where: isNull(war.endedAt),
      columns: {
        id: true,
        attackerVillageId: true,
        defenderVillageId: true,
        sector: true,
      },
      with: {
        attackerVillage: { columns: { id: true, sector: true } },
        defenderVillage: { columns: { id: true, sector: true } },
        warAllies: true,
      },
    }),
    // Fetch all active shrine battles (only those where battle hasn't started yet)
    client.query.mpvpBattleQueue.findMany({
      where: and(
        eq(mpvpBattleQueue.battleType, "SHRINE_BATTLE"),
        isNull(mpvpBattleQueue.battleId),
      ),
    }),
    // Fetch all active raids (boss not defeated, not ended)
    client.query.quest.findMany({
      where: and(
        eq(quest.questType, "raid"),
        eq(quest.hidden, false),
        gte(quest.raidBossCurrentHealth, 1),
        or(isNull(quest.raidEndsAt), gte(quest.raidEndsAt, now)),
      ),
    }),
  ]);

  // Reskin bloodline if needed
  if (user?.bloodline && user?.activeReskin) {
    user.bloodline = getReskinnedBloodline(user.bloodline, user.activeReskin);
  }

  // Add votes entry if it doesn't exist
  if (user && !user.votes) {
    const smallNanoid = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyzABCDEF", 8);
    await client.insert(userVote).values({
      id: nanoid(),
      userId: user.userId,
      lastVoteAt: new Date(),
      secret: smallNanoid(),
    });
  }

  // Add in achievements
  if (user) {
    user.userQuests.push(...mockAchievementHistoryEntries(achievements, user));
    user.userQuests = user.userQuests
      .filter((q) => q.quest)
      .filter((q) => isAvailableUserQuests({ ...q.quest, ...q }, user, true).check);
  }

  // Filter and attach active wars for enemy_village sector type resolution
  if (user?.villageId) {
    const userActiveWars = allActiveWars.filter(
      (w) =>
        // Direct participation
        w.attackerVillageId === user.villageId ||
        w.defenderVillageId === user.villageId ||
        // Ally participation
        w.warAllies.some((a) => a.villageId === user.villageId),
    );
    (user as NonNullable<UserWithRelations>).activeWars = userActiveWars;
  }

  // Filter and attach active shrine battles
  if (user?.villageId) {
    const userActiveShrineBattles = activeShrineBattles.filter(
      (b) =>
        b.defenderEntityId === user.villageId || b.attackerEntityId === user.villageId,
    );
    (user as NonNullable<UserWithRelations>).shrineBattles = userActiveShrineBattles;
  }

  // Filter and attach active raids
  if (user) {
    // Get village-owned sectors for exclusive raid filtering
    const ownedSectorNumbers = new Set(
      user.village?.sectors?.map((s) => s.sector) ?? [],
    );

    const userActiveRaids = activeRaids
      .map((raid) => {
        const raidData = getRaidObjectiveData(raid);
        if (!raidData) return null;

        // Open raids are available to everyone
        if (raidData.isOpen) {
          return {
            id: raid.id,
            name: raid.name,
            sector: raidData.sector,
            raidType: "open" as const,
          };
        }

        // Exclusive raids require village sector ownership
        if (raidData.isExclusive && user.villageId && raidData.sector !== null) {
          const ownsCurrentSector = ownedSectorNumbers.has(raidData.sector);

          // Check capture deadline and grace period
          if (raid.raidCaptureDeadline && raid.raidCaptureDeadline < now) {
            if (!raid.raidGracePeriodEnd || raid.raidGracePeriodEnd < now) {
              return null; // Deadline passed, no access
            }
          }

          if (ownsCurrentSector) {
            return {
              id: raid.id,
              name: raid.name,
              sector: raidData.sector,
              raidType: "exclusive" as const,
            };
          }
        }

        return null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    (user as NonNullable<UserWithRelations>).activeRaids = userActiveRaids;
  }

  if (user) {
    // Add bloodline, structure, etc.  regen to regeneration
    user.regeneration = calcActiveUserRegen(user, settings);
  }

  // Handle village prestige situations
  if (user) {
    // If prestige below 0, reset to 0 and move to outlaw faction
    if (user.villagePrestige < 0 && user.village?.type === "VILLAGE") {
      // Check if we need to remove the kage
      const needNewKage =
        user.villageId &&
        user.village?.kageId === user.userId &&
        user.villagePrestige < KAGE_MIN_PRESTIGE;
      // Run queries in parallel for speed
      const [syndicate, clanData, squadData, elder] = await Promise.all([
        client.query.village.findFirst({
          where: eq(village.type, "OUTLAW"),
        }),
        user.clanId ? fetchClan(client, user.clanId) : null,
        user.anbuId ? fetchSquad(client, user.anbuId) : null,
        needNewKage && user.villageId
          ? fetchKageReplacement(client, user.villageId, user.userId)
          : null,
      ]);
      if (syndicate) {
        // Immidiate update of user. Will be effectuated now (forceRegen)
        user.villagePrestige = -user.villagePrestige;
        user.villageId = syndicate.id;
        user.isOutlaw = true;
        forceRegen = true;
        // Trigger message to user
        void pusher.trigger(user.userId, "event", {
          type: "userMessage",
          message: "You have been kicked out of your village due to negative prestige",
          route: "/profile",
          routeText: "To Profile",
        });
        // Queries to be run now
        await Promise.all([
          // Squad updates
          ...(user.anbuId && squadData
            ? [removeFromSquad(client, squadData, user.userId)]
            : []),
          // Clan updates
          ...(user.clanId && clanData
            ? [removeFromClan(client, clanData, user, ["Turned outlaw"])]
            : []),
          // Kage updates
          ...(needNewKage && elder
            ? [
                client
                  .update(village)
                  .set({ kageId: elder.userId, leaderUpdatedAt: new Date() })
                  .where(eq(village.id, user.villageId)),
                client
                  .update(userData)
                  .set({ villagePrestige: KAGE_PRESTIGE_REQUIREMENT })
                  .where(eq(userData.userId, user.userId)),
                pusher.trigger(user.userId, "event", {
                  type: "userMessage",
                  message: `Your prestige dropped below ${KAGE_MIN_PRESTIGE} and you are no longer kage`,
                  route: "/profile",
                  routeText: "To Profile",
                }),
              ]
            : []),
        ]);
      }
    }
  }

  // Ensure that we have a tier quest
  let questTier = user?.userQuests?.find((q) => q.quest.questType === "tier");
  if (!questTier && user) {
    questTier = await insertNextQuest(client, user, "tier");
    if (questTier) {
      forceRegen = true;
    }
  }

  // Ensure that we have an exam quest
  let questExam = user?.userQuests?.find((q) => q.quest.questType === "exam");
  if (!questExam && user) {
    questExam = await insertNextQuest(client, user, "exam");
    if (questExam) {
      forceRegen = true;
    }
  }

  // Rewards, e.g. for activity streak
  const toastMessages: string[] = [];

  // If more than 5min since last user update, update the user with regen. We do not need this to be synchronous
  // and it is mostly done to keep user updated on the overview pages
  if (user && ["AWAKE", "ASLEEP"].includes(user.status)) {
    // Get activity rewards if any & update timers
    const now = new Date();
    const newDay = isDifferentDay(now, user.updatedAt);

    // Check if travel should be completed automatically
    if (user.status === "TRAVEL" && user.travelFinishAt && user.travelFinishAt <= now) {
      user.status = "AWAKE";
      user.travelFinishAt = null;
      forceRegen = true;
      toastMessages.push("You have arrived at your destination!");
    }

    // Figure out if we're running update
    const sinceUpdate = secondsPassed(user.updatedAt);
    if (
      newDay ||
      sinceUpdate > 300 || // Update user in database every 5 minutes only so as to reduce server load
      forceRegen || // Hard overwrite for e.g. debugging or simply ensuring updated user
      (user.villagePrestige < 0 && !user.isOutlaw) // To trigger getting kicked out of village
    ) {
      const regen = (user.regeneration * secondsPassed(user.regenAt)) / REGEN_SECONDS;
      user.curHealth = Math.min(user.curHealth + regen, user.maxHealth);
      user.curStamina = Math.min(user.curStamina + regen, user.maxStamina);
      user.curChakra = Math.min(user.curChakra + regen, user.maxChakra);
      user.updatedAt = now;
      user.regenAt = now;

      // Ensure that the user has elements
      const rankId = UserRanks.indexOf(user.rank);
      if (rankId >= 1 && !user.primaryElement) {
        user.primaryElement = getRandomElement(BasicElementName) ?? null;
      }
      if (rankId >= 2 && !user.secondaryElement) {
        const available = BasicElementName.filter((e) => e !== user.primaryElement);
        user.secondaryElement = getRandomElement(available) ?? null;
      }
      // Update database
      await Promise.all([
        client
          .update(userData)
          .set({
            curHealth: user.curHealth,
            curStamina: user.curStamina,
            curChakra: user.curChakra,
            updatedAt: user.updatedAt,
            regenAt: user.regenAt,
            questData: user.questData,
            money: user.money > RYO_CAP ? RYO_CAP : user.money,
            bank: user.bank > RYO_CAP ? RYO_CAP : user.bank,
            primaryElement: user.primaryElement,
            secondaryElement: user.secondaryElement,
            reputationPoints: user.reputationPoints,
            reputationPointsTotal: user.reputationPointsTotal,
            villagePrestige: user.villagePrestige,
            villageId: user.villageId,
            isOutlaw: user.isOutlaw,
            status: user.status,
            travelFinishAt: user.travelFinishAt,
            ...(userIp ? { lastIp: userIp } : {}),
            medicalExperience: user.medicalExperience,
            craftingExperience: user.craftingExperience,
            huntingExperience: user.huntingExperience,
            gatheringExperience: user.gatheringExperience,
            extraReskinSlots: user.extraReskinSlots,
          })
          .where(eq(userData.userId, userId)),
        ...(userIp && user.lastIp !== userIp
          ? [
              client
                .insert(historicalIp)
                .values({
                  userId: userId,
                  ip: userIp,
                })
                .onDuplicateKeyUpdate({
                  set: { usedAt: new Date() },
                }),
            ]
          : []),
      ]);
    }
  }
  if (user) {
    // Get the latest quest trackers
    const trackerResults = getNewTrackers(user, [{ task: "any" }]);

    // Destructure for local usage
    const { trackers, notifications, consequences } = trackerResults;

    // Update user quest data
    user.questData = trackers;

    // Handle any update on quest consequences
    toastMessages.push(
      ...(await handleQuestConsequences(client, user, consequences, notifications)),
    );

    // Hide information relating to quests
    if (hideInformation) {
      user?.userQuests.forEach((q) => {
        controlShownQuestLocationInformation(q.quest, user);
      });
    }
    return {
      user,
      settings,
      toastMessages,
      hasUnvotedPolls,
      trackerResults,
    };
  } else {
    return {
      user,
      settings,
      toastMessages,
      hasUnvotedPolls,
      trackerResults: null,
    };
  }
};

export const fetchPublicUsers = async (info: {
  client: DrizzleClient;
  input: GetPublicUsersSchema;
  userId?: string | null;
  includeEffects?: boolean;
}) => {
  const { client, input, userId, includeEffects } = info;
  const currentCursor = input.cursor ? input.cursor : 0;
  const skip = currentCursor * input.limit;
  const getOrder = () => {
    switch (input.orderBy) {
      case "Online":
        return [desc(userData.updatedAt)];
      case "Strongest":
        return [desc(userData.level), desc(userData.experience)];
      case "Crafting":
        return [desc(userData.craftingExperience), desc(userData.experience)];
      case "Medical":
        return [desc(userData.medicalExperience), desc(userData.experience)];
      case "PvP":
        return [desc(userData.pvpStreak), desc(userData.experience)];
      case "Ranked":
        return [desc(userData.rankedLp), desc(userData.experience)];
      case "Staff":
        return [desc(userData.tavernMessages)];
      case "Outlaws":
        return [desc(userData.villagePrestige)];
      case "Community":
        return [desc(userData.tavernMessages)];
      case "Dailies":
        return [
          desc(
            sql`${userData.dailyArenaFights} + ${userData.dailyMissions} + ${userData.dailyErrands}`,
          ),
          desc(userData.experience),
        ];
      case "Recruiters":
        // Most efficient: use denormalized counter maintained on userData
        return [desc(userData.nRecruited), desc(userData.experience)];
    }
  };
  const [users, user] = await Promise.all([
    client.query.userData.findMany({
      where: and(
        eq(userData.isAi, input.isAi),
        ...(input.username !== undefined
          ? [like(userData.username, `%${input.username}%`)]
          : []),
        ...(input.bloodline !== undefined
          ? [eq(userData.bloodlineId, input.bloodline)]
          : []),
        ...(input.ip ? [like(userData.lastIp, `%${input.ip}%`)] : []),
        ...(input.village !== undefined ? [eq(userData.villageId, input.village)] : []),
        ...(input.recruiterId ? [eq(userData.recruiterId, input.recruiterId)] : []),
        ...(input.orderBy === "Staff" ? [notInArray(userData.role, ["USER"])] : []),
        ...(input.orderBy === "Outlaws" ? [eq(userData.isOutlaw, true)] : []),
        ...(input.isAi ? [eq(userData.isAi, true)] : []),
        ...(input.inArena !== undefined ? [eq(userData.inArena, !!input.inArena)] : []),
        ...(input.isEvent !== undefined ? [eq(userData.isEvent, !!input.isEvent)] : []),
        ...(input.isSummon !== undefined
          ? [eq(userData.isSummon, !!input.isSummon)]
          : []),
        ...(input.inShrines !== undefined
          ? [eq(userData.inShrines, !!input.inShrines)]
          : []),
      ),
      columns: {
        avatar: true,
        avatar3d: true,
        avatarLight: true,
        experience: true,
        nRecruited: true,
        inArena: true,
        inShrines: true,
        isAi: true,
        isEvent: true,
        isOutlaw: true,
        isSummon: true,
        lastIp: true,
        level: true,
        pvpStreak: true,
        rankedLp: true,
        rank: true,
        reputationPointsTotal: true,
        role: true,
        updatedAt: true,
        userId: true,
        username: true,
        villageId: true,
        craftingExperience: true,
        medicalExperience: true,
        villagePrestige: true,
        tavernMessages: true,
        dailyArenaFights: true,
        dailyMissions: true,
        dailyErrands: true,
        effects: true,
      },
      // If AI, also include relations information
      with: {
        village: { columns: { name: true } },
        ...(input.isAi && includeEffects
          ? {
              jutsus: {
                columns: { level: true },
                with: {
                  jutsu: {
                    columns: {
                      name: true,
                      effects: true,
                    },
                  },
                },
              },
              items: {
                columns: {
                  itemId: true,
                },
                with: {
                  item: {
                    columns: {
                      effects: true,
                    },
                  },
                },
              },
            }
          : {}),
      },
      offset: skip,
      limit: input.limit,
      orderBy: getOrder(),
    }),
    ...(userId
      ? [
          client.query.userData.findFirst({
            where: eq(userData.userId, userId),
          }),
        ]
      : [null]),
  ]);
  // Guard
  if (input.ip && (!user || !canSeeIps(user.role))) {
    throw serverError("FORBIDDEN", "You are not allowed to search IPs");
  }
  // Hide stuff
  users
    .filter((u) => !u.lastIp)
    .forEach((u) => {
      u.lastIp = "Proxied";
    });
  if (!user || !canSeeIps(user.role)) {
    users.forEach((u) => {
      u.lastIp = "hidden";
    });
  }
  // Return
  const nextCursor = users.length < input.limit ? null : currentCursor + 1;
  return {
    data: users,
    nextCursor: nextCursor,
  };
};
export type FetchedPublicUsers = Awaited<ReturnType<typeof fetchPublicUsers>>;

export const fetchAttributes = async (client: DrizzleClient, userId: string) => {
  return await client.query.userAttribute.findMany({
    where: eq(userAttribute.userId, userId),
  });
};

export type UserWithRelations =
  | (UserData & {
      bloodline?: Bloodline | null;
      activeReskin?: BloodlineReskin | null;
      anbuSquad?: { name: string } | null;
      clan?: Clan | null;
      items: UserItem[];
      village?:
        | (Village & {
            structures?: VillageStructure[];
            relationshipA?: VillageAlliance[];
            relationshipB?: VillageAlliance[];
            sectors?: { sector: number }[];
          })
        | null;
      loadout?: { jutsuIds: string[] } | null;
      userQuests: (UserQuest & { quest: Quest })[];
      completedQuests: { id: string; questId: string; completed: number }[];
      votes?: UserVote | null;
      activeWars?: {
        id: string;
        attackerVillageId: string;
        defenderVillageId: string;
        sector: number;
        attackerVillage: { id: string; sector: number };
        defenderVillage: { id: string; sector: number };
        warAllies?: { villageId: string; supportVillageId: string }[];
      }[];
      shrineBattles?: {
        id: string;
        sector: number | null;
        attackerEntityId: string;
        defenderEntityId: string;
      }[];
      activeRaids?: {
        id: string;
        name: string;
        sector: number;
        raidType: "open" | "exclusive";
      }[];
    })
  | undefined;

export type AiWithRelations = UserData & {
  jutsus: (UserJutsu & { jutsu: { id: string; name: string } })[];
  items: (UserItem & { item: { id: string; name: string } })[];
};
