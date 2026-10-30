/**
 * Database access for clan; authorization and transaction scopes stay in callers.
 */
import {
  and,
  desc,
  eq,
  exists,
  getTableColumns,
  gte,
  inArray,
  isNull,
  like,
  lt,
  ne,
  not,
  notExists,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  type CLAN_ASSASSIN_SLOT,
  CLAN_BATTLE_REWARD_POINTS,
  CLAN_BATTLE_REWARD_RYO,
  CLAN_BOOST_PERCENT_PER_LEVEL,
  CLAN_COLOR_CHANGE_REP_COST,
  CLAN_CREATE_RYO_COST,
  type ClanBoostType,
  HIDEOUT_COST,
  IMG_AVATAR_DEFAULT,
  IMG_VILLAGE_FACTION,
  KAGE_MAX_ELDERS,
  STRONGHOLD_MONTHLY_MAINTENANCE,
  STRONGHOLD_REESTABLISH_COST,
  VILLAGE_SYNDICATE_ID,
} from "@/drizzle/constants";
import {
  actionLog,
  battle,
  battleAction,
  clan,
  conversation,
  dungeonMember,
  dungeonRun,
  mpvpBattleQueue,
  mpvpBattleUser,
  rankedPvpQueue,
  sector,
  userData,
  userRequest,
  village,
  villageStructure,
  war,
  warAlly,
  warKill,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { resumeBracketImmunitySql } from "@/server/utils/objectiveWar";

/**
 * Fetches a clan battle by its ID.
 * @param client - The Drizzle client.
 * @param clanBattleId - The ID of the clan battle to fetch.
 * @returns - A promise that resolves to the fetched clan battle, or undefined if not found.
 */
export const fetchClanBattle = async (client: DrizzleClient, clanBattleId: string) => {
  return await client.query.mpvpBattleQueue.findFirst({
    where: eq(mpvpBattleQueue.id, clanBattleId),
    with: {
      queue: {
        columns: { id: true, userId: true, createdAt: true, side: true, slot: true },
        with: { user: { columns: { clanId: true, avatar: true, username: true } } },
      },
    },
  });
};

/**
 * Fetches clan battles for a given clan ID.
 * @param client - The DrizzleClient instance used for querying.
 * @param clanId - The ID of the clan to fetch battles for.
 * @returns A promise that resolves to an array of clan battles.
 */
export const fetchClanBattles = async (client: DrizzleClient, clanId: string) => {
  // Fetch battles where this clan is either attacker or defender
  const battles = await client.query.mpvpBattleQueue.findMany({
    where: and(
      eq(mpvpBattleQueue.battleType, "CLAN_BATTLE"),
      or(
        eq(mpvpBattleQueue.attackerEntityId, clanId),
        eq(mpvpBattleQueue.defenderEntityId, clanId),
      ),
    ),
    with: {
      queue: {
        columns: { userId: true, side: true },
        with: {
          user: {
            columns: {
              clanId: true,
              avatar: true,
              username: true,
              level: true,
              rank: true,
              isOutlaw: true,
            },
          },
        },
      },
    },
    orderBy: (mpvpBattleQueue, { desc }) => [desc(mpvpBattleQueue.createdAt)],
  });

  // Fetch clan details for attacker and defender entities
  const clanIds = [
    ...new Set(battles.flatMap((b) => [b.attackerEntityId, b.defenderEntityId])),
  ];
  const clans =
    clanIds.length > 0
      ? await client.query.clan.findMany({
          where: inArray(clan.id, clanIds),
          columns: { id: true, name: true, image: true },
        })
      : [];
  const clanMap = new Map(clans.map((c) => [c.id, c]));

  // Return battles with clan info attached
  return battles.map((b) => ({
    ...b,
    attackerClan: clanMap.get(b.attackerEntityId),
    defenderClan: clanMap.get(b.defenderEntityId),
  }));
};

/**
 * Fetches the clan battle queue for a specific user.
 * @param client - The Drizzle client instance.
 * @param userId - The ID of the user.
 * @returns - A promise that resolves to an array of clan battle queue items.
 */
export const fetchActiveUserMpvpBattles = async (
  client: DrizzleClient,
  userId: string,
) => {
  return await client
    .select(getTableColumns(mpvpBattleUser))
    .from(mpvpBattleUser)
    .innerJoin(
      mpvpBattleQueue,
      and(
        eq(mpvpBattleUser.clanBattleId, mpvpBattleQueue.id),
        isNull(mpvpBattleQueue.winnerId),
      ),
    )
    .where(eq(mpvpBattleUser.userId, userId));
};

/**
 * Fetches clans based on the provided village ID.
 * @param client - The DrizzleClient instance used for querying.
 * @param villageId - The ID of the village to fetch clans for.
 * @returns A promise that resolves to an array of clans.
 */
export const fetchClans = async (
  client: DrizzleClient,
  villageId: string,
  isOutlaw?: boolean,
) => {
  return await client.query.clan.findMany({
    with: {
      leader: {
        columns: {
          userId: true,
          username: true,
          level: true,
          rank: true,
          avatar: true,
        },
      },
      founder: {
        columns: {
          userId: true,
          username: true,
          level: true,
          rank: true,
          avatar: true,
        },
      },
      members: {
        columns: {
          userId: true,
          username: true,
          level: true,
          rank: true,
          avatar: true,
        },
      },
      village: true,
    },
    where: isOutlaw
      ? or(eq(clan.villageId, villageId), eq(clan.hasHideout, true))
      : eq(clan.villageId, villageId),
  });
};

/**
 * Fetches a clan from the database based on the clan ID.
 *
 * @param  client - The Drizzle client used to query the database.
 * @param  clanId - The ID of the clan to fetch.
 * @returns - A promise that resolves to the fetched clan, or undefined if not found.
 */
export const fetchClan = async (client: DrizzleClient, clanId: string) => {
  return await client.query.clan.findFirst({
    with: {
      leader: {
        columns: {
          userId: true,
          username: true,
          level: true,
          rank: true,
          avatar: true,
        },
      },
      founder: {
        columns: {
          userId: true,
          username: true,
          level: true,
          rank: true,
          avatar: true,
        },
      },
      village: {
        columns: {
          id: true,
          name: true,
          wasDowngraded: true,
          belowMemberMinimumSince: true,
          lastMaintenancePaidAt: true,
          type: true,
          sector: true,
          kageId: true,
        },
      },
      members: {
        columns: {
          userId: true,
          username: true,
          level: true,
          rank: true,
          avatar: true,
          pvpExperience: true,
          isOutlaw: true,
          anbuId: true,
        },
      },
      leaderOrder: true,
      elderNominee: {
        columns: {
          userId: true,
          username: true,
          level: true,
          rank: true,
          avatar: true,
        },
      },
    },
    where: eq(clan.id, clanId),
  });
};

/**
 * Fetches a clan by its name.
 * @param client - The Drizzle client instance.
 * @param name - The name of the clan to fetch.
 * @returns - A promise that resolves to the fetched clan, or undefined if not found.
 */
export const fetchClanByName = async (client: DrizzleClient, name: string) => {
  return await client.query.clan.findFirst({
    where: eq(clan.name, name),
  });
};

/** Build the `clan` update for `purchaseHideout`, using predicates on `id` and `bank`. */
export const updateClanForPurchaseHideout = (
  client: Pick<DrizzleClient, "update">,
  hideoutId: string,
  input: { clanId: string },
) =>
  client
    .update(clan)
    .set({
      villageId: hideoutId,
      bank: sql`${clan.bank} - ${HIDEOUT_COST}`,
      hasHideout: true,
    })
    .where(and(eq(clan.id, input.clanId), gte(clan.bank, HIDEOUT_COST)));

/** Build the `villageStructure` insert for `purchaseHideout`. */
export const insertVillageStructureForPurchaseHideout = (
  client: Pick<DrizzleClient, "insert">,
  newStructures: import("@/drizzle/schema").VillageStructure[],
  hideoutId: string,
) =>
  client.insert(villageStructure).values(
    newStructures.map((s) => ({
      ...s,
      id: nanoid(),
      level: 1,
      villageId: hideoutId,
      allyAccess: 1,
    })),
  );

/** Build the `userData` update for `purchaseHideout`, setting `villageId`, using predicates on `clanId`. */
export const updateUserDataForPurchaseHideout = (
  client: Pick<DrizzleClient, "update">,
  hideoutId: string,
  input: { clanId: string },
) =>
  client
    .update(userData)
    .set({ villageId: hideoutId })
    .where(eq(userData.clanId, input.clanId));

/** Build the `conversation` insert for `purchaseHideout`. */
export const insertConversationForPurchaseHideout = (
  client: Pick<DrizzleClient, "insert">,
  fetchedClan: { name: string; leaderId: string },
) =>
  client.insert(conversation).values({
    id: nanoid(),
    title: fetchedClan.name,
    createdById: fetchedClan.leaderId,
  });

/** Build the `sector` insert for `purchaseHideout`. */
export const insertSectorForPurchaseHideout = (
  client: Pick<DrizzleClient, "insert">,
  input: { sector: number },
  hideoutId: string,
) =>
  client.insert(sector).values({
    sector: input.sector,
    villageId: hideoutId,
    shrineLevel: 1,
    capturedAt: new Date(),
  });

/** Build the `village` insert for `purchaseHideout`. */
export const insertVillageForPurchaseHideout = (
  client: Pick<DrizzleClient, "insert">,
  hideoutId: string,
  fetchedClan: { name: string; leaderId: string },
  input: { sector: number },
) =>
  client.insert(village).values({
    id: hideoutId,
    name: `${fetchedClan.name}`,
    mapName: `${fetchedClan.name}`,
    sector: input.sector,
    description: `${fetchedClan.name} Hideout`,
    kageId: fetchedClan.leaderId,
    type: "HIDEOUT",
    joinable: false,
    allianceSystem: true,
    villageGraphic: IMG_VILLAGE_FACTION,
  });

/** Execute the database statement for `upgradeHideoutToStronghold`. */
export const executeResultForUpgradeHideoutToStronghold = (
  client: Pick<DrizzleClient, "execute">,
  guards: undefined | SQL<unknown>,
) =>
  client.execute(sql`
          UPDATE ${village}
          INNER JOIN ${clan} ON ${clan.villageId} = ${village.id}
          SET ${village.type} = 'STRONGHOLD',
              ${village.belowMemberMinimumSince} = NULL,
              ${village.lastMaintenancePaidAt} = ${new Date()},
              ${clan.bank} = ${clan.bank} - ${STRONGHOLD_REESTABLISH_COST}
          WHERE ${guards}
        `);

/**
 * Build the `userData` update for `clanDonate`, setting `reputationPoints`, using
 * predicates on `userId` and `reputationPoints`.
 */
export const updateUserDataForClanDonate = (
  client: Pick<DrizzleClient, "update">,
  repsCost: number,
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({
      reputationPoints: sql`${userData.reputationPoints} - ${repsCost}`,
    })
    .where(
      and(eq(userData.userId, ctx.userId), gte(userData.reputationPoints, repsCost)),
    );

/** Build the `clan` update for `clanDonate`, setting `repTreasury`, using predicates on `id`. */
export const updateClanForClanDonate = (
  client: Pick<DrizzleClient, "update">,
  repsCost: number,
  fetchedClan: { id: string },
) =>
  client
    .update(clan)
    .set({
      repTreasury: sql`${clan.repTreasury} + ${repsCost}`,
    })
    .where(eq(clan.id, fetchedClan.id));

/** Build the `actionLog` insert for `clanDonate`. */
export const insertActionLogForClanDonate = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  message: string,
  fetchedClan: { id: string; image: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "clan",
    changes: [message],
    relatedId: fetchedClan.id,
    relatedMsg: message,
    relatedImage: fetchedClan.image,
  });

/** Build the `clan` listing for `getAllNames`. */
export const listClanForGetAllNames = (client: Pick<DrizzleClient, "query">) =>
  client.query.clan.findMany({
    columns: { id: true, name: true, image: true },
  });

/**
 * Build the `userData` lookup for `getRequests`, selecting row fields `userId` and
 * `clanId`, using predicates on `userId`.
 */
export const findUserDataForGetRequests = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, ctx.userId),
    columns: { userId: true, clanId: true },
    with: { clan: true },
  });

