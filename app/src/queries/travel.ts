/**
 * Database access for travel; authorization and transaction scopes stay in callers.
 */
import {
  and,
  asc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lte,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { nanoid } from "nanoid";
import { ROBBING_IMMUNITY_DURATION } from "@/drizzle/constants";
import {
  actionLog,
  battle,
  clan,
  overworldAiPlacement,
  questHistory,
  userData,
  userItem,
  userSkill,
  village,
  war,
} from "@/drizzle/schema";
import { SECTOR_BATTLE_STALE_SECONDS } from "@/libs/travel";
import { spriteUserRelations } from "@/queries/lpc";
import { fetchSector } from "@/queries/village";
import { activeWarAllyWhere, activeWarMercenaryWhere } from "@/queries/war";
import type { DrizzleClient } from "@/server/db";
import {
  completedQuestHistoryRelation,
  userQuestHistoryRelation,
} from "@/server/utils/achievementObjectives";
import { buildSectorWindowLayout } from "@/server/utils/sectorMap";
import { secondsFromNow } from "@/utils/time";

/** Read the sector window without depending on the viewer's profile. */
export const fetchSectorWindowData = (
  client: DrizzleClient,
  userId: string,
  sector: number,
) =>
  Promise.all([
    client.query.userData.findMany({
      columns: {
        userId: true,
        username: true,
        gender: true,
        spriteBodyStyle: true,
        longitude: true,
        latitude: true,
        location: true,
        curHealth: true,
        maxHealth: true,
        sector: true,
        status: true,
        avatar: true,
        avatarLight: true,
        level: true,
        experience: true,
        rank: true,
        isOutlaw: true,
        isBanned: true,
        immunityUntil: true,
        robImmunityUntil: true,
        updatedAt: true,
        villageId: true,
        battleId: true,
        anbuId: true,
        stealthActive: true,
        stealthActivatedAt: true,
        stealth: true,
      },
      where: and(
        eq(userData.sector, sector),
        eq(userData.isAi, false),
        inArray(userData.status, ["AWAKE", "BATTLE"]),
        eq(userData.isBanned, false),
        gte(userData.updatedAt, secondsFromNow(-36000)),
        ne(userData.userId, userId),
      ),
      with: {
        ...spriteUserRelations,
        anbuSquad: {
          columns: {
            id: true,
            name: true,
            image: true,
            villageId: true,
          },
        },
      },
    }),
    client.query.village.findFirst({
      where: and(
        eq(village.sector, sector),
        inArray(village.type, [
          "VILLAGE",
          "OUTLAW",
          "STRONGHOLD",
          "HIDEOUT",
          "SAFEZONE",
        ]),
      ),
      with: { structures: true },
    }),
    fetchSector(client, sector),
    client.query.overworldAiPlacement.findMany({
      where: and(
        inArray(
          overworldAiPlacement.sector,
          buildSectorWindowLayout(sector).map((entry) => entry.sector),
        ),
        eq(overworldAiPlacement.isActive, true),
      ),
      // Stable order so the arrival-prompt `find`-first NPC can't flip between polls when two
      // placements share a tile (which would ping-pong the modal open on every sector refresh).
      orderBy: asc(overworldAiPlacement.id),
      columns: {
        id: true,
        aiTemplateUserId: true,
        interactionType: true,
        sectorType: true,
        locationType: true,
        sector: true,
        longitude: true,
        latitude: true,
        positionVersion: true,
      },
      with: {
        aiTemplate: {
          columns: {
            userId: true,
            username: true,
            avatar: true,
            avatarLight: true,
            curHealth: true,
            maxHealth: true,
            level: true,
            rank: true,
            isAi: true,
          },
        },
      },
    }),
  ]);

/**
 * Build the `userData` update for `robPlayer`, setting `money` and `robImmunityUntil`,
 * including predicates on `userId`, `money`, `robImmunityUntil`.
 */
export const updateUserDataForRobPlayer = (
  client: Pick<DrizzleClient, "update">,
  stolenAmount: number,
  target: { userId: string },
  now: Date,
  input: { sector: number; longitude: number; latitude: number },
) =>
  client
    .update(userData)
    .set({
      money: sql`${userData.money} - ${stolenAmount}`,
      robImmunityUntil: secondsFromNow(ROBBING_IMMUNITY_DURATION),
    })
    .where(
      and(
        eq(userData.userId, target.userId),
        gte(userData.money, stolenAmount),
        or(isNull(userData.robImmunityUntil), lte(userData.robImmunityUntil, now)),
        or(isNull(userData.immunityUntil), lte(userData.immunityUntil, now)),
        eq(userData.status, "AWAKE"),
        eq(userData.isBanned, false),
        eq(userData.sector, input.sector),
        eq(userData.longitude, input.longitude),
        eq(userData.latitude, input.latitude),
      ),
    );

/** Build the `userData` update for `robPlayer`, setting `money` and `villagePrestige`, using predicates on `userId`. */
export const updateUserDataForRobPlayer2 = (
  client: Pick<DrizzleClient, "update">,
  stolenAmount: number,
  prestigeGain: number,
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({
      money: sql`${userData.money} + ${stolenAmount}`,
      villagePrestige: sql`${userData.villagePrestige} + ${prestigeGain}`,
    })
    .where(eq(userData.userId, ctx.userId));

/** Build the `clan` update for `robPlayer`, setting `points` and `activityPoints`, using predicates on `id`. */
export const updateClanForRobPlayer = (
  client: Pick<DrizzleClient, "update">,
  user: { clanId: string },
) =>
  client
    .update(clan)
    .set({
      points: sql`${clan.points} + 1`,
      activityPoints: sql`${clan.activityPoints} + 1`,
    })
    .where(eq(clan.id, user.clanId));

/** Build the `actionLog` insert for `robPlayer`. */
export const insertActionLogForRobPlayer = (
  client: Pick<DrizzleClient, "insert">,
  user: { userId: string; username: string; avatarLight: null | string },
  stolenAmount: number,
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: user.userId,
    tableName: "user",
    changes: [`Was robbed for ${stolenAmount} ryo by ${user.username}`],
    relatedId: user.userId,
    relatedMsg: `Was robbed by ${user.username}`,
    relatedImage: user.avatarLight,
  });

/** Build the `userData` lookup for `getSectorData`, using predicates on `userId`. */
export const findUserDataForGetSectorData = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, ctx.userId),
    with: {
      ...spriteUserRelations,
      anbuSquad: {
        columns: { id: true, name: true, image: true, villageId: true },
      },
    },
  });

