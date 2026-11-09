import { after } from "next/server";
import { z } from "zod";
import {
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
  RESOURCE_SILO_POINTS_REQUIRED,
} from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import { getRewardPreview } from "@/libs/objectives";
import { getWarSide } from "@/libs/objectiveWar";
import { getServerPusher, updateUserOnMap } from "@/libs/pusher";
import { boostPvpRewards, getPvpBoost } from "@/libs/pvpExperience";
import { type GetRewardResult, postProcessRewards } from "@/libs/quest/rewards";
import { rollResourceSiloRewards } from "@/libs/resourceSilos";
import { getSectorShrinePosition } from "@/libs/sector-map/structures";
import { findNearestReachableCoordinate } from "@/libs/sector-map/validation";
import { isWeightedCacheEffect } from "@/libs/weightedCache";
import { fetchUser } from "@/queries/profile";
import { selectVillageForUpdateRewards } from "@/queries/quests";
import {
  auditResourceSilo,
  claimResourceSilo,
  claimResourceSiloWithRewards,
  findResourceSilo,
  listResourceSiloCaches,
  resolveWarTornRespawn,
  saveResourceSilo,
} from "@/queries/resourceSilos";
import { listRewardPackageForGetCatalog } from "@/queries/rewardPackages";
import { fetchUpdatedUser } from "@/server/api/routers/profile";
import { fetchActiveWars } from "@/server/api/routers/war";
import {
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  serverError,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import {
  actionReadinessResponse,
  prepareActionReadiness,
} from "@/server/utils/actionReadiness";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { pushActivityUpdate } from "@/server/utils/push/liveActivity";
import { fetchPvpExperienceAverage } from "@/server/utils/pvpExperience";
import { updateRewards } from "@/server/utils/questRewards";
import { fetchPublishedSectorMap } from "@/server/utils/sectorMap";
import { validateTitleRewardIds } from "@/server/utils/titleRewards";
import { canAwardReputation, canManageRewards, isStaffRole } from "@/utils/permissions";
import { getResourceSiloWindow } from "@/utils/time";
import {
  ResourceSiloEntry,
  type ResourceSiloEntryType,
  ResourceSiloSelection,
} from "@/validators/resourceSilos";
import { ObjectiveReward, type ObjectiveRewardType } from "@/validators/rewards";

/** Weekend shrine rewards, staff catalog snapshots and the War-Torn death choice. */
export const resourceSilosRouter = createTRPCRouter({
  /** Report current-window progress without exposing the configured reward payloads. */
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    const [user, config] = await Promise.all([
      fetchUser(ctx.drizzle, ctx.userId),
      findResourceSilo(ctx.drizzle),
    ]);
    const window = getResourceSiloWindow();
    const progress =
      user.resourceSiloProgress?.windowId === window.id
        ? user.resourceSiloProgress
        : undefined;
    return {
      window,
      points: progress?.points ?? 0,
      claimed: progress?.claimed ?? false,
      configured: !!config?.entries.some((entry) => entry.chance > 0),
    };
  }),
  /** Load staff catalog choices once so cache-effect filtering stays in memory. */
  getEditor: protectedProcedure.query(async ({ ctx }) => {
    const user = await fetchUser(ctx.drizzle, ctx.userId);
    if (!isStaffRole(user.role))
      throw serverError("FORBIDDEN", "Resource Silos are only available to staff");
    const [config, packages, items] = await Promise.all([
      findResourceSilo(ctx.drizzle),
      listRewardPackageForGetCatalog(ctx.drizzle),
      listResourceSiloCaches(ctx.drizzle),
    ]);
    const caches = items.filter((item) => item.effects.some(isWeightedCacheEffect));
    return {
      entries: config?.entries ?? [],
      packages,
      caches: caches.map(({ id, name }) => ({ id, name })),
    };
  }),
  /** Validate source rewards and persist a staff-owned catalog snapshot with its audit entry. */
  save: protectedProcedure
    .input(
      z.object({
        entries: z
          .array(ResourceSiloSelection)
          .max(50)
          .refine(
            (entries) =>
              new Set(entries.map((e) => `${e.kind}:${e.sourceId}`)).size ===
              entries.length,
            "Each reward may appear once",
          ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [user, config, packages, items] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findResourceSilo(ctx.drizzle),
        listRewardPackageForGetCatalog(ctx.drizzle),
        listResourceSiloCaches(ctx.drizzle),
      ]);
      if (user.isBanned || !canManageRewards(user.role))
        return errorResponse("Not allowed to maintain resource silos");
      const entries: ResourceSiloEntryType[] = [];
      for (const selection of input.entries) {
        const pack = packages.find(
          (pack) => selection.kind === "package" && pack.id === selection.sourceId,
        );
        const cache = items.find(
          (item) =>
            selection.kind === "cache" &&
            item.id === selection.sourceId &&
            item.effects.some(isWeightedCacheEffect),
        );
        if (!pack && !cache)
          return errorResponse(
            "A selected reward no longer exists. Reload the editor.",
          );
        const rewards =
          pack?.rewards ??
          ObjectiveReward.parse({
            reward_items: [{ ids: [selection.sourceId], quantity: 1, number: 100 }],
          });
        if (!canAwardReputation(user.role) && rewards.reward_reputation > 0) {
          const previous = config?.entries.find(
            (entry) =>
              entry.kind === selection.kind && entry.sourceId === selection.sourceId,
          );
          if (
            !previous ||
            JSON.stringify(previous.rewards) !== JSON.stringify(rewards) ||
            previous.chance !== selection.chance
          )
            return errorResponse(
              "Only administrators can configure reputation rewards",
            );
        }
        entries.push(
          ResourceSiloEntry.parse({
            ...selection,
            name: pack?.name ?? cache?.name,
            rewards,
          }),
        );
      }
      const titleError = await validateTitleRewardIds(
        ctx.drizzle,
        entries.map((entry) => entry.rewards),
      );
      if (titleError) return errorResponse(titleError);
      await saveResourceSilo(ctx.drizzle, entries);
      await auditResourceSilo(ctx.drizzle, ctx.userId, config?.entries ?? [], entries);
      return { success: true, message: "Resource Silos saved", entries };
    }),
  /** Consume one eligible spawn receipt atomically with its independently rolled payout. */
  claim: protectedProcedure.mutation(async ({ ctx }) => {
    const [snapshot, config] = await Promise.all([
      fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
        forceRegen: true,
        includeNotifications: false,
      }),
      findResourceSilo(ctx.drizzle),
    ]);
    if (!snapshot.user) return errorResponse("User not found");
    const readiness = prepareActionReadiness(snapshot.user, snapshot.settings);
    const user = readiness.user;
    if (readiness.error) return errorResponse(readiness.error);
    const window = getResourceSiloWindow();
    if (
      user.isBanned ||
      user.isAi ||
      user.status !== "AWAKE" ||
      user.sector !== MAP_WAR_TORN_BATTLEGROUND_SECTOR
    )
      return errorResponse(
        "You must be awake in the War-Torn Sector to unlock the silo",
      );
    if (!window.active) return errorResponse("The resource silo is closed");
    if (!config?.entries.some((entry) => entry.chance > 0))
      return errorResponse("No resource silo rewards are configured");
    if (
      user.resourceSiloProgress?.windowId !== window.id ||
      user.resourceSiloProgress.points < RESOURCE_SILO_POINTS_REQUIRED
    )
      return errorResponse(
        `Earn ${RESOURCE_SILO_POINTS_REQUIRED} points during this spawn to unlock the silo`,
      );
    if (user.resourceSiloProgress.claimed)
      return errorResponse("You already claimed this silo");
    const { rewards: rawRewards } = rollResourceSiloRewards(config.entries);
    const rewards = postProcessRewards(rawRewards, user);
    let outcome:
      | ReturnType<typeof resourceSiloClaimResponse>
      | ReturnType<typeof errorResponse>;
    if (!resourceSiloNeedsTransaction(user, rewards)) {
      const [pvpAverage, membershipVillage, activeWars] = await Promise.all([
        (user.pvpExperience ?? 0) > 0
          ? fetchPvpExperienceAverage(ctx.drizzle)
          : undefined,
        rewards.reward_village_membership !== "NONE"
          ? selectVillageForUpdateRewards(ctx.drizzle, {
              reward_village_membership: rewards.reward_village_membership,
            }).then((rows) => rows[0])
          : undefined,
        (rewards.reward_war_damage > 0 || rewards.reward_war_healing > 0) &&
        user.villageId
          ? fetchActiveWars(ctx.drizzle, user.villageId, user.userId)
          : [],
      ]);
      const payout = structuredClone(rewards);
      boostPvpRewards(
        payout,
        getPvpBoost(user, pvpAverage ? [pvpAverage] : []).totalPercent,
        true,
      );
      const wars = activeWars.flatMap((war) => {
        const side = getWarSide(war, user.villageId, user.userId);
        return side && ["VILLAGE_WAR", "WAR_RAID"].includes(war.type)
          ? [
              {
                id: war.id,
                type: war.type,
                attackerWarHealth: war.attackerWarHealth,
                defenderWarHealth: war.defenderWarHealth,
                side:
                  side === war.attackerVillageId
                    ? ("attacker" as const)
                    : ("defender" as const),
              },
            ]
          : [];
      });
      const claim = await claimResourceSiloWithRewards(
        ctx.drizzle,
        readiness,
        window,
        payout,
        membershipVillage?.id,
        wars,
      );
      outcome =
        claim.rowsAffected > 0
          ? resourceSiloClaimResponse(rawRewards, payout, [], window.id)
          : errorResponse("Your character or silo changed. Reload and try again.");
    } else {
      // MySQL UPDATE cannot insert inventory/acquisition/reputation/recruitment receipts,
      // or delete promotion requests. These payouts require multiple statements whose
      // receipt and grants must roll back together; UPDATE-only payouts stay outside.
      outcome = await retryOnDeadlock(() =>
        ctx.drizzle.transaction(async (tx) => {
          const client = tx as unknown as DrizzleClient;
          const claim = await claimResourceSilo(
            client,
            readiness.initial,
            window,
            readiness,
          );
          if (claim.rowsAffected !== 1)
            return errorResponse(
              "Your character or silo changed. Reload and try again.",
            );
          // updateRewards boosts its argument in place; each rollback retries an unboosted clone.
          const payout = structuredClone(rewards);
          const granted = await updateRewards({
            client,
            user,
            rewards: payout,
            reason: "Resource Silo",
            inTransaction: true,
            persistQuestData: false,
          });
          return resourceSiloClaimResponse(
            rawRewards,
            payout,
            granted.items,
            window.id,
          );
        }),
      );
    }
    return actionReadinessResponse(
      outcome,
      outcome.success ? readiness : undefined,
      ctx.drizzle,
    );
  }),
  /** Consume the death choice, charging only an available, immediately awake shrine revival. */
  respawn: protectedProcedure
    .input(z.object({ destination: z.enum(["shrine", "village"]) }))
    .mutation(async ({ ctx, input }) => {
      const [snapshot, map] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
          forceRegen: true,
          includeNotifications: false,
        }),
        input.destination === "shrine"
          ? fetchPublishedSectorMap(
              ctx.drizzle,
              MAP_WAR_TORN_BATTLEGROUND_SECTOR,
            ).catch(() => null)
          : undefined,
      ]);
      const user = snapshot.user;
      if (!user) return errorResponse("User not found");
      if (user.isBanned || user.status !== "HOSPITALIZED" || !user.warTornRespawn)
        return errorResponse("This revival choice is no longer available");
      const shrine = map
        ? (findNearestReachableCoordinate(map, getSectorShrinePosition(map)) ??
          undefined)
        : undefined;
      if (input.destination === "shrine" && !shrine)
        return errorResponse(
          "The War-Torn shrine is unavailable. You can still return to your village.",
        );
      const result = await resolveWarTornRespawn(ctx.drizzle, user, shrine);
      if (result.rowsAffected !== 1)
        return errorResponse(
          "Your character changed or you cannot afford the revival. Please try again.",
        );
      if (shrine) {
        const revived = {
          ...user,
          status: "AWAKE" as const,
          sector: MAP_WAR_TORN_BATTLEGROUND_SECTOR,
          longitude: shrine.x,
          latitude: shrine.y,
          curHealth: user.maxHealth,
        };
        const pusher = getServerPusher();
        after(() => updateUserOnMap(pusher, user.sector, revived));
        if (user.sector !== revived.sector)
          after(() => updateUserOnMap(pusher, revived.sector, revived));
        after(() =>
          pushActivityUpdate(
            ctx.drizzle,
            [ctx.userId],
            "hospital",
            { title: "Recovered", endsAt: new Date() },
            "end",
          ),
        );
      }
      return {
        success: true,
        message: shrine
          ? "Revived at the War-Torn shrine"
          : "Returned to your village hospital",
      };
    }),
});