/** Build the `clan` listing for `searchClans`, using predicates on `name`. */
export const listClanForSearchClans = (
  client: Pick<DrizzleClient, "query">,
  input: { name: string },
) =>
  client.query.clan.findMany({
    columns: {
      id: true,
      name: true,
      image: true,
    },
    where: like(clan.name, `%${input.name}%`),
    orderBy: [sql`LENGTH(${clan.name}) asc`],
    limit: 5,
  });

/** Build the `userData` update for `acceptRequest`, setting `clanId`, using predicates on `userId`. */
export const updateUserDataForAcceptRequest = (
  client: Pick<DrizzleClient, "update">,
  fetchedClan: { id: string; hasHideout: false | true; villageId: string },
  requester: { userId: string },
) =>
  client
    .update(userData)
    .set({
      clanId: fetchedClan.id,
      ...(fetchedClan.hasHideout ? { villageId: fetchedClan.villageId } : {}),
    })
    .where(eq(userData.userId, requester.userId));

/** Build the `village` lookup for `createClan`, using predicates on `name`. */
export const findVillageForCreateClan = (
  client: Pick<DrizzleClient, "query">,
  input: { name: string },
) =>
  client.query.village.findFirst({
    where: eq(village.name, input.name),
  });

/** Build the `userData` update for `createClan`, setting `clanId` and `money`, using predicates on `userId`. */
export const updateUserDataForCreateClan = (
  client: Pick<DrizzleClient, "update">,
  clanId: string,
  user: { userId: string },
) =>
  client
    .update(userData)
    .set({
      clanId: clanId,
      money: sql`${userData.money} - ${CLAN_CREATE_RYO_COST}`,
    })
    .where(eq(userData.userId, user.userId));