/** Build the `war` listing for `getSectorData`, using predicates on `status`. */
export const listWarForGetSectorData = (client: Pick<DrizzleClient, "query">) =>
  client.query.war.findMany({
    where: eq(war.status, "ACTIVE"),
    with: {
      attackerVillage: {
        columns: {
          name: true,
          id: true,
          villageGraphic: true,
          sector: true,
          kageId: true,
        },
      },
      defenderVillage: {
        columns: {
          name: true,
          id: true,
          villageGraphic: true,
          sector: true,
          kageId: true,
        },
      },
      warMercenaries: { where: activeWarMercenaryWhere() },
      warAllies: {
        where: activeWarAllyWhere(),
        columns: { villageId: true, supportVillageId: true },
      },
    },
  });

/** Build the `battle` selection for `getSectorData`, using predicates on `updatedAt`. */
export const selectBattleForGetSectorData = (client: Pick<DrizzleClient, "select">) =>
  client
    .select({ id: battle.id })
    .from(battle)
    .where(gte(battle.updatedAt, secondsFromNow(-SECTOR_BATTLE_STALE_SECONDS)));

/** Build the `questHistory` listing for `getSectorData`, using predicates on `userId`, `completed`, `endAt`. */
export const listQuestHistoryForGetSectorData = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.questHistory.findMany({
    where: and(
      eq(questHistory.userId, ctx.userId),
      eq(questHistory.completed, 0),
      isNull(questHistory.endAt),
    ),
    with: { quest: true },
  });

/** Build the `questHistory` listing for `getSectorData`, using predicates on `userId`, `completed`, `previousCompletes`. */
export const listQuestHistoryForGetSectorData2 = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.questHistory.findMany({
    columns: { id: true, questId: true, completed: true },
    where: and(
      eq(questHistory.userId, ctx.userId),
      or(gte(questHistory.completed, 1), gt(questHistory.previousCompletes, 0)),
    ),
  });

/** Build the `userData` update for `startGlobalMove`, including predicates on `userId`, `status`, `sector`. */
export const updateUserDataForStartGlobalMove = (
  client: Pick<DrizzleClient, "update">,
  input: { sector: number },
  destination: { x: number; y: number },
  endTime: Date,
  ctx: { userId: string },
  departureSector: number,
  user: { updatedAt: Date },
) =>
  client
    .update(userData)
    .set({
      warMission: null,
      sector: input.sector,
      longitude: destination.x,
      latitude: destination.y,
      status: "TRAVEL",
      travelFinishAt: endTime,
    })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        eq(userData.status, "AWAKE"),
        eq(userData.sector, departureSector),
        eq(userData.updatedAt, user.updatedAt),
      ),
    );