/** Identify payouts whose acquisition records or promotion cleanup cannot share an UPDATE receipt. */
const resourceSiloNeedsTransaction = (user: UserData, rewards: GetRewardResult) =>
  rewards.reward_rank !== "NONE" ||
  rewards.reward_reputation > 0 ||
  (!!user.recruiterId && rewards.reward_prestige > 0) ||
  rewards.reward_items.length > 0 ||
  rewards.reward_jutsus.length > 0 ||
  rewards.reward_bloodlines.length > 0 ||
  rewards.reward_badges.length > 0 ||
  (rewards.reward_titles?.length ?? 0) > 0 ||
  (!user.sageModeId && rewards.reward_sage_modes.length > 0) ||
  (rewards.reward_hunter_items && user.occupation === "HUNTER") ||
  (rewards.reward_gathering_items && user.occupation === "GATHERING");

/** Describe only the payout amounts and item names confirmed by the committed claim. */
const resourceSiloClaimResponse = (
  rawRewards: ObjectiveRewardType,
  payout: GetRewardResult,
  grantedItems: { name: string }[],
  windowId: string,
) => {
  const preview = getRewardPreview({ ...rawRewards, ...payout, reward_items: [] });
  const items = grantedItems.map((item) => item.name).join(", ");
  return {
    success: true,
    message:
      preview || items
        ? `Resource Silo: ${[preview, items].filter(Boolean).join("; ")}`
        : "Resource Silo unlocked. No rewards dropped this time.",
    claimed: true as const,
    windowId,
  };
};