/** Build the `clan` insert for `createClan`. */
export const insertClanForCreateClan = (
  client: Pick<DrizzleClient, "insert">,
  clanId: string,
  villageData: { id: string },
  input: { name: string },
  user: { userId: string },
) =>
  client.insert(clan).values({
    id: clanId,
    image: IMG_AVATAR_DEFAULT,
    villageId: villageData.id,
    name: input.name,
    founderId: user.userId,
    leaderId: user.userId,
    leaderOrderId: nanoid(),
  });

/** Build the `clan` update for `editClan`, setting `name` and `image`, using predicates on `id` and `name`. */
export const updateClanForEditClan = (
  client: Pick<DrizzleClient, "update">,
  input: { name: string },
  image: { avatar: string },
  fetchedClan: { id: string; name: string },
) =>
  client
    .update(clan)
    .set({ name: input.name, image: image.avatar })
    .where(and(eq(clan.id, fetchedClan.id), eq(clan.name, fetchedClan.name)));

/**
 * Build the `userData` update for `editClanColor`, setting `reputationPoints`, using
 * predicates on `userId` and `reputationPoints`.
 */
export const updateUserDataForEditClanColor = (
  client: Pick<DrizzleClient, "update">,
  user: { userId: string },
) =>
  client
    .update(userData)
    .set({
      reputationPoints: sql`${userData.reputationPoints} - ${CLAN_COLOR_CHANGE_REP_COST}`,
    })
    .where(
      and(
        eq(userData.userId, user.userId),
        gte(userData.reputationPoints, CLAN_COLOR_CHANGE_REP_COST),
      ),
    );

/** Build the `actionLog` insert for `editClanColor`. */
export const insertActionLogForEditClanColor = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  groupLabel: "clan" | "faction",
  input: { color: string },
  fetchedClan: { id: string; image: string },
  user: { username: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "clan",
    changes: [`Changed ${groupLabel.toLowerCase()} color to ${input.color}`],
    relatedId: fetchedClan.id,
    relatedMsg: `${user.username} changed the ${groupLabel.toLowerCase()} color`,
    relatedImage: fetchedClan.image,
  });

/** Build the `village` update for `editClanColor`, setting `hexColor`, using predicates on `id`. */
export const updateVillageForEditClanColor = (
  client: Pick<DrizzleClient, "update">,
  input: { color: string },
  fetchedClan: { villageId: string },
) =>
  client
    .update(village)
    .set({ hexColor: input.color })
    .where(eq(village.id, fetchedClan.villageId));

/** Build the `clan` update for `promoteMember`, using predicates on `id`. */
export const updateClanForPromoteMember = (
  client: Pick<DrizzleClient, "update">,
  updateData:
    | Pick<
        import("@/drizzle/schema").Clan,
        "leaderId" | "coLeader1" | "coLeader2" | "coLeader3"
      >
    | { [x: string]: string }
    | { coLeader1: string }
    | { coLeader2: string }
    | { coLeader3: string },
  fetchedClan: { id: string },
) => client.update(clan).set(updateData).where(eq(clan.id, fetchedClan.id));

/** Build the village leader assignment used by clan leadership changes. */
export const setClanVillageKage = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
  villageId: string,
) => client.update(village).set({ kageId: userId }).where(eq(village.id, villageId));

/** Build the `clan` update for `demoteMember`, using predicates on `id`. */
export const updateClanForDemoteMember = (
  client: Pick<DrizzleClient, "update">,
  clanData: {
    coLeader1: null | string;
    coLeader2: null | string;
    coLeader3: null | string;
    id: string;
  },
  member: { userId: string },
  isMemberAssassin: false | true,
  assasinField: CLAN_ASSASSIN_SLOT | undefined,
) =>
  client
    .update(clan)
    .set({
      coLeader1: clanData.coLeader1 === member.userId ? null : clanData.coLeader1,
      coLeader2: clanData.coLeader2 === member.userId ? null : clanData.coLeader2,
      coLeader3: clanData.coLeader3 === member.userId ? null : clanData.coLeader3,
      ...(isMemberAssassin && assasinField ? { [assasinField]: null } : {}),
    })
    .where(eq(clan.id, clanData.id));