/** Build the `sector` listing for `getAllSectors`, selecting only `sector` and `villageId`. */
export const listSectorForGetAllSectors = (client: Pick<DrizzleClient, "query">) =>
  client.query.sector.findMany({
    columns: {
      sector: true,
      villageId: true,
    },
  });

/** Build the `userData` lookup for `moveInSector`, using predicates on `userId`. */
export const findUserDataForMoveInSector = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, userId),
    with: { anbuSquad: true },
  });

/** Build the `userData` update for `moveInSector`, including predicates on `userId`, `status`, `sector`. */
export const updateUserDataForMoveInSector = (
  client: Pick<DrizzleClient, "update">,
  targetSector: number,
  originalUser: { sector: number },
  destination: { x: number; y: number },
  location: string,
  userId: string,
  sector: number,
  moveUser: { updatedAt: Date },
  input: { curLongitude: number; curLatitude: number },
  villageId: undefined | null | string,
) =>
  client
    .update(userData)
    .set({
      ...(targetSector !== originalUser.sector ? { warMission: null } : {}),
      sector: targetSector,
      longitude: destination.x,
      latitude: destination.y,
      location,
    })
    .where(
      and(
        eq(userData.userId, userId),
        eq(userData.status, "AWAKE"),
        eq(userData.sector, sector),
        eq(userData.updatedAt, moveUser.updatedAt),
        // Guard on the player's ACTUAL stored position (the raw input),
        // not the snapped walkable coordinate — otherwise a snapped move
        // never matches the row and the player is soft-locked.
        eq(userData.longitude, input.curLongitude),
        eq(userData.latitude, input.curLatitude),
        villageId ? eq(userData.villageId, villageId) : isNull(userData.villageId),
      ),
    );

/** Build the `village` lookup for `moveInSector`, using predicates on `sector`. */
export const findVillageForMoveInSector = (
  client: Pick<DrizzleClient, "query">,
  targetSector: number,
) =>
  client.query.village.findFirst({
    with: {
      structures: true,
      relationshipA: true,
      relationshipB: true,
    },
    where: eq(village.sector, targetSector),
  });

/**
 * Build the `userData` listing for `completeExpiredGlobalTravel`, using predicates on
 * `equipped`, `quantity`, `activated`.
 */
export const listUserDataForCompleteExpiredGlobalTravel = (
  client: Pick<DrizzleClient, "query">,
  expiredTravel: undefined | SQL<unknown>,
  hasQueue: SQL<unknown>,
) =>
  client.query.userData.findMany({
    where: and(expiredTravel, hasQueue),
    with: {
      bloodline: true,
      raidBuffs: true,
      clan: true,
      village: { with: { structures: true } },
      items: {
        where: and(ne(userItem.equipped, "NONE"), gt(userItem.quantity, 0)),
        with: { item: true, imbuements: { with: { item: true } } },
      },
      titles: true,
      userSkills: { where: eq(userSkill.activated, true), with: { skill: true } },
    },
  });

/**
 * Build the `userData` update for `completeExpiredGlobalTravel`, setting `status` and
 * `travelFinishAt`, using the configured predicates.
 */
export const updateUserDataForCompleteExpiredGlobalTravel = (
  client: Pick<DrizzleClient, "update">,
  expiredTravel: undefined | SQL<unknown>,
  hasQueue: SQL<unknown>,
) =>
  client
    .update(userData)
    .set({ status: "AWAKE", travelFinishAt: null })
    .where(and(expiredTravel, sql`NOT (${hasQueue})`));

/** Arrival evaluates quest targets and collection bonuses from one relation read. */
export const findUserForGlobalTravelFinish = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, userId),
    with: {
      userQuests: userQuestHistoryRelation,
      completedQuests: completedQuestHistoryRelation,
      bloodline: true,
      village: true,
      clan: true,
      titles: true,
      userSkills: { where: eq(userSkill.activated, true), with: { skill: true } },
      items: {
        where: and(ne(userItem.equipped, "NONE"), gt(userItem.quantity, 0)),
        with: { item: true, imbuements: { with: { item: true } } },
      },
    },
  });