/** Build the `clan` update for `kickMember`, setting `leaderId`, using predicates on `id`. */
export const updateClanForKickMember = (
  client: Pick<DrizzleClient, "update">,
  user: { userId: string },
  fetchedClan: { id: string },
) =>
  client
    .update(clan)
    .set({
      leaderId: user.userId, // Promote the kicker to leader
    })
    .where(eq(clan.id, fetchedClan.id));

/**
 * Build the `clan` update for `convertPointsToRyo`, setting `points` and `bank`,
 * including predicates on `id`, `points`, `leaderId`.
 */
export const updateClanForConvertPointsToRyo = (
  client: Pick<DrizzleClient, "update">,
  input: { points: number; clanId: string },
  ryo: number,
  ctx: { userId: string },
) =>
  client
    .update(clan)
    .set({
      points: sql`${clan.points} - ${input.points}`,
      bank: sql`${clan.bank} + ${ryo}`,
    })
    .where(
      and(
        eq(clan.id, input.clanId),
        gte(clan.points, input.points),
        or(
          eq(clan.leaderId, ctx.userId),
          eq(clan.coLeader1, ctx.userId),
          eq(clan.coLeader2, ctx.userId),
          eq(clan.coLeader3, ctx.userId),
        ),
      ),
    );

/** Build the `clan` update for `toBank`, setting `bank`, using predicates on `id`. */
export const updateClanForToBank = (
  client: Pick<DrizzleClient, "update">,
  input: { amount: number; clanId: string },
) =>
  client
    .update(clan)
    .set({ bank: sql`${clan.bank} + ${input.amount}` })
    .where(eq(clan.id, input.clanId));

/** Build the `clan` update for `purchaseBoost`, setting `` and `bank`, using predicates on `id` and `bank`. */
export const updateClanForPurchaseBoost = (
  client: Pick<DrizzleClient, "update">,
  input: {
    boostType: ClanBoostType;
  },
  cost: number,
  clanData: { id: string },
  currentBoost: number,
) =>
  client
    .update(clan)
    .set({
      [input.boostType]: sql`${clan[input.boostType]} + ${CLAN_BOOST_PERCENT_PER_LEVEL}`,
      bank: sql`${clan.bank} - ${cost}`,
    })
    .where(
      and(
        eq(clan.id, clanData.id),
        gte(clan.bank, cost),
        eq(clan[input.boostType], currentBoost),
      ),
    );

/** Build the `clan` listing for `nominateElder`, selecting only `id`, using predicates on `villageId`. */
export const listClanForNominateElder = (
  client: Pick<DrizzleClient, "query">,
  clanData: { villageId: string },
) =>
  client.query.clan.findMany({
    where: eq(clan.villageId, clanData.villageId),
    orderBy: [desc(clan.activityPoints), desc(clan.points)],
    limit: KAGE_MAX_ELDERS,
    columns: { id: true },
  });

/** Build the `clan` update for `nominateElder`, setting `elderNomineeId`, using predicates on `id`. */
export const updateClanForNominateElder = (
  client: Pick<DrizzleClient, "update">,
  input: { nomineeId: string },
  clanData: { id: string },
) =>
  client
    .update(clan)
    .set({ elderNomineeId: input.nomineeId })
    .where(eq(clan.id, clanData.id));

/** Build the `userData` update for `challengeClan`, setting `status`, including predicates on `userId`, `status`, `id`. */
export const updateUserDataForChallengeClan = (
  client: Pick<DrizzleClient, "update" | "select">,
  user: { userId: string },
) =>
  client
    .update(userData)
    .set({ status: "QUEUED" })
    .where(
      and(
        eq(userData.userId, user.userId),
        eq(userData.status, "AWAKE"),
        notExists(
          client
            .select({ id: mpvpBattleUser.id })
            .from(mpvpBattleUser)
            .where(eq(mpvpBattleUser.userId, user.userId)),
        ),
        notExists(
          client
            .select({ id: rankedPvpQueue.id })
            .from(rankedPvpQueue)
            .where(
              and(
                eq(rankedPvpQueue.userId, user.userId),
                eq(rankedPvpQueue.hasClaimed, true),
              ),
            ),
        ),
      ),
    );

/** Build the `mpvpBattleQueue` insert for `challengeClan`. */
export const insertMpvpBattleQueueForChallengeClan = (
  client: Pick<DrizzleClient, "insert">,
  clanBattleId: string,
  challenger: { id: string },
  defender: { id: string },
) =>
  client.insert(mpvpBattleQueue).values({
    id: clanBattleId,
    createdAt: new Date(),
    battleType: "CLAN_BATTLE",
    attackerEntityId: challenger.id,
    defenderEntityId: defender.id,
  });

/** Build clan-battle participant inserts for challenge and join operations. */
export const insertMpvpBattleUserForJoinClanBattle = (
  client: Pick<DrizzleClient, "insert">,
  entryId: string,
  user: { userId: string },
  input: { clanBattleId: string },
  side: "ATTACKER" | "DEFENDER",
  availableSlot: number,
) =>
  client.insert(mpvpBattleUser).values({
    id: entryId,
    userId: user.userId,
    clanBattleId: input.clanBattleId,
    side,
    slot: availableSlot,
  });

/** Build the `clan` listing for `deleteClanBattle`, including predicates on `leaderId`, `coLeader1`, `coLeader2`. */
export const listClanForDeleteClanBattle = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.clan.findMany({
    where: or(
      eq(clan.leaderId, ctx.userId),
      eq(clan.coLeader1, ctx.userId),
      eq(clan.coLeader2, ctx.userId),
      eq(clan.coLeader3, ctx.userId),
    ),
  });

/** Build the `actionLog` insert for `deleteClanBattle`. */
export const insertActionLogForDeleteClanBattle = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  clanBattleData: { attackerEntityId: string; id: string; battleId: null | string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "clan",
    relatedId: clanBattleData.attackerEntityId,
    changes: [
      `Deleted clan battle ${clanBattleData.id} (combat ${clanBattleData.battleId ?? "pending"})`,
    ],
  });

/**
 * Build the `mpvpBattleQueue` update for `initiateClanBattle`, setting `battleId`,
 * including predicates on `id`, `battleType`, `battleId`.
 */
export const updateMpvpBattleQueueForInitiateClanBattle = (
  client: Pick<DrizzleClient, "update">,
  battleId: string,
  input: { clanBattleId: string },
) =>
  client
    .update(mpvpBattleQueue)
    .set({ battleId })
    .where(
      and(
        eq(mpvpBattleQueue.id, input.clanBattleId),
        eq(mpvpBattleQueue.battleType, "CLAN_BATTLE"),
        isNull(mpvpBattleQueue.battleId),
        isNull(mpvpBattleQueue.winnerId),
      ),
    );

/**
 * Build the `userData` update for `initiateClanBattle`, setting `status`, including
 * predicates on `userId`, `status`, `battleId`.
 */
export const updateUserDataForInitiateClanBattle = (
  client: Pick<DrizzleClient, "update" | "select">,
  allIds: string[],
  input: { clanBattleId: string },
  battleId: string,
) =>
  client
    .update(userData)
    .set({ status: "AWAKE" })
    .where(
      and(
        inArray(userData.userId, allIds),
        eq(userData.status, "QUEUED"),
        isNull(userData.battleId),
        sql`NOT EXISTS (SELECT 1 FROM ${dungeonMember} INNER JOIN ${dungeonRun} ON ${dungeonRun.id} = ${dungeonMember.runId} WHERE ${dungeonMember.activeUserId} = ${userData.userId} AND ${dungeonRun.status} NOT IN ('COMPLETED', 'ENDED'))`,
        // Recheck membership and the reserved lobby at the write: deletion can
        // release surplus players into another queue after startup's final read.
        exists(
          client
            .select({ id: mpvpBattleUser.id })
            .from(mpvpBattleUser)
            .innerJoin(
              mpvpBattleQueue,
              eq(mpvpBattleUser.clanBattleId, mpvpBattleQueue.id),
            )
            .where(
              and(
                eq(mpvpBattleUser.userId, userData.userId),
                eq(mpvpBattleQueue.id, input.clanBattleId),
                eq(mpvpBattleQueue.battleId, battleId),
              ),
            ),
        ),
        not(
          exists(
            client
              .select({ id: rankedPvpQueue.id })
              .from(rankedPvpQueue)
              .where(
                and(
                  eq(rankedPvpQueue.userId, userData.userId),
                  eq(rankedPvpQueue.hasClaimed, true),
                ),
              ),
          ),
        ),
      ),
    );

/** Build the `userData` update for `instantJoinAndLead`, setting `clanId` and `villageId`, using predicates on `userId`. */
export const updateUserDataForInstantJoinAndLead = (
  client: Pick<DrizzleClient, "update">,
  fetchedClan: { id: string; village: { id: string } },
  user: { userId: string },
) =>
  client
    .update(userData)
    .set({ clanId: fetchedClan.id, villageId: fetchedClan.village?.id })
    .where(eq(userData.userId, user.userId));

/** Build the `clan` update for `instantJoinAndLead`, using predicates on `id`. */
export const updateClanForInstantJoinAndLead = (
  client: Pick<DrizzleClient, "update">,
  user: { userId: string },
  fetchedClan: { id: string },
) =>
  client
    .update(clan)
    .set({
      leaderId: user.userId,
      coLeader1: null,
      coLeader2: null,
      coLeader3: null,
    })
    .where(eq(clan.id, fetchedClan.id));

/** Build the `clan` update for `clearLeadership`, using predicates on `id`. */
export const updateClanForClearLeadership = (
  client: Pick<DrizzleClient, "update">,
  fetchedClan: { id: string },
) =>
  client
    .update(clan)
    .set({
      coLeader1: null,
      coLeader2: null,
      coLeader3: null,
      assassin1: null,
      assassin2: null,
      assassin3: null,
      assassin4: null,
      assassin5: null,
      assassin6: null,
      assassin7: null,
      assassin8: null,
      assassin9: null,
      assassin10: null,
    })
    .where(eq(clan.id, fetchedClan.id));

/**
 * Build the `mpvpBattleQueue` lookup for `hasClanBattleJoin`, selecting only `id`,
 * including predicates on `id`, `battleId`, `winnerId`.
 */
export const findMpvpBattleQueueForHasClanBattleJoin = (
  client: Pick<DrizzleClient, "query" | "select">,
  clanBattleId: string,
  entryId: string,
  userId: string,
) =>
  client.query.mpvpBattleQueue.findFirst({
    columns: { id: true },
    where: and(
      eq(mpvpBattleQueue.id, clanBattleId),
      isNull(mpvpBattleQueue.battleId),
      isNull(mpvpBattleQueue.winnerId),
      exists(
        client
          .select({ id: mpvpBattleUser.id })
          .from(mpvpBattleUser)
          .innerJoin(userData, eq(userData.userId, mpvpBattleUser.userId))
          .where(
            and(
              eq(mpvpBattleUser.clanBattleId, clanBattleId),
              eq(mpvpBattleUser.id, entryId),
              eq(userData.userId, userId),
              eq(userData.status, "QUEUED"),
              isNull(userData.battleId),
            ),
          ),
      ),
      notExists(
        client
          .select({ id: rankedPvpQueue.id })
          .from(rankedPvpQueue)
          .where(
            and(eq(rankedPvpQueue.userId, userId), eq(rankedPvpQueue.hasClaimed, true)),
          ),
      ),
    ),
  });

/** Build deletion of one multiplayer battle roster entry. */
export const deleteBattleQueueMemberById = (
  client: Pick<DrizzleClient, "delete">,
  entryId: string,
) => client.delete(mpvpBattleUser).where(eq(mpvpBattleUser.id, entryId));

/**
 * Build the `userData` update for `undoClanBattleJoin`, setting `status`, including
 * predicates on `userId`, `status`, `battleId`.
 */
export const updateUserDataForUndoClanBattleJoin = (
  client: Pick<DrizzleClient, "update" | "select">,
  userId: string,
) =>
  client
    .update(userData)
    .set({ status: "AWAKE" })
    .where(
      and(
        eq(userData.userId, userId),
        eq(userData.status, "QUEUED"),
        isNull(userData.battleId),
        sql`NOT EXISTS (SELECT 1 FROM ${dungeonMember} INNER JOIN ${dungeonRun} ON ${dungeonRun.id} = ${dungeonMember.runId} WHERE ${dungeonMember.activeUserId} = ${userData.userId} AND ${dungeonRun.status} NOT IN ('COMPLETED', 'ENDED'))`,
        not(
          exists(
            client
              .select({ id: rankedPvpQueue.id })
              .from(rankedPvpQueue)
              .where(
                and(
                  eq(rankedPvpQueue.userId, userData.userId),
                  eq(rankedPvpQueue.hasClaimed, true),
                ),
              ),
          ),
        ),
        not(
          exists(
            client
              .select({ one: sql`1` })
              .from(mpvpBattleUser)
              .innerJoin(
                mpvpBattleQueue,
                eq(mpvpBattleUser.clanBattleId, mpvpBattleQueue.id),
              )
              .where(
                and(
                  eq(mpvpBattleUser.userId, userId),
                  isNull(mpvpBattleQueue.winnerId),
                ),
              ),
          ),
        ),
      ),
    );

/** Build the `userData` update for `removeFromClan`, using predicates on `userId`. */
export const updateUserDataForRemoveFromClan = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
) =>
  client
    .update(userData)
    .set({
      clanId: null,
      status: sql`CASE WHEN status = "QUEUED" AND NOT EXISTS (SELECT 1 FROM ${dungeonMember} INNER JOIN ${dungeonRun} ON ${dungeonRun.id} = ${dungeonMember.runId} WHERE ${dungeonMember.activeUserId} = ${userData.userId} AND ${dungeonRun.status} NOT IN ('COMPLETED', 'ENDED')) THEN "AWAKE" ELSE status END`,
      villageId: sql`CASE WHEN isOutlaw = 1 THEN ${VILLAGE_SYNDICATE_ID} ELSE villageId END`,
    })
    .where(eq(userData.userId, userId));

/** Build the `userRequest` deletion for `removeFromClan`, using predicates on `type`, `senderId`, `receiverId`. */
export const deleteUserRequestForRemoveFromClan = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) =>
  client
    .delete(userRequest)
    .where(
      and(
        eq(userRequest.type, "CLAN"),
        or(eq(userRequest.senderId, userId), eq(userRequest.receiverId, userId)),
      ),
    );

/** Build deletion of a user’s multiplayer battle roster entries. */
export const deleteBattleQueueMembersForUser = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
) => client.delete(mpvpBattleUser).where(eq(mpvpBattleUser.userId, userId));

/** Build the `actionLog` insert for `removeFromClan`. */
export const insertActionLogForRemoveFromClan = (
  client: Pick<DrizzleClient, "insert">,
  userId: string,
  reasons: string[],
  clanData: { id: string; name: string; image: string },
  user: { username: string; isOutlaw: false | true },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: userId,
    tableName: "clan",
    changes: reasons,
    relatedId: clanData.id,
    relatedMsg: `${user.username} removed from ${user.isOutlaw ? "faction" : "clan"}: ${clanData.name}`,
    relatedImage: clanData.image,
  });

/** Build the `village` deletion for `removeFromClan`, using predicates on `id`. */
export const deleteVillageForRemoveFromClan = (
  client: Pick<DrizzleClient, "delete">,
  clanData: { villageId: string },
) => client.delete(village).where(eq(village.id, clanData.villageId));

/** Build the `villageStructure` deletion for `removeFromClan`, using predicates on `villageId`. */
export const deleteVillageStructureForRemoveFromClan = (
  client: Pick<DrizzleClient, "delete">,
  clanData: { villageId: string },
) =>
  client
    .delete(villageStructure)
    .where(eq(villageStructure.villageId, clanData.villageId));

/** Build the `war` deletion for `removeFromClan`, using predicates on `attackerVillageId`. */
export const deleteWarForRemoveFromClan = (
  client: Pick<DrizzleClient, "delete">,
  clanData: { villageId: string },
) => client.delete(war).where(eq(war.attackerVillageId, clanData.villageId));

/** Build the `war` deletion for `removeFromClan`, using predicates on `defenderVillageId`. */
export const deleteWarForRemoveFromClan2 = (
  client: Pick<DrizzleClient, "delete">,
  clanData: { villageId: string },
) => client.delete(war).where(eq(war.defenderVillageId, clanData.villageId));

/** Build the `warAlly` deletion for `removeFromClan`, using predicates on `villageId`. */
export const deleteWarAllyForRemoveFromClan = (
  client: Pick<DrizzleClient, "delete">,
  clanData: { villageId: string },
) => client.delete(warAlly).where(eq(warAlly.villageId, clanData.villageId));

/** Build the `warKill` deletion for `removeFromClan`, using predicates on `killerVillageId`. */
export const deleteWarKillForRemoveFromClan = (
  client: Pick<DrizzleClient, "delete">,
  clanData: { villageId: string },
) => client.delete(warKill).where(eq(warKill.killerVillageId, clanData.villageId));

/** Build the `warKill` deletion for `removeFromClan`, using predicates on `victimVillageId`. */
export const deleteWarKillForRemoveFromClan2 = (
  client: Pick<DrizzleClient, "delete">,
  clanData: { villageId: string },
) => client.delete(warKill).where(eq(warKill.victimVillageId, clanData.villageId));

/** Build the `sector` deletion for `removeFromClan`, using predicates on `villageId`. */
export const deleteSectorForRemoveFromClan = (
  client: Pick<DrizzleClient, "delete">,
  clanData: { villageId: string },
) => client.delete(sector).where(eq(sector.villageId, clanData.villageId));

/** Build the `clan` deletion for `removeFromClan`, using predicates on `id`. */
export const deleteClanForRemoveFromClan = (
  client: Pick<DrizzleClient, "delete">,
  clanData: { id: string },
) => client.delete(clan).where(eq(clan.id, clanData.id));

/** Build the `userData` update for `removeFromClan`, using predicates on `clanId` and `userId`. */
export const updateUserDataForRemoveFromClan2 = (
  client: Pick<DrizzleClient, "update">,
  clanData: { id: string },
  userId: string,
) =>
  client
    .update(userData)
    .set({
      clanId: null,
      status: sql`CASE WHEN status = "QUEUED" AND NOT EXISTS (SELECT 1 FROM ${dungeonMember} INNER JOIN ${dungeonRun} ON ${dungeonRun.id} = ${dungeonMember.runId} WHERE ${dungeonMember.activeUserId} = ${userData.userId} AND ${dungeonRun.status} NOT IN ('COMPLETED', 'ENDED')) THEN "AWAKE" ELSE status END`,
      villageId: sql`CASE WHEN isOutlaw = 1 THEN ${VILLAGE_SYNDICATE_ID} ELSE villageId END`,
    })
    // Exclude the leaver, whose row the primary-key update above already
    // covers; two overlapping updates on UserData deadlock InnoDB.
    .where(and(eq(userData.clanId, clanData.id), ne(userData.userId, userId)));

/** Build the `clan` update for `removeFromClan`, using predicates on `id`. */
export const updateClanForRemoveFromClan = (
  client: Pick<DrizzleClient, "update">,
  isLeader: false | true,
  otherUser: Pick<
    import("@/drizzle/schema").UserData,
    | "userId"
    | "anbuId"
    | "username"
    | "rank"
    | "isOutlaw"
    | "level"
    | "avatar"
    | "pvpExperience"
  >,
  clanData: {
    leaderId: string;
    coLeader1: null | string;
    coLeader2: null | string;
    coLeader3: null | string;
    elderNomineeId: null | string;
    id: string;
  },
  coLeadersToRemove: (null | string)[],
  userId: string,
) =>
  client
    .update(clan)
    .set({
      leaderId: isLeader && otherUser ? otherUser.userId : clanData.leaderId,
      coLeader1: coLeadersToRemove.includes(clanData.coLeader1)
        ? null
        : clanData.coLeader1,
      coLeader2: coLeadersToRemove.includes(clanData.coLeader2)
        ? null
        : clanData.coLeader2,
      coLeader3: coLeadersToRemove.includes(clanData.coLeader3)
        ? null
        : clanData.coLeader3,
      elderNomineeId:
        clanData.elderNomineeId === userId ? null : clanData.elderNomineeId,
    })
    .where(eq(clan.id, clanData.id));

/** Build the `village` update for `removeFromClan`, setting `kageId`, using predicates on `id` and `type`. */
export const updateVillageForRemoveFromClan = (
  client: Pick<DrizzleClient, "update">,
  isLeader: false | true,
  otherUser: Pick<
    import("@/drizzle/schema").UserData,
    | "userId"
    | "anbuId"
    | "username"
    | "rank"
    | "isOutlaw"
    | "level"
    | "avatar"
    | "pvpExperience"
  >,
  clanData: { leaderId: string },
  user: { villageId: null | string },
) =>
  client
    .update(village)
    .set({
      kageId: isLeader && otherUser ? otherUser.userId : clanData.leaderId,
    })
    .where(
      and(
        eq(village.id, user.villageId ?? VILLAGE_SYNDICATE_ID),
        or(eq(village.type, "HIDEOUT"), eq(village.type, "STRONGHOLD")),
      ),
    );

/**
 * Build the `mpvpBattleQueue` deletion for `removeFromClanBattle`, including
 * predicates on `id`, `battleType`, `battleId`.
 */
export const deleteMpvpBattleQueueForRemoveFromClanBattle = (
  client: Pick<DrizzleClient, "delete" | "select">,
  clanBattleId: string,
  entry: { id: string },
) =>
  client.delete(mpvpBattleQueue).where(
    and(
      eq(mpvpBattleQueue.id, clanBattleId),
      eq(mpvpBattleQueue.battleType, "CLAN_BATTLE"),
      isNull(mpvpBattleQueue.battleId),
      isNull(mpvpBattleQueue.winnerId),
      notExists(
        client
          .select({ id: mpvpBattleUser.id })
          .from(mpvpBattleUser)
          .where(
            and(
              eq(mpvpBattleUser.clanBattleId, clanBattleId),
              ne(mpvpBattleUser.id, entry.id),
            ),
          ),
      ),
    ),
  );

/** Build the `village` selection for `GET`, using predicates on `type` and `lastMaintenancePaidAt`. */
export const selectVillageForGET = (client: Pick<DrizzleClient, "select">) =>
  client
    .select()
    .from(village)
    .innerJoin(clan, eq(village.id, clan.villageId))
    .where(
      and(
        eq(village.type, "STRONGHOLD"),
        lt(village.lastMaintenancePaidAt, sql`NOW() - INTERVAL 30 DAY`),
      ),
    );

/** Build the locking maintenance derived table for the downgrade UPDATE; it must remain part of that single statement. */
export const selectVillageForGET2 = (
  client: Pick<DrizzleClient, "select">,
  guards: undefined | SQL<unknown>,
) =>
  client
    .select({ id: village.id, points: clan.points })
    .from(village)
    .innerJoin(clan, eq(clan.villageId, village.id))
    .where(guards)
    .limit(1)
    .for("update")
    .as("maintenance_snapshot");

/** Execute the database statement for `GET`. */
export const executeRowsForGET = (
  client: Pick<DrizzleClient, "execute">,
  snapshot: ReturnType<typeof selectVillageForGET2>,
  canPay: SQL<unknown>,
  guards: undefined | SQL<unknown>,
) =>
  client.execute(sql`
            UPDATE ${village}
            INNER JOIN ${clan} ON ${clan.villageId} = ${village.id}
            INNER JOIN ${snapshot} ON ${snapshot.id} = ${village.id}
            SET ${clan.points} = IF(${canPay}, ${snapshot.points} - ${STRONGHOLD_MONTHLY_MAINTENANCE}, ${snapshot.points}),
                ${village.lastMaintenancePaidAt} = ${new Date()},
                ${village.type} = IF(${canPay}, ${village.type}, 'HIDEOUT'),
                ${village.wasDowngraded} = IF(${canPay}, ${village.wasDowngraded}, TRUE)
            WHERE ${guards}
          `);

/** Build the `clan` update for `decayClansAndAnbu`. */
export const updateClanForDecayClansAndAnbu = (client: Pick<DrizzleClient, "update">) =>
  client.update(clan).set({
    pvpActivity: sql`${clan.pvpActivity} * 0.95`,
    trainingBoost: sql`GREATEST(${clan.trainingBoost} - ${CLAN_BOOST_PERCENT_PER_LEVEL}, 0)`,
    ryoBoost: sql`GREATEST(${clan.ryoBoost} - ${CLAN_BOOST_PERCENT_PER_LEVEL}, 0)`,
    regenBoost: sql`GREATEST(${clan.regenBoost} - ${CLAN_BOOST_PERCENT_PER_LEVEL}, 0)`,
    missionRewardBoost: sql`GREATEST(${clan.missionRewardBoost} - ${CLAN_BOOST_PERCENT_PER_LEVEL}, 0)`,
    craftingTimeBoost: sql`GREATEST(${clan.craftingTimeBoost} - ${CLAN_BOOST_PERCENT_PER_LEVEL}, 0)`,
    craftingExpBoost: sql`GREATEST(${clan.craftingExpBoost} - ${CLAN_BOOST_PERCENT_PER_LEVEL}, 0)`,
    hunterExpBoost: sql`GREATEST(${clan.hunterExpBoost} - ${CLAN_BOOST_PERCENT_PER_LEVEL}, 0)`,
    gathererExpBoost: sql`GREATEST(${clan.gathererExpBoost} - ${CLAN_BOOST_PERCENT_PER_LEVEL}, 0)`,
  });

/** Execute the database statement for `rewardClanBattleVictory`. */
export const executeCreditedForRewardClanBattleVictory = (
  client: Pick<DrizzleClient, "execute">,
  clanId: string,
  battleId: string,
) =>
  client.execute(sql`
      UPDATE ${mpvpBattleQueue}
      INNER JOIN ${clan} ON ${clan.id} = ${clanId}
      SET ${mpvpBattleQueue.winnerId} = ${clanId},
          ${clan.points} = ${clan.points} + ${CLAN_BATTLE_REWARD_POINTS},
          ${clan.activityPoints} = ${clan.activityPoints} + ${CLAN_BATTLE_REWARD_POINTS},
          ${clan.bank} = ${clan.bank} + ${CLAN_BATTLE_REWARD_RYO},
          ${clan.pvpActivity} = ${clan.pvpActivity} + 1
      WHERE ${mpvpBattleQueue.battleId} = ${battleId}
        AND ${mpvpBattleQueue.battleType} = 'CLAN_BATTLE'
        AND ${mpvpBattleQueue.winnerId} IS NULL
        AND (${mpvpBattleQueue.attackerEntityId} = ${clanId}
          OR ${mpvpBattleQueue.defenderEntityId} = ${clanId})
    `);

/** Build the `mpvpBattleQueue` deletion for `deleteClanBattle`, using predicates on `id`, `battleType`, `battleId`. */
export const deleteMpvpBattleQueueForDeleteClanBattle = (
  client: Pick<DrizzleClient, "delete">,
  snapshot: { id: string; battleId: null | string },
) =>
  client
    .delete(mpvpBattleQueue)
    .where(
      and(
        eq(mpvpBattleQueue.id, snapshot.id),
        eq(mpvpBattleQueue.battleType, "CLAN_BATTLE"),
        snapshot.battleId !== null
          ? eq(mpvpBattleQueue.battleId, snapshot.battleId)
          : isNull(mpvpBattleQueue.battleId),
      ),
    );

/**
 * Build the `userData` update for `deleteClanBattle`, setting `status`, including
 * predicates on `status`, `battleId`, `userId`.
 */
export const updateUserDataForDeleteClanBattle = (
  client: Pick<DrizzleClient, "update" | "select">,
  snapshot: { id: string },
) =>
  client
    .update(userData)
    .set({ status: "AWAKE" })
    .where(
      and(
        eq(userData.status, "QUEUED"),
        isNull(userData.battleId),
        sql`NOT EXISTS (SELECT 1 FROM ${dungeonMember} INNER JOIN ${dungeonRun} ON ${dungeonRun.id} = ${dungeonMember.runId} WHERE ${dungeonMember.activeUserId} = ${userData.userId} AND ${dungeonRun.status} NOT IN ('COMPLETED', 'ENDED'))`,
        inArray(
          userData.userId,
          client
            .select({ userId: mpvpBattleUser.userId })
            .from(mpvpBattleUser)
            .where(eq(mpvpBattleUser.clanBattleId, snapshot.id)),
        ),
        notExists(
          client
            .select({ id: rankedPvpQueue.id })
            .from(rankedPvpQueue)
            .where(
              and(
                eq(rankedPvpQueue.userId, userData.userId),
                eq(rankedPvpQueue.hasClaimed, true),
              ),
            ),
        ),
      ),
    );

/** Build deletion of a multiplayer battle team’s roster entries. */
export const deleteBattleQueueMembersForTeam = (
  client: Pick<DrizzleClient, "delete">,
  teamId: string,
) => client.delete(mpvpBattleUser).where(eq(mpvpBattleUser.clanBattleId, teamId));

/** Build the `battle` deletion for `clearClanCombat`, using predicates on `id` and `battleType`. */
export const deleteBattleForClearClanCombat = (
  client: Pick<DrizzleClient, "delete">,
  battleId: string,
) =>
  client
    .delete(battle)
    .where(and(eq(battle.id, battleId), eq(battle.battleType, "CLAN_BATTLE")));

/** Build the `userData` update for `clearClanCombat`, using predicates on `battleId`. */
export const updateUserDataForClearClanCombat = (
  client: Pick<DrizzleClient, "update">,
  battleId: string,
) =>
  client
    .update(userData)
    .set({
      status: sql`CASE WHEN ${userData.status} = 'BATTLE' THEN 'AWAKE' ELSE ${userData.status} END`,
      bracketImmunityLiftedUntil: resumeBracketImmunitySql(),
      bracketImmunityPausedAt: null,
      battleId: null,
    })
    .where(eq(userData.battleId, battleId));

/** Build the `battleAction` deletion for `clearClanCombat`, using predicates on `battleId`. */
export const deleteBattleActionForClearClanCombat = (
  client: Pick<DrizzleClient, "delete">,
  battleId: string,
) => client.delete(battleAction).where(eq(battleAction.battleId, battleId));
