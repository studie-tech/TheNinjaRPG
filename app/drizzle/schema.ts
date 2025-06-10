import { z } from "zod";
import {
  mysqlTable,
  boolean,
  customType,
  uniqueIndex,
  varchar,
  datetime,
  date,
  mysqlEnum,
  json,
  int,
  bigint,
  smallint,
  index,
  float,
  text,
  tinyint,
  double,
  primaryKey,
  unique,
  timestamp,
} from "drizzle-orm/mysql-core";
import * as consts from "@/drizzle/constants";
import { createInsertSchema } from "drizzle-zod";
import { relations } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { AllTags, SuperRefineEffects } from "@/libs/combat/types";
import type { ZodAllTags } from "@/libs/combat/types";
import type { QuestContentType } from "@/validators/objectives";
import type { QuestTrackerType } from "@/validators/objectives";
import type { ObjectiveRewardType } from "@/validators/objectives";
import type { AiRuleType } from "@/validators/ai";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import type { AdditionalContext } from "@/validators/reports";
import type { ZodBgSchemaType } from "@/validators/backgroundSchema";
import type { CoreMessage } from "ai";

export const vector = customType<{
  data: ArrayBuffer;
  config: { length: number };
  configRequired: true;
  driverData: Buffer;
}>({
  dataType(config) {
    return `VECTOR(${config.length})`;
  },
  fromDriver(value) {
    return value.buffer as ArrayBuffer;
  },
  toDriver(value) {
    return Buffer.from(value);
  },
});

export const gameAsset = mysqlTable(
  "GameAsset",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    name: varchar("name", { length: 191 }).notNull(),
    type: mysqlEnum("type", consts.GameAssetTypes).notNull(),
    image: varchar("image", { length: 191 }).notNull(),
    frames: tinyint("frames").default(1).notNull(),
    speed: tinyint("speed").default(1).notNull(),
    hidden: boolean("hidden").default(true).notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    licenseDetails: text("licenseDetails").default("TNR").notNull(),
    createdByUserId: varchar("createdByUserId", { length: 191 }),
    onInitialBattleField: boolean("onInitialBattleField").default(false).notNull(),
  },
  (table) => {
    return {
      type: index("GameAsset_type_idx").on(table.type),
    };
  },
);
export type GameAsset = InferSelectModel<typeof gameAsset>;

export const gameAssetTag = mysqlTable(
  "GameAssetTag",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    assetId: varchar("assetId", { length: 191 }).notNull(),
    tagId: varchar("tagId", { length: 191 }).notNull(),
  },
  (table) => {
    return {
      assetIdTagKey: uniqueIndex("GameAssetTag_assetId_tag_key").on(
        table.assetId,
        table.tagId,
      ),
    };
  },
);

export const contentTag = mysqlTable(
  "ContentTag",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    name: varchar("name", { length: 191 }).notNull(),
  },
  (table) => {
    return {
      nameKey: uniqueIndex("ContentTag_name_key").on(table.name),
    };
  },
);

export const aiProfile = mysqlTable(
  "AiProfile",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    userId: varchar("userId", { length: 191 }).notNull(),
    rules: json("rules").$type<AiRuleType[]>().notNull(),
    includeDefaultRules: boolean("includeDefaultRules").default(true).notNull(),
  },
  (table) => {
    return {
      userIdIdx: uniqueIndex("AiProfile_userId_idx").on(table.userId),
    };
  },
);

export type AiProfile = InferSelectModel<typeof aiProfile>;

export const aiProfileRelations = relations(aiProfile, ({ one }) => ({
  user: one(userData, {
    fields: [aiProfile.userId],
    references: [userData.userId],
  }),
}));

export const anbuSquad = mysqlTable(
  "AnbuSquad",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    image: varchar("image", { length: 191 }).notNull(),
    name: varchar("name", { length: 191 }).notNull(),
    leaderId: varchar("leaderId", { length: 191 }),
    villageId: varchar("villageId", { length: 191 }).notNull(),
    pvpActivity: int("pvpActivity").default(0).notNull(),
    kageOrderId: varchar("kageOrderId", { length: 191 }).notNull(),
    leaderOrderId: varchar("leaderOrderId", { length: 191 }).notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
  },
  (table) => {
    return {
      nameKey: uniqueIndex("AnbuSquad_name_key").on(table.name),
      leaderIdIdx: index("AnbuSquad_leaderId_idx").on(table.leaderId),
      villageIdIdx: index("AnbuSquad_villageId_idx").on(table.villageId),
    };
  },
);
export type AnbuSquad = InferSelectModel<typeof anbuSquad>;

export const anbuSquadRelations = relations(anbuSquad, ({ one, many }) => ({
  leader: one(userData, {
    fields: [anbuSquad.leaderId],
    references: [userData.userId],
  }),
  members: many(userData),
  kageOrder: one(userNindo, {
    fields: [anbuSquad.kageOrderId],
    references: [userNindo.userId],
  }),
  leaderOrder: one(userNindo, {
    fields: [anbuSquad.leaderOrderId],
    references: [userNindo.userId],
  }),
}));

export const battle = mysqlTable(
  "Battle",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    roundStartAt: datetime("roundStartAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    background: varchar("background", { length: 191 }).notNull(),
    battleType: mysqlEnum("battleType", consts.BattleTypes).notNull(),
    usersState: json("usersState").notNull(),
    usersEffects: json("usersEffects").notNull(),
    groundEffects: json("groundEffects").notNull(),
    rewardScaling: double("rewardScaling").default(1).notNull(),
    version: int("version").default(1).notNull(),
    round: int("round").default(1).notNull(),
    activeUserId: varchar("activeUserId", { length: 191 }),
  },
  (table) => {
    return {
      idVersionKey: uniqueIndex("Battle_id_version_key").on(table.id, table.version),
    };
  },
);
export type Battle = InferSelectModel<typeof battle>;

export const battleAction = mysqlTable(
  "BattleAction",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    battleId: varchar("battleId", { length: 191 }).notNull(),
    battleVersion: int("battleVersion").notNull(),
    battleRound: int("battleRound").default(0).notNull(),
    description: text("description").notNull(),
    appliedEffects: json("appliedEffects").notNull(),
  },
  (table) => {
    return {
      round: uniqueIndex("BattleAction_round_key").on(
        table.battleId,
        table.battleVersion,
        table.battleRound,
      ),
      createdAtIdx: index("BattleAction_createdAt_idx").on(table.createdAt),
    };
  },
);

export const battleActionRelations = relations(battleAction, ({ one }) => ({
  battle: one(battle, {
    fields: [battleAction.battleId, battleAction.battleVersion],
    references: [battle.id, battle.version],
  }),
  historyEntry: one(battleHistory, {
    fields: [battleAction.battleId],
    references: [battleHistory.battleId],
  }),
}));

export const battleHistory = mysqlTable(
  "BattleHistory",
  {
    id: int("id").autoincrement().primaryKey().notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    battleId: varchar("battleId", { length: 191 }).notNull(),
    battleType: mysqlEnum("battleType", consts.BattleTypes),
    attackedId: varchar("attackedId", { length: 191 }).notNull(),
    defenderId: varchar("defenderId", { length: 191 }).notNull(),
  },
  (table) => {
    return {
      createdAtIdx: index("BattleHistory_createdAt_idx").on(table.createdAt),
      battleIdIdx: index("BattleHistory_battleId_idx").on(table.battleId),
      battleTypeIdx: index("BattleHistory_battleType_idx").on(table.battleType),
      battleWinnerIdx: index("BattleHistory_attackedId_idx").on(table.attackedId),
      battleLoserIdx: index("BattleHistory_defenderId_idx").on(table.defenderId),
    };
  },
);

export const battleHistoryRelations = relations(battleHistory, ({ one, many }) => ({
  battle: one(battle, {
    fields: [battleHistory.battleId],
    references: [battle.id],
  }),
  actions: many(battleAction),
  attacker: one(userData, {
    fields: [battleHistory.attackedId],
    references: [userData.userId],
  }),
  defender: one(userData, {
    fields: [battleHistory.defenderId],
    references: [userData.userId],
  }),
}));

export const emailReminder = mysqlTable("EmailReminder", {
  id: int("id").autoincrement().primaryKey().notNull(),
  userId: varchar("userId", { length: 191 }),
  callName: varchar("callName", { length: 191 }),
  email: varchar("email", { length: 191 }).notNull(),
  latestRejoinRequest: datetime("latestRejoinRequest", { mode: "date", fsp: 3 }),
  lastActivity: datetime("lastActivity", { mode: "date", fsp: 3 }),
  createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
    .default(sql`(CURRENT_TIMESTAMP(3))`)
    .notNull(),
  secret: varchar("secret", { length: 191 }).notNull(),
  disabled: boolean("disabled").default(false).notNull(),
  validated: boolean("validated").default(true).notNull(),
});

export const userBlackList = mysqlTable(
  "UserBlackList",
  {
    id: int("id").autoincrement().primaryKey().notNull(),
    creatorUserId: varchar("creatorUserId", { length: 191 }).notNull(),
    targetUserId: varchar("targetUserId", { length: 191 }).notNull(),
    updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
  },
  (table) => {
    return {
      creatorUserIdIdx: index("BlackList_creatorUserId_idx").on(table.creatorUserId),
      targetUserIdIdx: index("BlackList_targetUserId_idx").on(table.targetUserId),
    };
  },
);

export const userBlackListRelations = relations(userBlackList, ({ one }) => ({
  creator: one(userData, {
    fields: [userBlackList.creatorUserId],
    references: [userData.userId],
    relationName: "creatorBlacklist",
  }),
  target: one(userData, {
    fields: [userBlackList.targetUserId],
    references: [userData.userId],
  }),
}));

export const bloodline = mysqlTable(
  "Bloodline",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    name: varchar("name", { length: 191 }).notNull(),
    image: varchar("image", { length: 191 }).notNull(),
    statClassification: mysqlEnum("statClassification", consts.StatTypes),
    description: text("description").notNull(),
    effects: json("effects").$type<ZodAllTags[]>().notNull(),
    regenIncrease: int("regenIncrease").default(0).notNull(),
    villageId: varchar("villageId", { length: 191 }).default(sql`NULL`),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    rank: mysqlEnum("rank", consts.LetterRanks).notNull(),
    hidden: boolean("hidden").default(false).notNull(),
  },
  (table) => {
    return {
      nameKey: uniqueIndex("Bloodline_name_key").on(table.name),
      imageKey: index("Bloodline_image_key").on(table.image),
      villageIdx: index("Bloodline_village_idx").on(table.villageId),
      rankIdx: index("Bloodline_rank_idx").on(table.rank),
    };
  },
);
export type Bloodline = InferSelectModel<typeof bloodline>;
export type BloodlineRank = Bloodline["rank"];

export const bloodlineRelations = relations(bloodline, ({ one, many }) => ({
  users: many(userData),
  village: one(village, {
    fields: [bloodline.villageId],
    references: [village.id],
  }),
}));

export const bloodlineRolls = mysqlTable(
  "BloodlineRolls",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    userId: varchar("userId", { length: 191 }).notNull(),
    bloodlineId: varchar("bloodlineId", { length: 191 }),
    used: smallint("used").default(0).notNull(),
    pityRolls: tinyint("pityRolls").default(0).notNull(),
    type: mysqlEnum("type", consts.BLOODLINE_ROLL_TYPES).default("NATURAL").notNull(),
    goal: mysqlEnum("rank", consts.LetterRanks),
  },
  (table) => {
    return {
      userIdKey: index("BloodlineRolls_userId_idx").on(table.userId),
      bloodlineIdIdx: index("BloodlineRolls_bloodlineId_idx").on(table.bloodlineId),
    };
  },
);
export type BloodlineRolls = InferSelectModel<typeof bloodlineRolls>;

export const bloodlineRollsRelations = relations(bloodlineRolls, ({ one }) => ({
  bloodline: one(bloodline, {
    fields: [bloodlineRolls.bloodlineId],
    references: [bloodline.id],
  }),
}));

export const captcha = mysqlTable(
  "Captcha",
  {
    id: int("id").autoincrement().primaryKey().notNull(),
    userId: varchar("userId", { length: 191 }).notNull(),
    value: varchar("captcha", { length: 191 }).notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3) + INTERVAL 1 DAY )`)
      .notNull(),
    success: boolean("success").default(false).notNull(),
    used: boolean("used").default(false).notNull(),
  },
  (table) => {
    return {
      userId: index("Captcha_userId_key").on(table.userId),
      usedIdx: index("Captcha_used_idx").on(table.used),
    };
  },
);

export const clan = mysqlTable(
  "Clan",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    name: varchar("name", { length: 191 }).notNull(),
    image: varchar("image", { length: 191 }).notNull(),
    villageId: varchar("villageId", { length: 191 }).notNull(),
    founderId: varchar("founderId", { length: 191 }).notNull(),
    leaderId: varchar("leaderId", { length: 191 }).notNull(),
    coLeader1: varchar("coLeader1", { length: 191 }),
    coLeader2: varchar("coLeader2", { length: 191 }),
    coLeader3: varchar("coLeader3", { length: 191 }),
    leaderOrderId: varchar("leaderOrderId", { length: 191 }).notNull(),
    trainingBoost: double("trainingBoost").default(0).notNull(),
    ryoBoost: double("ryoBoost").default(0).notNull(),
    regenBoost: double("regenBoost").default(0).notNull(),
    points: int("points").default(0).notNull(),
    bank: bigint("bank", { mode: "number" }).default(0).notNull(),
    pvpActivity: int("pvpActivity").default(0).notNull(),
    repTreasury: int("repTreasury").default(0).notNull(),
    hasHideout: boolean("hasHideout").default(false).notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
  },
  (table) => {
    return {
      nameKey: uniqueIndex("Clan_name_key").on(table.name),
      villageIdx: index("Clan_village_idx").on(table.villageId),
    };
  },
);
export type Clan = InferSelectModel<typeof clan>;

export const clanRelations = relations(clan, ({ one, many }) => ({
  members: many(userData),
  village: one(village, {
    fields: [clan.villageId],
    references: [village.id],
  }),
  leader: one(userData, {
    fields: [clan.leaderId],
    references: [userData.userId],
  }),
  founder: one(userData, {
    fields: [clan.founderId],
    references: [userData.userId],
  }),
  leaderOrder: one(userNindo, {
    fields: [clan.leaderOrderId],
    references: [userNindo.userId],
  }),
}));

export const mpvpBattleQueue = mysqlTable(
  "MpvpBattleQueue",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    clan1Id: varchar("clan1Id", { length: 191 }).notNull(),
    clan2Id: varchar("clan2Id", { length: 191 }).notNull(),
    winnerId: varchar("winnerId", { length: 191 }),
    battleId: varchar("battleId", { length: 191 }),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
  },
  (table) => {
    return {
      battleIdIdx: index("MpvpBattleQueue_battleId_idx").on(table.battleId),
      clan1IdIdx: index("MpvpBattleQueue_clan1Id_idx").on(table.clan1Id),
      clan2IdIdx: index("MpvpBattleQueue_clan2Id_idx").on(table.clan2Id),
      winnerIdIdx: index("MpvpBattleQueue_winnerId_idx").on(table.winnerId),
    };
  },
);

export const mpvpBattleQueueRelations = relations(mpvpBattleQueue, ({ one, many }) => ({
  battle: one(battle, {
    fields: [mpvpBattleQueue.battleId],
    references: [battle.id],
  }),
  clan1: one(clan, {
    fields: [mpvpBattleQueue.clan1Id],
    references: [clan.id],
  }),
  clan2: one(clan, {
    fields: [mpvpBattleQueue.clan2Id],
    references: [clan.id],
  }),
  winner: one(clan, {
    fields: [mpvpBattleQueue.winnerId],
    references: [clan.id],
  }),
  queue: many(mpvpBattleUser),
}));

export const mpvpBattleUser = mysqlTable(
  "MpvpBattleUser",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    clanBattleId: varchar("clanBattleId", { length: 191 }).notNull(),
    userId: varchar("userId", { length: 191 }).notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
  },
  (table) => {
    return {
      clanBattleIdIdx: index("MpvpBattleUser_clanBattleId_idx").on(table.clanBattleId),
      userIdIdx: index("MpvpBattleUser_userId_idx").on(table.userId),
    };
  },
);

export const mpvpBattleUserRelations = relations(mpvpBattleUser, ({ one }) => ({
  clanBattle: one(mpvpBattleQueue, {
    fields: [mpvpBattleUser.clanBattleId],
    references: [mpvpBattleQueue.id],
  }),
  user: one(userData, {
    fields: [mpvpBattleUser.userId],
    references: [userData.userId],
  }),
}));

export const tournament = mysqlTable(
  "Tournament",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    name: varchar("name", { length: 191 }).notNull(),
    image: varchar("image", { length: 191 }).notNull(),
    description: text("description").notNull(),
    round: tinyint("round").default(1).notNull(),
    type: mysqlEnum("type", consts.TournamentTypes).notNull(),
    rewards: json("rewards").$type<ObjectiveRewardType>().notNull(),
    startedAt: datetime("startedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3) + INTERVAL 1 DAY )`)
      .notNull(),
    roundStartedAt: datetime("roundStartedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3) + INTERVAL 1 DAY )`)
      .notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    status: mysqlEnum("status", consts.TournamentStates).default("OPEN").notNull(),
  },
  (table) => {
    return {
      nameKey: uniqueIndex("Tournament_name_key").on(table.name),
    };
  },
);

export const tournamentRelations = relations(tournament, ({ many }) => ({
  matches: many(tournamentMatch),
}));

export const tournamentMatch = mysqlTable(
  "TournamentMatch",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    tournamentId: varchar("tournamentId", { length: 191 }).notNull(),
    round: int("round").notNull(),
    match: int("match").notNull(),
    state: mysqlEnum("state", consts.TournamentMatchStates)
      .default("WAITING")
      .notNull(),
    winnerId: varchar("winnerId", { length: 191 }),
    battleId: varchar("battleId", { length: 191 }),
    userId1: varchar("userId1", { length: 191 }).notNull(),
    userId2: varchar("userId2", { length: 191 }),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    startedAt: datetime("startedAt", { mode: "date", fsp: 3 }).notNull(),
  },
  (table) => {
    return {
      tournamentIdIdx: index("TournamentMatch_tournamentId_idx").on(table.tournamentId),
      userId1Idx: index("TournamentMatch_userId1_idx").on(table.userId1),
      userId2Idx: index("TournamentMatch_userId2_idx").on(table.userId2),
      winnerIdIdx: index("TournamentMatch_winnerId_idx").on(table.winnerId),
    };
  },
);
export type TournamentMatch = InferSelectModel<typeof tournamentMatch>;

export const tournamentMatchRelations = relations(tournamentMatch, ({ one }) => ({
  tournament: one(tournament, {
    fields: [tournamentMatch.tournamentId],
    references: [tournament.id],
  }),
  user1: one(userData, {
    fields: [tournamentMatch.userId1],
    references: [userData.userId],
  }),
  user2: one(userData, {
    fields: [tournamentMatch.userId2],
    references: [userData.userId],
  }),
  winner: one(userData, {
    fields: [tournamentMatch.winnerId],
    references: [userData.userId],
  }),
}));

export const tournamentRecord = mysqlTable(
  "TournamentRecord",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    name: varchar("name", { length: 191 }).notNull(),
    image: varchar("image", { length: 191 }).notNull(),
    description: text("description").notNull(),
    round: tinyint("round").default(1).notNull(),
    type: mysqlEnum("type", consts.TournamentTypes).notNull(),
    rewards: json("rewards").$type<ObjectiveRewardType>().notNull(),
    startedAt: datetime("startedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3) + INTERVAL 1 DAY )`)
      .notNull(),
    winnerId: varchar("winnerId", { length: 191 }),
  },
  (table) => {
    return {
      nameKey: uniqueIndex("HistoricalTournament_name_key").on(table.name),
    };
  },
);

export const conversation = mysqlTable(
  "Conversation",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    title: varchar("title", { length: 191 }),
    createdById: varchar("createdById", { length: 191 }),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    isLocked: tinyint("isLocked").default(0).notNull(),
    isPublic: tinyint("isPublic").default(1).notNull(),
  },
  (table) => {
    return {
      titleKey: index("Conversation_title_key").on(table.title),
      createdByIdIdx: index("Conversation_createdById_idx").on(table.createdById),
    };
  },
);

export const conversationRelations = relations(conversation, ({ many }) => ({
  users: many(user2conversation),
  comments: many(conversationComment),
}));

export const user2conversation = mysqlTable(
  "UsersInConversation",
  {
    conversationId: varchar("conversationId", { length: 191 }).notNull(),
    userId: varchar("userId", { length: 191 }).notNull(),
    assignedAt: datetime("assignedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    lastReadAt: datetime("lastReadAt", { mode: "date", fsp: 3 }),
  },
  (table) => {
    return {
      userIdIdx: index("UsersInConversation_userId_idx").on(table.userId),
      usersInConversationConversationIdUserId: primaryKey(
        table.conversationId,
        table.userId,
      ),
    };
  },
);

export const user2conversationRelations = relations(user2conversation, ({ one }) => ({
  userData: one(userData, {
    fields: [user2conversation.userId],
    references: [userData.userId],
  }),
  conversation: one(conversation, {
    fields: [user2conversation.conversationId],
    references: [conversation.id],
  }),
}));

export const conversationComment = mysqlTable(
  "ConversationComment",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    content: text("content").notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    userId: varchar("userId", { length: 191 }).notNull(),
    conversationId: varchar("conversationId", { length: 191 }),
    reactions: json("reactions")
      .$type<Record<string, string[]>>()
      .notNull()
      .default({}),
    isPinned: tinyint("isPinned").default(0).notNull(),
    isReported: boolean("isReported").default(false).notNull(),
  },
  (table) => {
    return {
      userIdIdx: index("ConversationComment_userId_idx").on(table.userId),
      createdAtIdx: index("ConversationComment_createdAt_idx").on(table.createdAt),
      conversationIdIdx: index("ConversationComment_conversationId_idx").on(
        table.conversationId,
      ),
    };
  },
);
export type ConversationComment = InferSelectModel<typeof conversationComment>;

export const conversationCommentRelations = relations(
  conversationComment,
  ({ one }) => ({
    user: one(userData, {
      fields: [conversationComment.userId],
      references: [userData.userId],
    }),
    conversation: one(conversation, {
      fields: [conversationComment.conversationId],
      references: [conversation.id],
    }),
  }),
);

export const damageSimulation = mysqlTable(
  "DamageCalculation",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    userId: varchar("userId", { length: 191 }).notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    state: json("state").notNull(),
    active: tinyint("active").default(1).notNull(),
  },
  (table) => {
    return {
      userIdIdx: index("DamageCalculation_userId_idx").on(table.userId),
      createdAtIdx: index("DamageCalculation_createdAt_idx").on(table.createdAt),
    };
  },
);
export type DamageSimulation = InferSelectModel<typeof damageSimulation>;

export const forumBoard = mysqlTable(
  "ForumBoard",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    name: varchar("name", { length: 191 }).notNull(),
    summary: text("summary").notNull(),
    group: varchar("group", { length: 191 }).notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    nPosts: int("nPosts").default(0).notNull(),
    nThreads: int("nThreads").default(0).notNull(),
  },
  (table) => {
    return {
      nameKey: uniqueIndex("ForumBoard_name_key").on(table.name),
    };
  },
);

export const forumPost = mysqlTable(
  "ForumPost",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    content: text("content").notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    userId: varchar("userId", { length: 191 }).notNull(),
    threadId: varchar("threadId", { length: 191 }).notNull(),
    isReported: boolean("isReported").default(false).notNull(),
  },
  (table) => {
    return {
      userIdIdx: index("ForumPost_userId_idx").on(table.userId),
      threadIdIdx: index("ForumPost_threadId_idx").on(table.threadId),
    };
  },
);
export type ForumPost = InferSelectModel<typeof forumPost>;

export const forumPostRelations = relations(forumPost, ({ one }) => ({
  user: one(userData, {
    fields: [forumPost.userId],
    references: [userData.userId],
  }),
  thread: one(forumThread, {
    fields: [forumPost.threadId],
    references: [forumThread.id],
  }),
}));

export const forumThread = mysqlTable(
  "ForumThread",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    title: varchar("title", { length: 191 }).notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    boardId: varchar("boardId", { length: 191 }).notNull(),
    userId: varchar("userId", { length: 191 }).notNull(),
    nPosts: int("nPosts").default(0).notNull(),
    isPinned: tinyint("isPinned").default(0).notNull(),
    isLocked: tinyint("isLocked").default(0).notNull(),
  },
  (table) => {
    return {
      boardIdIdx: index("ForumThread_boardId_idx").on(table.boardId),
      userIdIdx: index("ForumThread_userId_idx").on(table.userId),
    };
  },
);

export const forumThreadRelations = relations(forumThread, ({ one, many }) => ({
  user: one(userData, {
    fields: [forumThread.userId],
    references: [userData.userId],
  }),
  posts: many(forumPost),
}));

export const historicalAvatar = mysqlTable(
  "HistoricalAvatar",
  {
    id: int("id").autoincrement().primaryKey().notNull(),
    avatar: varchar("avatar", { length: 191 }),
    avatarLight: varchar("avatarLight", { length: 191 }),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    userId: varchar("userId", { length: 191 }).notNull(),
    replicateId: varchar("replicateId", { length: 191 }),
    updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    status: varchar("status", { length: 191 }).default("started").notNull(),
    done: tinyint("done").default(0).notNull(),
  },
  (table) => {
    return {
      replicateIdKey: uniqueIndex("HistoricalAvatar_replicateId_key").on(
        table.replicateId,
      ),
      avatarKey: uniqueIndex("HistoricalAvatar_avatar_key").on(table.avatar),
      doneIdx: index("HistoricalAvatar_done_idx").on(table.done),
      userIdIdx: index("HistoricalAvatar_userId_idx").on(table.userId),
    };
  },
);

export const item = mysqlTable(
  "Item",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    name: varchar("name", { length: 191 }).notNull(),
    description: text("description").notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    effects: json("effects").$type<ZodAllTags[]>().notNull(),
    itemType: mysqlEnum("itemType", consts.ItemTypes).notNull(),
    rarity: mysqlEnum("rarity", consts.ItemRarities).notNull(),
    slot: mysqlEnum("slot", consts.ItemSlotTypes).notNull(),
    cooldown: int("cooldown").default(0).notNull(),
    weaponType: mysqlEnum("weaponType", consts.WeaponTypes).default("NONE").notNull(),
    target: mysqlEnum("target", consts.AttackTargets).notNull(),
    method: mysqlEnum("method", consts.AttackMethods).default("SINGLE").notNull(),
    cost: int("cost").default(1).notNull(),
    repsCost: int("reputationCost").default(0).notNull(),
    stackSize: int("stackSize").default(1).notNull(),
    image: varchar("image", { length: 191 }).notNull(),
    destroyOnUse: tinyint("destroyOnUse").default(0).notNull(),
    range: int("range").default(0).notNull(),
    chakraCost: double("chakraCost").default(0).notNull(),
    staminaCost: double("staminaCost").default(0).notNull(),
    healthCost: double("healthCost").default(0).notNull(),
    staminaCostReducePerLvl: double("staminaCostReducePerLvl").default(0).notNull(),
    chakraCostReducePerLvl: double("chakraCostReducePerLvl").default(0).notNull(),
    healthCostReducePerLvl: double("healthCostReducePerLvl").default(0).notNull(),
    actionCostPerc: double("actionCostPerc").default(60).notNull(),
    battleDescription: text("battleDescription")
      .default(sql`('')`)
      .notNull(),
    canStack: boolean("canStack").default(false).notNull(),
    inShop: boolean("inShop").default(true).notNull(),
    isEventItem: boolean("isEventItem").default(false).notNull(),
    hidden: boolean("hidden").default(false).notNull(),
    maxEquips: int("maxEquips").default(1).notNull(),
    preventBattleUsage: boolean("preventBattleUsage").default(false).notNull(),
  },
  (table) => {
    return {
      nameKey: uniqueIndex("Item_name_key").on(table.name),
      itemRarityIdx: index("Item_rarity_idx").on(table.rarity),
      itemTypeIdx: index("Item_itemType_idx").on(table.itemType),
      slotIdx: index("Item_slot_idx").on(table.slot),
      methodIdx: index("Item_method_idx").on(table.method),
      target: index("Item_target_idx").on(table.target),
      isEventItemIdx: index("Item_isEventItem_idx").on(table.isEventItem),
      onlyInShopIdx: index("Item_onlyInShop_idx").on(table.inShop),
      costIdx: index("Item_cost_idx").on(table.cost),
      repsCostIdx: index("Item_repsCost_idx").on(table.repsCost),
    };
  },
);
export type Item = InferSelectModel<typeof item>;
export type ItemType = Item["itemType"];
export type ItemSlotType = Item["slot"];
export type ItemRarity = Item["rarity"];

export const jutsu = mysqlTable(
  "Jutsu",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    name: varchar("name", { length: 191 }).notNull(),
    description: text("description").notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    extraBaseCost: smallint("extraBaseCost", { unsigned: true }).default(0).notNull(),
    effects: json("effects").$type<ZodAllTags[]>().notNull(),
    target: mysqlEnum("target", consts.AttackTargets).notNull(),
    range: int("range").notNull(),
    cooldown: int("cooldown").default(0).notNull(),
    bloodlineId: varchar("bloodlineId", { length: 191 }),
    requiredLevel: int("requiredLevel").default(1).notNull(),
    requiredRank: mysqlEnum("requiredRank", consts.UserRanks).notNull(),
    jutsuType: mysqlEnum("jutsuType", consts.JutsuTypes).notNull(),
    image: varchar("image", { length: 191 }).notNull(),
    jutsuWeapon: mysqlEnum("jutsuWeapon", consts.WeaponTypes).default("NONE").notNull(),
    statClassification: mysqlEnum("statClassification", consts.StatTypes),
    battleDescription: text("battleDescription").notNull(),
    jutsuRank: mysqlEnum("jutsuRank", consts.LetterRanks).default("D").notNull(),
    actionCostPerc: double("actionCostPerc").default(80).notNull(),
    staminaCost: double("staminaCost").default(0.05).notNull(),
    chakraCost: double("chakraCost").default(0.05).notNull(),
    staminaCostReducePerLvl: double("staminaCostReducePerLvl").default(0).notNull(),
    chakraCostReducePerLvl: double("chakraCostReducePerLvl").default(0).notNull(),
    healthCostReducePerLvl: double("healthCostReducePerLvl").default(0).notNull(),
    healthCost: double("healthCost").default(0).notNull(),
    villageId: varchar("villageId", { length: 191 }),
    method: mysqlEnum("method", consts.AttackMethods).default("SINGLE").notNull(),
    hidden: boolean("hidden").default(false).notNull(),
  },
  (table) => {
    return {
      nameKey: uniqueIndex("Jutsu_name_key").on(table.name),
      imageKey: index("Jutsu_image_key").on(table.image),
      bloodlineIdIdx: index("Jutsu_bloodlineId_idx").on(table.bloodlineId),
      villageIdIdx: index("Jutsu_villageId_idx").on(table.villageId),
    };
  },
);

export const jutsuRelations = relations(jutsu, ({ one }) => ({
  bloodline: one(bloodline, {
    fields: [jutsu.bloodlineId],
    references: [bloodline.id],
  }),
}));

export type Jutsu = InferSelectModel<typeof jutsu>;
export type JutsuRank = Jutsu["jutsuRank"];

export const jutsuLoadout = mysqlTable(
  "JutsuLoadout",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    userId: varchar("userId", { length: 191 }).notNull(),
    jutsuIds: json("content").$type<string[]>().notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
  },
  (table) => {
    return {
      userIdIdx: index("JutsuLoadout_userId_idx").on(table.userId),
    };
  },
);

export const rankedJutsuLoadout = mysqlTable(
  "RankedJutsuLoadout",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    userId: varchar("userId", { length: 191 }).notNull(),
    jutsuIds: json("content").$type<string[]>().notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
  },
  (table) => {
    return {
      userIdIdx: index("RankedJutsuLoadout_userId_idx").on(table.userId),
    };
  },
);

export const notification = mysqlTable(
  "Notification",
  {
    id: int("id").autoincrement().primaryKey().notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    userId: varchar("userId", { length: 191 }).notNull(),
    content: text("content").notNull(),
  },
  (table) => {
    return {
      createdAtIdx: index("Notification_createdAt_idx").on(table.createdAt),
    };
  },
);

export const notificationRelations = relations(notification, ({ one }) => ({
  user: one(userData, {
    fields: [notification.userId],
    references: [userData.userId],
  }),
}));

export const paypalSubscription = mysqlTable(
  "PaypalSubscription",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    createdById: varchar("createdById", { length: 191 }).notNull(),
    affectedUserId: varchar("affectedUserId", { length: 191 }).notNull(),
    status: varchar("status", { length: 191 }).notNull(),
    federalStatus: mysqlEnum("federalStatus", consts.FederalStatuses).notNull(),
    orderId: varchar("orderId", { length: 191 }),
    subscriptionId: varchar("subscriptionId", { length: 191 }).notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
  },
  (table) => {
    return {
      subscriptionIdKey: uniqueIndex("PaypalSubscription_subscriptionId_key").on(
        table.subscriptionId,
      ),
      orderIdKey: uniqueIndex("PaypalSubscription_orderId_key").on(table.orderId),
      createdByIdIdx: index("PaypalSubscription_createdById_idx").on(table.createdById),
      affectedUserIdIdx: index("PaypalSubscription_affectedUserId_idx").on(
        table.affectedUserId,
      ),
    };
  },
);

export const paypalSubscriptionRelations = relations(paypalSubscription, ({ one }) => ({
  affectedUser: one(userData, {
    fields: [paypalSubscription.affectedUserId],
    references: [userData.userId],
  }),
  createdBy: one(userData, {
    fields: [paypalSubscription.createdById],
    references: [userData.userId],
  }),
}));

export const paypalTransaction = mysqlTable(
  "PaypalTransaction",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    createdById: varchar("createdById", { length: 191 }),
    affectedUserId: varchar("affectedUserId", { length: 191 }),
    transactionId: varchar("transactionId", { length: 191 }).notNull(),
    transactionUpdatedDate: varchar("transactionUpdatedDate", {
      length: 191,
    }).notNull(),
    orderId: varchar("orderId", { length: 191 }),
    invoiceId: varchar("invoiceId", { length: 191 }),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    amount: double("amount").notNull(),
    type: mysqlEnum("type", consts.TRANSACTION_TYPES).default("REP_PURCHASE").notNull(),
    reputationPoints: int("reputationPoints").default(0).notNull(),
    currency: varchar("currency", { length: 191 }).default("USD").notNull(),
    status: varchar("status", { length: 191 }).notNull(),
    rawData: json("rawData").notNull(),
  },
  (table) => {
    return {
      orderIdKey: uniqueIndex("PaypalTransaction_orderId_key").on(table.orderId),
      createdByIdIdx: index("PaypalTransaction_createdById_idx").on(table.createdById),
      affectedUserIdIdx: index("PaypalTransaction_affectedUserId_idx").on(
        table.affectedUserId,
      ),
    };
  },
);

export const paypalTransactionRelations = relations(paypalTransaction, ({ one }) => ({
  affectedUser: one(userData, {
    fields: [paypalTransaction.affectedUserId],
    references: [userData.userId],
  }),
  createdBy: one(userData, {
    fields: [paypalTransaction.createdById],
    references: [userData.userId],
  }),
}));

export const paypalWebhookMessage = mysqlTable("PaypalWebhookMessage", {
  id: varchar("id", { length: 191 }).primaryKey().notNull(),
  createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
    .default(sql`(CURRENT_TIMESTAMP(3))`)
    .notNull(),
  updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
    .default(sql`(CURRENT_TIMESTAMP(3))`)
    .notNull(),
  eventType: varchar("eventType", { length: 191 }).notNull(),
  rawData: json("rawData").notNull(),
  handled: tinyint("handled").default(0).notNull(),
});

export const ryoTrade = mysqlTable(
  "RyoTrade",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    creatorUserId: varchar("creatorUserId", { length: 191 }).notNull(),
    repsForSale: int("repsForSale").notNull(),
    requestedRyo: bigint("requestedRyo", { mode: "number" }).notNull(),
    ryoPerRep: double("ryoPerRep").notNull(),
    purchaserUserId: varchar("purchaserUserId", { length: 191 }),
    allowedPurchaserId: varchar("allowedPurchaserId", { length: 191 }),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
  },
  (table) => {
    return {
      creatorUserIdIdx: index("RyoTrade_creatorUserId_idx").on(table.creatorUserId),
    };
  },
);

export const ryoTradeRelations = relations(ryoTrade, ({ one }) => ({
  creator: one(userData, {
    fields: [ryoTrade.creatorUserId],
    references: [userData.userId],
  }),
}));

export const reportLog = mysqlTable(
  "ReportLog",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    targetUserId: varchar("targetUserId", { length: 191 }),
    staffUserId: varchar("staffUserId", { length: 191 }),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    action: varchar("action", { length: 191 }).notNull(),
  },
  (table) => {
    return {
      targetUserIdIdx: index("ReportLog_targetUserId_idx").on(table.targetUserId),
      staffUserIdIdx: index("ReportLog_staffUserId_idx").on(table.staffUserId),
    };
  },
);

export const actionLog = mysqlTable(
  "ActionLog",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    userId: varchar("userId", { length: 191 }),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    tableName: varchar("tableName", { length: 191 }),
    changes: json("changes").notNull(),
    relatedId: varchar("relatedId", { length: 191 }),
    relatedMsg: varchar("relatedText", { length: 191 }),
    relatedImage: varchar("relatedImage", { length: 191 }),
    relatedValue: double("relatedValue").default(0).notNull(),
  },
  (table) => {
    return {
      userId: index("ActionLog_userId_idx").on(table.userId),
      relatedIdIdx: index("ActionLog_relatedId_idx").on(table.relatedId),
      tableNameIdx: index("ActionLog_tableName_idx").on(table.tableName),
    };
  },
);

export const actionLogRelations = relations(actionLog, ({ one }) => ({
  user: one(userData, {
    fields: [actionLog.userId],
    references: [userData.userId],
  }),
}));

export const trainingLog = mysqlTable(
  "TrainingLog",
  {
    id: int("id").autoincrement().primaryKey().notNull(),
    userId: varchar("userId", { length: 191 }).notNull(),
    amount: double("amount").notNull(),
    stat: mysqlEnum("stat", consts.UserStatNames),
    speed: mysqlEnum("speed", consts.TrainingSpeeds),
    trainingFinishedAt: datetime("trainingFinishedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
  },
  (table) => {
    return {
      userIdIdx: index("TrainingLog_userId_idx").on(table.userId),
      speedIdx: index("TrainingLog_speed_idx").on(table.speed),
      statIdx: index("TrainingLog_stat_idx").on(table.stat),
      finishdAtIdx: index("TrainingLog_trainingFinishedAt_idx").on(
        table.trainingFinishedAt,
      ),
    };
  },
);

export const userAttribute = mysqlTable(
  "UserAttribute",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    attribute: varchar("attribute", { length: 191 }).notNull(),
    userId: varchar("userId", { length: 191 }).notNull(),
  },
  (table) => {
    return {
      attributeUserIdKey: uniqueIndex("UserAttribute_attribute_userId_key").on(
        table.attribute,
        table.userId,
      ),
      userIdIdx: index("UserAttribute_userId_idx").on(table.userId),
    };
  },
);

export const userAssociation = mysqlTable(
  "UserAssociation",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    userOne: varchar("userOne", { length: 191 }).notNull(),
    userTwo: varchar("userTwo", { length: 191 }).notNull(),
    associationType: mysqlEnum("associationType", consts.UserAssociations)
      .default("MARRIAGE")
      .notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
  },
  (table) => {
    return {
      UserOneUserTwoTypeIdKey: uniqueIndex("UserOne_UserTwo_UserAssociation_key").on(
        table.userOne,
        table.userTwo,
        table.associationType,
      ),
      userOneIdx: index("UserAttribute_userOne_idx").on(table.userOne),
      userTwoIdx: index("UserAttribute_userTwo_idx").on(table.userTwo),
    };
  },
);

export type Association = InferSelectModel<typeof userAssociation>;

export const userAssociationRelations = relations(userAssociation, ({ one }) => ({
  userOne: one(userData, {
    fields: [userAssociation.userOne],
    references: [userData.userId],
  }),
  userTwo: one(userData, {
    fields: [userAssociation.userTwo],
    references: [userData.userId],
  }),
}));

export const userData = mysqlTable(
  "UserData",
  {
    userId: varchar("userId", { length: 191 }).primaryKey().notNull(),
    recruiterId: varchar("recruiterId", { length: 191 }),
    anbuId: varchar("anbuId", { length: 191 }),
    clanId: varchar("clanId", { length: 191 }),
    jutsuLoadout: varchar("jutsuLoadout", { length: 191 }),
    rankedJutsuLoadout: varchar("rankedJutsuLoadout", { length: 191 }),
    nRecruited: int("nRecruited").default(0).notNull(),
    lastIp: varchar("lastIp", { length: 191 }),
    username: varchar("username", { length: 191 }).notNull(),
    gender: varchar("gender", { length: 191 }).notNull(),
    curHealth: smallint("curHealth", { unsigned: true }).default(100).notNull(),
    maxHealth: smallint("maxHealth", { unsigned: true }).default(100).notNull(),
    curChakra: smallint("curChakra", { unsigned: true }).default(100).notNull(),
    maxChakra: smallint("maxChakra", { unsigned: true }).default(100).notNull(),
    curStamina: smallint("curStamina", { unsigned: true }).default(100).notNull(),
    maxStamina: smallint("maxStamina", { unsigned: true }).default(100).notNull(),
    regeneration: tinyint("regeneration").default(60).notNull(),
    money: bigint("money", { mode: "number" }).default(100).notNull(),
    bank: bigint("bank", { mode: "number" }).default(100).notNull(),
    experience: int("experience").default(0).notNull(),
    earnedExperience: int("earnedExperience").default(0).notNull(),
    rank: mysqlEnum("rank", consts.UserRanks).default("STUDENT").notNull(),
    isOutlaw: boolean("isOutlaw").default(false).notNull(),
    level: int("level").default(1).notNull(),
    villageId: varchar("villageId", { length: 191 }),
    bloodlineId: varchar("bloodlineId", { length: 191 }),
    status: mysqlEnum("status", consts.UserStatuses).default("AWAKE").notNull(),
    strength: double("strength").default(10).notNull(),
    intelligence: double("intelligence").default(10).notNull(),
    willpower: double("willpower").default(10).notNull(),
    speed: double("speed").default(10).notNull(),
    ninjutsuOffence: double("ninjutsuOffence").default(10).notNull(),
    ninjutsuDefence: double("ninjutsuDefence").default(10).notNull(),
    genjutsuOffence: double("genjutsuOffence").default(10).notNull(),
    genjutsuDefence: double("genjutsuDefence").default(10).notNull(),
    taijutsuOffence: double("taijutsuOffence").default(10).notNull(),
    taijutsuDefence: double("taijutsuDefence").default(10).notNull(),
    bukijutsuDefence: double("bukijutsuDefence").default(10).notNull(),
    bukijutsuOffence: double("bukijutsuOffence").default(10).notNull(),
    statsMultiplier: double("statsMultiplier").default(1).notNull(),
    poolsMultiplier: double("poolsMultiplier").default(1).notNull(),
    reputationPoints: float("reputationPoints").default(5).notNull(),
    primaryElement: mysqlEnum("primaryElement", consts.ElementNames),
    secondaryElement: mysqlEnum("secondaryElement", consts.ElementNames),
    reputationPointsTotal: float("reputationPointsTotal").default(5).notNull(),
    villagePrestige: float("villagePrestige").default(0).notNull(),
    federalStatus: mysqlEnum("federalStatus", consts.FederalStatuses)
      .default("NONE")
      .notNull(),
    approvedTos: tinyint("approvedTos").default(0).notNull(),
    avatar: varchar("avatar", { length: 191 }),
    avatarLight: varchar("avatarLight", { length: 191 }),
    avatar3d: varchar("avatar3d", { length: 191 }),
    sector: smallint("sector", { unsigned: true }).default(0).notNull(),
    longitude: tinyint("longitude").default(10).notNull(),
    latitude: tinyint("latitude").default(7).notNull(),
    location: varchar("location", { length: 191 }).default(""),
    joinedVillageAt: datetime("joinedVillageAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3) - INTERVAL 7 DAY)`)
      .notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    questFinishAt: datetime("questFinishAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    activityStreak: int("activityStreak").default(0).notNull(),
    deletionAt: datetime("deletionAt", { mode: "date", fsp: 3 }),
    travelFinishAt: datetime("travelFinishAt", { mode: "date", fsp: 3 }),
    isBanned: boolean("isBanned").default(false).notNull(),
    isSilenced: boolean("isSilenced").default(false).notNull(),
    isWarned: boolean("isWarned").default(false).notNull(),
    role: mysqlEnum("role", consts.UserRoles).default("USER").notNull(),
    battleId: varchar("battleId", { length: 191 }),
    isAi: boolean("isAi").default(false).notNull(),
    isSummon: boolean("isSummon").default(false).notNull(),
    isEvent: boolean("isEvent").default(false).notNull(),
    inArena: boolean("inArena").default(false).notNull(),
    inboxNews: int("inboxNews").default(0).notNull(),
    regenAt: datetime("regenAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    immunityUntil: datetime("immunityUntil", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    robImmunityUntil: datetime("robImmunityUntil", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    trainingStartedAt: datetime("trainingStartedAt", { mode: "date", fsp: 3 }),
    trainingSpeed: mysqlEnum("trainingSpeed", consts.TrainingSpeeds)
      .default("15min")
      .notNull(),
    currentlyTraining: mysqlEnum("currentlyTraining", consts.UserStatNames),
    unreadNotifications: smallint("unreadNotifications").default(0).notNull(),
    unreadNews: smallint("unreadNews").default(0).notNull(),
    questData: json("questData").$type<QuestTrackerType[]>(),
    senseiId: varchar("senseiId", { length: 191 }),
    medicalExperience: int("medicalExperience").default(0).notNull(),
    // Settings
    preferredStat: mysqlEnum("preferredStat", consts.StatTypes),
    preferredGeneral1: mysqlEnum("preferredGeneral1", consts.GeneralTypes),
    preferredGeneral2: mysqlEnum("preferredGeneral2", consts.GeneralTypes),
    showBattleDescription: boolean("showBattleDescription").default(true).notNull(),
    // Statistics
    pvpFights: int("pvpFights").default(0).notNull(),
    pveFights: int("pveFights").default(0).notNull(),
    pvpActivity: int("pvpActivity").default(0).notNull(),
    pvpStreak: smallint("pvpStreak", { unsigned: true }).default(0).notNull(),
    errands: smallint("errands", { unsigned: true }).default(0).notNull(),
    missionsD: smallint("missionsD", { unsigned: true }).default(0).notNull(),
    missionsC: smallint("missionsC", { unsigned: true }).default(0).notNull(),
    missionsB: smallint("missionsB", { unsigned: true }).default(0).notNull(),
    missionsA: smallint("missionsA", { unsigned: true }).default(0).notNull(),
    missionsS: smallint("missionsS", { unsigned: true }).default(0).notNull(),
    missionsH: smallint("missionsH", { unsigned: true }).default(0).notNull(),
    crimesD: smallint("crimesD", { unsigned: true }).default(0).notNull(),
    crimesC: smallint("crimesC", { unsigned: true }).default(0).notNull(),
    crimesB: smallint("crimesB", { unsigned: true }).default(0).notNull(),
    crimesA: smallint("crimesA", { unsigned: true }).default(0).notNull(),
    crimesS: smallint("crimesS", { unsigned: true }).default(0).notNull(),
    crimesH: smallint("crimesH", { unsigned: true }).default(0).notNull(),
    dailyArenaFights: smallint("dailyArenaFights", { unsigned: true })
      .default(0)
      .notNull(),
    dailyMissions: smallint("dailyMissions", { unsigned: true }).default(0).notNull(),
    dailyErrands: smallint("dailyErrands", { unsigned: true }).default(0).notNull(),
    dailyTrainings: smallint("dailyTrainings", { unsigned: true }).default(0).notNull(),
    movedTooFastCount: int("movedTooFastCount").default(0).notNull(),
    extraItemSlots: smallint("extraItemSlots", { unsigned: true }).default(0).notNull(),
    extraJutsuSlots: tinyint("extraJutsuSlots").default(0).notNull(),
    customTitle: varchar("customTitle", { length: 191 }).default("").notNull(),
    marriageSlots: int("marriageSlots", { unsigned: true }).default(1).notNull(),
    aiProfileId: varchar("aiProfileId", { length: 191 }),
    effects: json("effects").$type<ZodAllTags[]>().default([]).notNull(),
    aiCalls: int("openaiCalls").default(0).notNull(),
    tavernMessages: int("tavernMessages").default(0).notNull(),
    audioOn: boolean("audioOn").default(true).notNull(),
    tutorialStep: tinyint("tutorialStep", { unsigned: true }).default(0).notNull(),
    rankedLp: int("rankedLp").notNull().default(150),
    rankedBattles: int("rankedBattles").notNull().default(0),
    rankedWins: int("rankedWins").notNull().default(0),
    rankedStreak: int("rankedStreak").notNull().default(0),
    homeType: mysqlEnum("homeType", consts.HomeTypes).default("NONE").notNull(),
  },
  (table) => {
    return {
      userIdKey: uniqueIndex("UserData_userId_key").on(table.userId),
      isAiIdx: index("UserData_isAi_idx").on(table.isAi),
      rankIdx: index("UserData_rank_idx").on(table.rank),
      roleIdx: index("UserData_role_idx").on(table.role),
      clanIdIdx: index("UserData_clanId_idx").on(table.clanId),
      anbuIdIdx: index("UserData_anbuId_idx").on(table.anbuId),
      jutsuLoadoutIdx: index("UserData_jutsuLoadout_idx").on(table.jutsuLoadout),
      rankedJutsuLoadoutIdx: index("UserData_rankedJutsuLoadout_idx").on(table.rankedJutsuLoadout),
      levelIdx: index("UserData_level_idx").on(table.level),
      usernameKey: uniqueIndex("UserData_username_key").on(table.username),
      bloodlineIdIdx: index("UserData_bloodlineId_idx").on(table.bloodlineId),
      villageIdIdx: index("UserData_villageId_idx").on(table.villageId),
      battleIdIdx: index("UserData_battleId_idx").on(table.battleId),
      statusIdx: index("UserData_status_idx").on(table.status),
      sectorIdx: index("UserData_sector_idx").on(table.sector),
      senseiIdx: index("UserData_senseiId_idx").on(table.senseiId),
      latitudeIdx: index("UserData_latitude_idx").on(table.latitude),
      longitudeIdx: index("UserData_longitude_idx").on(table.longitude),
    };
  },
);
export const insertAiSchema = createInsertSchema(userData)
  .omit({
    trainingStartedAt: true,
    currentlyTraining: true,
    deletionAt: true,
    travelFinishAt: true,
    questData: true,
  })
  .merge(
    z.object({
      jutsus: z.array(z.string()).optional(),
      items: z.array(z.string()).optional(),
      primaryElement: z.enum([...consts.ElementNames, ""]).nullish(),
      secondaryElement: z.enum([...consts.ElementNames, ""]).nullish(),
      level: z.coerce.number().min(1).max(200),
      regeneration: z.coerce.number().min(1).max(100),
      ninjutsuOffence: z.coerce.number().min(10),
      ninjutsuDefence: z.coerce.number().min(10),
      genjutsuOffence: z.coerce.number().min(10),
      genjutsuDefence: z.coerce.number().min(10),
      taijutsuOffence: z.coerce.number().min(10),
      taijutsuDefence: z.coerce.number().min(10),
      bukijutsuOffence: z.coerce.number().min(10),
      bukijutsuDefence: z.coerce.number().min(10),
      statsMultiplier: z.coerce.number().min(1).max(50),
      poolsMultiplier: z.coerce.number().min(1).max(50),
      strength: z.coerce.number().min(10),
      intelligence: z.coerce.number().min(10),
      willpower: z.coerce.number().min(10),
      speed: z.coerce.number().min(10),
      isSummon: z.coerce.boolean(),
      effects: z.array(AllTags).superRefine(SuperRefineEffects),
    }),
  );
export type InsertAiSchema = z.infer<typeof insertAiSchema>;
export type UserData = InferSelectModel<typeof userData>;
export type UserRank = UserData["rank"];
export type UserStatus = UserData["status"];
export type FederalStatus = UserData["federalStatus"];

export const userDataRelations = relations(userData, ({ one, many }) => ({
  ips: many(historicalIp),
  bloodline: one(bloodline, {
    fields: [userData.bloodlineId],
    references: [bloodline.id],
  }),
  village: one(village, {
    fields: [userData.villageId],
    references: [village.id],
  }),
  nindo: one(userNindo, {
    fields: [userData.userId],
    references: [userNindo.userId],
  }),
  userQuests: many(questHistory, { relationName: "userQuests" }),
  completedQuests: many(questHistory, { relationName: "completedQuests" }),
  conversations: many(user2conversation),
  items: many(userItem),
  jutsus: many(userJutsu),
  rankedUserJutsus: many(rankedUserJutsu),
  badges: many(userBadge),
  recruitedUsers: many(userData, { relationName: "recruiter" }),
  recruiter: one(userData, {
    fields: [userData.recruiterId],
    references: [userData.userId],
    relationName: "recruiter",
  }),
  students: many(userData, { relationName: "sensei" }),
  sensei: one(userData, {
    fields: [userData.senseiId],
    references: [userData.userId],
    relationName: "sensei",
  }),
  anbuSquad: one(anbuSquad, {
    fields: [userData.anbuId],
    references: [anbuSquad.id],
  }),
  clan: one(clan, {
    fields: [userData.clanId],
    references: [clan.id],
  }),
  loadout: one(jutsuLoadout, {
    fields: [userData.jutsuLoadout],
    references: [jutsuLoadout.id],
  }),
  rankedLoadout: one(rankedJutsuLoadout, {
    fields: [userData.rankedJutsuLoadout],
    references: [rankedJutsuLoadout.id],
  }),
  creatorBlacklist: many(userBlackList, { relationName: "creatorBlacklist" }),
  mpvpBattles: many(mpvpBattleUser),
  associations: many(userAssociation),
  aiProfile: one(aiProfile, {
    fields: [userData.aiProfileId],
    references: [aiProfile.id],
  }),
  promotions: many(linkPromotion, { relationName: "userPromotions" }),
  votes: one(userVote, {
    fields: [userData.userId],
    references: [userVote.userId],
  }),
}));

export const userActivityEvent = mysqlTable("UserActivityEvent", {
  id: int("id").primaryKey().autoincrement().notNull(),
  userId: varchar("userId", { length: 191 }).notNull(),
  streak: int("streak").notNull(),
  createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
    .default(sql`(CURRENT_TIMESTAMP(3))`)
    .notNull(),
});

export const historicalIp = mysqlTable(
  "HistoricalIp",
  {
    id: int("id").primaryKey().autoincrement().notNull(),
    userId: varchar("userId", { length: 191 }).notNull(),
    ip: varchar("ip", { length: 191 }).notNull(),
    usedAt: datetime("usedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
  },
  (table) => {
    return {
      userIdIpKey: uniqueIndex("HistoricalIp_userId_ip_key").on(table.userId, table.ip),
    };
  },
);

export const historicalIpRelations = relations(historicalIp, ({ one }) => ({
  user: one(userData, {
    fields: [historicalIp.userId],
    references: [userData.userId],
  }),
}));

export const userReview = mysqlTable(
  "UserReview",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    authorUserId: varchar("authorUserId", { length: 191 }).notNull(),
    targetUserId: varchar("targetUserId", { length: 191 }).notNull(),
    positive: boolean("positive").default(true).notNull(),
    review: text("review").notNull(),
    authorIp: varchar("authorIp", { length: 191 }).notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
  },
  (table) => {
    return {
      authorUserIdIdx: index("UserReview_authorUserId_idx").on(table.authorUserId),
      targetUserIdIdx: index("UserReview_targetUserId_idx").on(table.targetUserId),
    };
  },
);

export const userNindo = mysqlTable(
  "UserNindo",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    userId: varchar("userId", { length: 191 }).notNull(),
    content: text("content").notNull(),
  },
  (table) => {
    return { userIdIdx: index("UserNindo_userId_idx").on(table.userId) };
  },
);
export type UserNindo = InferSelectModel<typeof userNindo>;

export const userItem = mysqlTable(
  "UserItem",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    userId: varchar("userId", { length: 191 }).notNull(),
    itemId: varchar("itemId", { length: 191 }).notNull(),
    quantity: int("quantity").default(1).notNull(),
    equipped: mysqlEnum("equipped", consts.ItemSlots).default("NONE").notNull(),
    storedAtHome: boolean("storedAtHome").default(false).notNull(),
  },
  (table) => {
    return {
      userIdIdx: index("UserItem_userId_idx").on(table.userId),
      itemIdIdx: index("UserItem_itemId_idx").on(table.itemId),
      quantityIdx: index("UserItem_quantity_idx").on(table.quantity),
      equippedIdx: index("UserItem_equipped_idx").on(table.equipped),
    };
  },
);
export type UserItem = InferSelectModel<typeof userItem>;
export type ItemSlot = UserItem["equipped"];
export type UserItemWithItem = UserItem & { item: Item };

export const userItemRelations = relations(userItem, ({ one }) => ({
  item: one(item, {
    fields: [userItem.itemId],
    references: [item.id],
  }),
  user: one(userData, {
    fields: [userItem.userId],
    references: [userData.userId],
  }),
}));

export const userJutsu = mysqlTable(
  "UserJutsu",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    userId: varchar("userId", { length: 191 }).notNull(),
    jutsuId: varchar("jutsuId", { length: 191 }).notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    level: int("level").default(1).notNull(),
    experience: int("experience").default(0).notNull(),
    equipped: tinyint("equipped").default(0).notNull(),
    finishTraining: datetime("finishTraining", { mode: "date", fsp: 3 }),
  },
  (table) => {
    return {
      userIdJutsuIdKey: uniqueIndex("UserJutsu_userId_jutsuId_key").on(
        table.userId,
        table.jutsuId,
      ),
      jutsuIdIdx: index("UserJutsu_jutsuId_idx").on(table.jutsuId),
      equippedIdx: index("Jutsu_equipped_idx").on(table.equipped),
    };
  },
);
export type UserJutsu = InferSelectModel<typeof userJutsu>;

export const rankedUserJutsu = mysqlTable(
  "RankedUserJutsu",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    userId: varchar("userId", { length: 191 }).notNull(),
    jutsuId: varchar("jutsuId", { length: 191 }).notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    level: int("level").default(1).notNull(),
    equipped: tinyint("equipped").default(0).notNull(),
    finishTraining: datetime("finishTraining", { mode: "date", fsp: 3 }),
  },
  (table) => {
    return {
      userIdJutsuIdKey: uniqueIndex("RankedUserJutsu_userId_jutsuId_key").on(
        table.userId,
        table.jutsuId,
      ),
      jutsuIdIdx: index("RankedUserJutsu_jutsuId_idx").on(table.jutsuId),
      equippedIdx: index("RankedUserJutsu_equipped_idx").on(table.equipped),
    };
  },
);
export type RankedUserJutsu = InferSelectModel<typeof rankedUserJutsu>;

export const userJutsuRelations = relations(userJutsu, ({ one }) => ({
  jutsu: one(jutsu, {
    fields: [userJutsu.jutsuId],
    references: [jutsu.id],
  }),
  user: one(userData, {
    fields: [userJutsu.userId],
    references: [userData.userId],
  }),
}));

export const rankedUserJutsuRelations = relations(rankedUserJutsu, ({ one }) => ({
  jutsu: one(jutsu, {
    fields: [rankedUserJutsu.jutsuId],
    references: [jutsu.id],
  }),
  user: one(userData, {
    fields: [rankedUserJutsu.userId],
    references: [userData.userId],
  }),
}));

export const userReport = mysqlTable(
  "UserReport",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    reporterUserId: varchar("reporterUserId", { length: 191 }),
    reportedUserId: varchar("reportedUserId", { length: 191 }),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    system: varchar("system", { length: 191 }).notNull(),
    infraction: json("infraction").notNull(),
    reason: text("reason").notNull(),
    banEnd: datetime("banEnd", { mode: "date", fsp: 3 }),
    adminResolved: tinyint("adminResolved").default(0).notNull(),
    status: mysqlEnum("status", consts.BanStates).default("UNVIEWED").notNull(),
    aiInterpretation: text("aiInterpretation").notNull(),
    predictedStatus: mysqlEnum("predictedStatus", consts.BanStates),
    additionalContext: json("additionalContext")
      .$type<AdditionalContext[]>()
      .notNull()
      .default([]),
  },
  (table) => {
    return {
      reporterUserIdIdx: index("UserReport_reporterUserId_idx").on(
        table.reporterUserId,
      ),
      reportedUserIdIdx: index("UserReport_reportedUserId_idx").on(
        table.reportedUserId,
      ),
    };
  },
);
export type UserReport = InferSelectModel<typeof userReport>;
export type ReportAction = UserReport["status"];

export const userReportRelations = relations(userReport, ({ one }) => ({
  reportedUser: one(userData, {
    fields: [userReport.reportedUserId],
    references: [userData.userId],
  }),
  reporterUser: one(userData, {
    fields: [userReport.reporterUserId],
    references: [userData.userId],
  }),
}));

export const userReportComment = mysqlTable(
  "UserReportComment",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    content: text("content").notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    userId: varchar("userId", { length: 191 }).notNull(),
    reportId: varchar("reportId", { length: 191 }).notNull(),
    decision: mysqlEnum("decision", consts.BanStates),
    isReported: boolean("isReported").default(false).notNull(),
  },
  (table) => {
    return {
      userIdIdx: index("UserReportComment_userId_idx").on(table.userId),
      reportIdIdx: index("UserReportComment_reportId_idx").on(table.reportId),
    };
  },
);
export type UserReportComment = InferSelectModel<typeof userReportComment>;

export const userReportCommentRelations = relations(userReportComment, ({ one }) => ({
  user: one(userData, {
    fields: [userReportComment.userId],
    references: [userData.userId],
  }),
}));

export const automatedModeration = mysqlTable(
  "AutomatedModeration",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    userId: varchar("userId", { length: 191 }).notNull(),
    content: text("content").notNull(),
    relationType: mysqlEnum("relationType", consts.AutomoderationCategories).notNull(),
    // Categories
    sexual: boolean("sexual").default(false).notNull(),
    sexual_minors: boolean("sexual_minors").default(false).notNull(),
    harassment: boolean("harassment").default(false).notNull(),
    harassment_threatening: boolean("harassment_threatening").default(false).notNull(),
    hate: boolean("hate").default(false).notNull(),
    hate_threatening: boolean("hate_threatening").default(false).notNull(),
    illicit: boolean("illicit").default(false).notNull(),
    illicit_violent: boolean("illicit_violent").default(false).notNull(),
    self_harm: boolean("self_harm").default(false).notNull(),
    self_harm_intent: boolean("self_harm_intent").default(false).notNull(),
    self_harm_instructions: boolean("self_harm_instructions").default(false).notNull(),
    violence: boolean("violence").default(false).notNull(),
    violence_graphic: boolean("violence_graphic").default(false).notNull(),
    // Timestamps
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
  },
  (table) => {
    return {
      userIdIdx: index("AutoMod_userId_idx").on(table.userId),
      relationTypeIdx: index("AutoMod_relationType_idx").on(table.relationType),
    };
  },
);

export const sector = mysqlTable(
  "Sector",
  {
    id: int("id").autoincrement().primaryKey().notNull(),
    sector: smallint("sector").notNull(),
    villageId: varchar("villageId", { length: 191 }).notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
  },
  (table) => {
    return {
      sectorKey: uniqueIndex("Sector_sector_key").on(table.sector),
    };
  },
);

export const sectorRelations = relations(sector, ({ one, many }) => ({
  village: one(village, {
    fields: [sector.villageId],
    references: [village.id],
  }),
  wars: many(war, { relationName: "sectorWars" }),
}));

export const supportReview = mysqlTable("SupportReview", {
  id: varchar("id", { length: 191 }).primaryKey().notNull(),
  apiRoute: varchar("apiRoute", { length: 191 }).notNull(),
  chatHistory: json("chatHistory").$type<CoreMessage[]>().notNull(),
  userId: varchar("userId", { length: 191 }).notNull(),
  sentiment: mysqlEnum("sentiment", consts.Sentiment).notNull(),
  createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
    .default(sql`(CURRENT_TIMESTAMP(3))`)
    .notNull(),
  updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
    .default(sql`(CURRENT_TIMESTAMP(3))`)
    .notNull(),
});

export const village = mysqlTable(
  "Village",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    name: varchar("name", { length: 191 }).notNull(),
    mapName: varchar("mapName", { length: 191 }),
    sector: int("sector").default(1).notNull(),
    description: varchar("description", { length: 512 }).default("").notNull(),
    kageId: varchar("kageId", { length: 191 }).notNull(),
    tokens: int("tokens").default(0).notNull(),
    type: mysqlEnum("type", consts.SECTOR_TYPES).default("VILLAGE").notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    leaderUpdatedAt: datetime("leaderUpdatedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    hexColor: varchar("hexColor", { length: 191 }).default("#000000").notNull(),
    populationCount: int("populationCount").default(0).notNull(),
    allianceSystem: boolean("allianceSystem").default(true).notNull(),
    joinable: boolean("joinable").default(true).notNull(),
    pvpDisabled: boolean("pvpDisabled").default(false).notNull(),
    villageLogo: varchar("villageLogo", { length: 191 }).default("").notNull(),
    villageGraphic: varchar("villageGraphic", { length: 191 }).default("").notNull(),
    lastMaintenancePaidAt: datetime("lastMaintenancePaidAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    wasDowngraded: boolean("wasDowngraded").default(false).notNull(),
    openForChallenges: boolean("openForChallenges").default(true).notNull(),
    openForChallengesAt: datetime("openForChallengesAt", {
      mode: "date",
      fsp: 3,
    })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    wallpaperOverwrite: varchar("wallpaperOverwrite", { length: 191 }),
    warExhaustionEndedAt: datetime("warExhaustionEndedAt", { mode: "date", fsp: 3 }),
    lastWarEndedAt: datetime("lastWarEndedAt", { mode: "date", fsp: 3 }),
  },
  (table) => {
    return {
      nameKey: uniqueIndex("Village_name_key").on(table.name),
      sectorKey: uniqueIndex("Village_sector_key").on(table.sector),
    };
  },
);
export type Village = InferSelectModel<typeof village>;

export const villageRelations = relations(village, ({ many, one }) => ({
  structures: many(villageStructure),
  relationshipA: many(villageAlliance, { relationName: "villageA" }),
  relationshipB: many(villageAlliance, { relationName: "villageB" }),
  kage: one(userData, {
    fields: [village.kageId],
    references: [userData.userId],
  }),
  notice: one(userNindo, {
    fields: [village.id],
    references: [userNindo.userId],
  }),
  declaredWars: many(war, { relationName: "attackerVillage" }),
  receivedWars: many(war, { relationName: "defenderVillage" }),
}));

export const villageStructure = mysqlTable(
  "VillageStructure",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    name: varchar("name", { length: 191 }).notNull(),
    route: varchar("route", { length: 191 }).default("").notNull(),
    image: varchar("image", { length: 191 }).notNull(),
    villageId: varchar("villageId", { length: 191 }).notNull(),
    longitude: tinyint("longitude").default(10).notNull(),
    latitude: tinyint("latitude").default(10).notNull(),
    hasPage: tinyint("hasPage").default(0).notNull(),
    curSp: int("curSp").default(100).notNull(),
    maxSp: int("maxSp").default(100).notNull(),
    allyAccess: tinyint("allyAccess").default(1).notNull(),
    // upgrade cust & current level
    baseCost: int("baseCost").default(10000).notNull(),
    level: int("level").default(1).notNull(),
    maxLevel: int("maxLevel").default(10).notNull(),
    lastUpgradedAt: datetime("lastUpgradedAt", { mode: "date", fsp: 3 }),
    // Per level advantages
    anbuSquadsPerLvl: tinyint("anbuSquadsPerLvl").default(0).notNull(),
    arenaRewardPerLvl: tinyint("arenaRewardPerLvl").default(0).notNull(),
    bankInterestPerLvl: tinyint("bankInterestPerLvl").default(0).notNull(),
    blackDiscountPerLvl: tinyint("blackDiscountPerLvl").default(0).notNull(),
    clansPerLvl: tinyint("clansPerLvl").default(0).notNull(),
    hospitalSpeedupPerLvl: tinyint("hospitalSpeedupPerLvl").default(0).notNull(),
    itemDiscountPerLvl: tinyint("itemDiscountPerLvl").default(0).notNull(),
    patrolsPerLvl: tinyint("patrolsPerLvl").default(0).notNull(),
    ramenDiscountPerLvl: tinyint("ramenDiscountPerLvl").default(0).notNull(),
    regenIncreasePerLvl: tinyint("regenIncreasePerLvl").default(0).notNull(),
    sleepRegenPerLvl: tinyint("sleepRegenPerLvl").default(0).notNull(),
    structureDiscountPerLvl: tinyint("structureDiscountPerLvl").default(0).notNull(),
    trainBoostPerLvl: tinyint("trainBoostPerLvl").default(0).notNull(),
    villageDefencePerLvl: tinyint("villageDefencePerLvl").default(0).notNull(),
  },
  (table) => {
    return {
      nameVillageIdKey: uniqueIndex("VillageStructure_name_villageId_key").on(
        table.name,
        table.villageId,
      ),
      villageIdIdx: index("VillageStructure_villageId_idx").on(table.villageId),
    };
  },
);
export type VillageStructure = InferSelectModel<typeof villageStructure>;
export type VillageStructureInsert = InferInsertModel<typeof villageStructure>;

export const villageStructureRelations = relations(villageStructure, ({ one }) => ({
  village: one(village, {
    fields: [villageStructure.villageId],
    references: [village.id],
  }),
}));

export const villageAlliance = mysqlTable(
  "VillageAlliance",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    villageIdA: varchar("villageIdA", { length: 191 }).notNull(),
    villageIdB: varchar("villageIdB", { length: 191 }).notNull(),
    status: mysqlEnum("status", consts.AllianceStates).notNull(),
    updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 }),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 }),
  },
  (table) => {
    return {
      villageIdAIdx: index("VillageAlliance_villageIdA_idx").on(table.villageIdA),
      villageIdBIdx: index("VillageAlliance_villageIdB_idx").on(table.villageIdB),
      statusIdx: index("VillageAlliance_status_idx").on(table.status),
    };
  },
);
export type VillageAlliance = InferSelectModel<typeof villageAlliance>;

export const villageAllianceRelations = relations(villageAlliance, ({ one }) => ({
  villageA: one(village, {
    fields: [villageAlliance.villageIdA],
    references: [village.id],
    relationName: "villageA",
  }),
  villageB: one(village, {
    fields: [villageAlliance.villageIdB],
    references: [village.id],
    relationName: "villageB",
  }),
}));

export const kageDefendedChallenges = mysqlTable(
  "KageDefendedChallenges",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    villageId: varchar("villageId", { length: 191 }).notNull(),
    userId: varchar("userId", { length: 191 }).notNull(),
    kageId: varchar("kageId", { length: 191 }).notNull(),
    didWin: tinyint("didWin").default(0).notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    rounds: int("rounds").notNull(),
  },
  (table) => {
    return {
      villageIdIdx: index("VillageKageChallenges_villageId_idx").on(table.villageId),
      userIdIdx: index("VillageKageChallenges_userId_idx").on(table.userId),
      kageIDIdx: index("VillageKageChallenges_kageID_idx").on(table.kageId),
    };
  },
);

export const kageDefendedChallengesRelations = relations(
  kageDefendedChallenges,
  ({ one }) => ({
    user: one(userData, {
      fields: [kageDefendedChallenges.userId],
      references: [userData.userId],
    }),
    kage: one(userData, {
      fields: [kageDefendedChallenges.kageId],
      references: [userData.userId],
    }),
  }),
);

export const dataBattleAction = mysqlTable(
  "DataBattleAction",
  {
    id: int("id").autoincrement().primaryKey().notNull(),
    type: mysqlEnum("type", consts.BattleDataEntryType).notNull(),
    contentId: varchar("contentId", { length: 191 }).notNull(),
    battleType: mysqlEnum("battleType", consts.BattleTypes).notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    battleWon: tinyint("battleWon").notNull(),
    count: int("count").notNull().default(1),
  },
  (table) => {
    return {
      uniqueContentIdIdx: unique("uniqueContentId").on(
        table.type,
        table.contentId,
        table.battleType,
        table.battleWon,
      ),
      createdAt: index("DataBattleActions_createdAt").on(table.createdAt),
    };
  },
);

export const quest = mysqlTable(
  "Quest",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    name: varchar("name", { length: 191 }).notNull(),
    image: varchar("image", { length: 191 }),
    description: varchar("description", { length: 5000 }),
    successDescription: varchar("successDescription", { length: 5000 }),
    questRank: mysqlEnum("questRank", consts.LetterRanks).default("D").notNull(),
    requiredLevel: int("requiredLevel").default(1).notNull(),
    maxLevel: int("maxLevel").default(100).notNull(),
    requiredVillage: varchar("requiredVillage", { length: 191 }),
    prerequisiteQuestId: varchar("prerequisiteQuestId", { length: 191 }),
    tierLevel: int("tierLevel"),
    timeFrame: mysqlEnum("timeFrame", consts.TimeFrames).notNull(),
    questType: mysqlEnum("questType", consts.QuestTypes).notNull(),
    content: json("content").$type<QuestContentType>().notNull(),
    hidden: boolean("hidden").default(false).notNull(),
    consecutiveObjectives: boolean("consecutiveObjectives").default(true).notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    expiresAt: date("expiresAt", { mode: "string" }),
  },
  (table) => {
    return {
      tierLevel: unique("tierLevel").on(table.tierLevel),
      questTypeIdx: index("Quest_questType_idx").on(table.questType),
      questRankIdx: index("Quest_questRank_idx").on(table.questRank),
      requiredLevelIdx: index("Quest_requiredLevel_idx").on(table.requiredLevel),
      maxLevelIdx: index("Quest_maxLevel_idx").on(table.maxLevel),
      requiredVillageIdx: index("Quest_requiredVillage_idx").on(table.requiredVillage),
      prerequisiteQuestIdIdx: index("Quest_prerequisiteQuestId_idx").on(
        table.prerequisiteQuestId,
      ),
    };
  },
);
export type Quest = InferSelectModel<typeof quest>;

export const questRelations = relations(quest, ({ one }) => ({
  village: one(village, {
    fields: [quest.requiredVillage],
    references: [village.id],
  }),
}));

export const questHistory = mysqlTable(
  "QuestHistory",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    userId: varchar("userId", { length: 191 }).notNull(),
    questId: varchar("questId", { length: 191 }).notNull(),
    questType: mysqlEnum("questType", consts.QuestTypes).notNull(),
    startedAt: datetime("startedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    endAt: datetime("endedAt", { mode: "date", fsp: 3 }),
    completed: tinyint("completed").default(0).notNull(),
    previousCompletes: int("previousCompletes").default(0).notNull(),
    previousAttempts: int("previousAttempts").default(0).notNull(),
  },
  (table) => {
    return {
      userIdIdx: index("QuestHistory_userId_idx").on(table.userId),
      questTypeIdx: index("QuestHistory_questType_idx").on(table.questType),
      endAtIdx: index("QuestHistory_endedAt_idx").on(table.endAt),
      questIdIdx: index("QuestHistory_questId_idx").on(table.questId),
      completedIdx: index("QuestHistory_completed_idx").on(table.completed),
    };
  },
);
export type QuestHistory = InferInsertModel<typeof questHistory>;
export type UserQuest = QuestHistory & { quest: Quest };

export const questHistoryRelations = relations(questHistory, ({ one }) => ({
  user: one(userData, {
    fields: [questHistory.userId],
    references: [userData.userId],
    relationName: "userQuests",
  }),
  victor: one(userData, {
    fields: [questHistory.userId],
    references: [userData.userId],
    relationName: "completedQuests",
  }),
  quest: one(quest, {
    fields: [questHistory.questId],
    references: [quest.id],
  }),
}));

export const gameSetting = mysqlTable(
  "GameSetting",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    name: varchar("name", { length: 191 }).notNull(),
    time: datetime("time", { mode: "date", fsp: 3 }).notNull(),
    value: int("value").default(0).notNull(),
  },
  (table) => {
    return { name: index("name").on(table.name) };
  },
);
export type GameSetting = InferSelectModel<typeof gameSetting>;

export const gameRule = mysqlTable(
  "GameRule",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    name: varchar("name", { length: 191 }).notNull(),
    description: varchar("description", { length: 500 }).notNull(),
    value: tinyint("value").default(0).notNull(),
  },
  (table) => {
    return { name: index("name").on(table.name) };
  },
);
export type GameRule = InferSelectModel<typeof gameRule>;

export const userLikes = mysqlTable(
  "UserLikes",
  {
    type: mysqlEnum("type", consts.SmileyEmotions).notNull(),
    userId: varchar("userId", { length: 191 }).notNull(),
    imageId: varchar("imageId", { length: 191 }).notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
  },
  (table) => {
    return {
      userIdIdx: index("userLikes_userId_idx").on(table.userId),
      imageIdIdx: index("userLikes_imageId_idx").on(table.imageId),
    };
  },
);

export const conceptImage = mysqlTable(
  "ConceptImage",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    userId: varchar("userId", { length: 191 }).notNull(),
    image: varchar("image", { length: 191 }),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    status: varchar("status", { length: 191 }).default("started").notNull(),
    hidden: boolean("hidden").default(false).notNull(),
    // prompt schema
    prompt: varchar("prompt", { length: 5000 }).notNull(),
    negative_prompt: varchar("negative_prompt", { length: 5000 }).default("").notNull(),
    seed: int("seed").notNull().default(42),
    guidance_scale: int("guidance_scale").notNull().default(4),
    // References
    n_likes: int("n_likes").default(0).notNull(),
    n_loves: int("n_loves").default(0).notNull(),
    n_laugh: int("n_laugh").default(0).notNull(),
    n_comments: int("n_comments").default(0).notNull(),
    description: varchar("description", { length: 255 }),
    done: tinyint("done").default(0).notNull(),
  },
  (table) => {
    return {
      avatarKey: uniqueIndex("image_avatar_key").on(table.image),
      doneIdx: index("image_done_idx").on(table.done),
      userIdIdx: index("image_userId_idx").on(table.userId),
    };
  },
);
export type ContentImage = InferSelectModel<typeof conceptImage>;

export const likeRelations = relations(userLikes, ({ one }) => ({
  likes: one(conceptImage, {
    fields: [userLikes.imageId],
    references: [conceptImage.id],
  }),
}));

export const imageRelations = relations(conceptImage, ({ many, one }) => ({
  likes: many(userLikes),
  user: one(userData, {
    fields: [conceptImage.userId],
    references: [userData.userId],
  }),
}));

export const bankTransfers = mysqlTable(
  "BankTransfers",
  {
    senderId: varchar("senderId", { length: 191 }).notNull(),
    receiverId: varchar("receiverId", { length: 191 }).notNull(),
    amount: int("amount").notNull(),
    type: mysqlEnum("type", consts.BankTransferTypes).default("bank").notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
  },
  (table) => {
    return {
      senderIdIdx: index("BankTransfers_senderId_idx").on(table.senderId),
      receiverIdIdx: index("BankTransfers_receiverId_idx").on(table.receiverId),
    };
  },
);

export const bankTransferRelations = relations(bankTransfers, ({ one }) => ({
  sender: one(userData, {
    fields: [bankTransfers.senderId],
    references: [userData.userId],
  }),
  receiver: one(userData, {
    fields: [bankTransfers.receiverId],
    references: [userData.userId],
  }),
}));

export const badge = mysqlTable(
  "Badge",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    image: varchar("image", { length: 191 }).notNull(),
    name: varchar("name", { length: 191 }).notNull(),
    description: varchar("description", { length: 500 }).notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
  },
  (table) => {
    return {
      nameKey: uniqueIndex("Badge_name_key").on(table.name),
    };
  },
);
export type Badge = InferSelectModel<typeof badge>;

export const userBadge = mysqlTable(
  "UserBadge",
  {
    userId: varchar("userId", { length: 191 }).notNull(),
    badgeId: varchar("badgeId", { length: 191 }).notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
  },
  (table) => {
    return {
      userIdIdx: index("UserBadge_userId_idx").on(table.userId),
      badgeIdIdx: index("UserBadge_badgeId_idx").on(table.badgeId),
    };
  },
);
export type UserBadge = InferSelectModel<typeof userBadge>;

export const userBadgeRelations = relations(userBadge, ({ one }) => ({
  badge: one(badge, {
    fields: [userBadge.badgeId],
    references: [badge.id],
  }),
  user: one(userData, {
    fields: [userBadge.userId],
    references: [userData.userId],
  }),
}));

export const userRequest = mysqlTable(
  "UserRequest",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    senderId: varchar("senderId", { length: 191 }).notNull(),
    receiverId: varchar("receiverId", { length: 191 }).notNull(),
    status: mysqlEnum("status", consts.UserRequestStates).notNull(),
    type: mysqlEnum("type", consts.UserRequestTypes).notNull(),
    value: int("value").default(0),
    relatedId: varchar("relatedId", { length: 191 }),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
  },
  (table) => {
    return {
      createdAtIdx: index("UserRequest_createdAt_idx").on(table.createdAt),
      challengerIdIdx: index("UserRequest_senderId_idx").on(table.senderId),
      challengedIdIdx: index("UserRequest_receiverId_idx").on(table.receiverId),
      typeIdx: index("UserRequest_type_idx").on(table.type),
    };
  },
);
export type UserRequest = InferSelectModel<typeof userRequest>;

export const userRequestRelations = relations(userRequest, ({ one }) => ({
  sender: one(userData, {
    fields: [userRequest.senderId],
    references: [userData.userId],
  }),
  receiver: one(userData, {
    fields: [userRequest.receiverId],
    references: [userData.userId],
  }),
}));

export const userRewards = mysqlTable(
  "UserRewards",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    awardedById: varchar("awardedById", { length: 191 }).notNull(),
    receiverId: varchar("receiverId", { length: 191 }).notNull(),
    reputationAmount: float("reputationAmount").default(0).notNull(),
    moneyAmount: bigint("moneyAmount", { mode: "number" }).default(0).notNull(),
    reason: text("reason").notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
  },
  (table) => {
    return {
      awardedByIdIdx: index("UserRewards_awardedById_idx").on(table.awardedById),
      receiverIdIdx: index("UserRewards_receiverId_idx").on(table.receiverId),
      createdAtIdx: index("UserRewards_createdAt_idx").on(table.createdAt),
    };
  },
);

export type UserRewards = InferSelectModel<typeof userRewards>;

export const userRewardsRelations = relations(userRewards, ({ one }) => ({
  awardedBy: one(userData, {
    fields: [userRewards.awardedById],
    references: [userData.userId],
  }),
  receiver: one(userData, {
    fields: [userRewards.receiverId],
    references: [userData.userId],
  }),
}));

export const backgroundSchema = mysqlTable(
  "backgroundSchema",
  {
    id: varchar("id", { length: 191 })
      .primaryKey()
      .notNull()
      .default(sql`(UUID())`),
    schema: json("schema").$type<ZodBgSchemaType>().notNull(),
    name: varchar("name", { length: 191 }).notNull(),
    description: varchar("description", { length: 191 }).notNull(),
    isActive: boolean("isActive").default(false).notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
  },
  (table) => {
    return {
      nameKey: uniqueIndex("backgroundSchema_name_key").on(table.name),
    };
  },
);
export type BackgroundSchema = InferSelectModel<typeof backgroundSchema>;

export const linkPromotion = mysqlTable(
  "LinkPromotion",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    userId: varchar("userId", { length: 191 }).notNull(),
    url: varchar("url", { length: 191 }).notNull(),
    points: int("points").default(0).notNull(),
    reviewed: boolean("reviewed").default(false).notNull(),
    reviewedBy: varchar("reviewedBy", { length: 191 }),
    reviewedAt: datetime("reviewedAt", { mode: "date", fsp: 3 }),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
  },
  (table) => {
    return {
      userIdIdx: index("LinkPromotion_userId_idx").on(table.userId),
      reviewedByIdx: index("LinkPromotion_reviewedBy_idx").on(table.reviewedBy),
    };
  },
);

export type LinkPromotion = InferSelectModel<typeof linkPromotion>;

export const linkPromotionRelations = relations(linkPromotion, ({ one }) => ({
  user: one(userData, {
    fields: [linkPromotion.userId],
    references: [userData.userId],
    relationName: "userPromotions",
  }),
  reviewer: one(userData, {
    fields: [linkPromotion.reviewedBy],
    references: [userData.userId],
  }),
}));

export const userVote = mysqlTable(
  "UserVote",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    userId: varchar("userId", { length: 191 }).notNull(),
    topWebGames: boolean("topWebGames").default(false).notNull(),
    top100Arena: boolean("top100Arena").default(false).notNull(),
    mmoHub: boolean("mmoHub").default(false).notNull(),
    arenaTop100: boolean("arenaTop100").default(false).notNull(),
    xtremeTop100: boolean("xtremeTop100").default(false).notNull(),
    topOnlineMmorpg: boolean("topOnlineMmorpg").default(false).notNull(),
    browserMmorpg: boolean("browserMmorpg").default(false).notNull(),
    apexWebGaming: boolean("apexWebGaming").default(false).notNull(),
    bbogd: boolean("bbogd").default(false).notNull(),
    claimed: boolean("claimed").default(false).notNull(),
    totalClaims: int("totalClaims").default(0).notNull(),
    secret: varchar("secret", { length: 191 }).notNull(),
    lastVoteAt: datetime("lastVoteAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
  },
  (table) => {
    return {
      userIdIdx: uniqueIndex("UserVote_userId_idx").on(table.userId),
    };
  },
);
export type UserVote = InferSelectModel<typeof userVote>;

export const userVoteRelations = relations(userVote, ({ one }) => ({
  user: one(userData, {
    fields: [userVote.userId],
    references: [userData.userId],
  }),
}));

// War System Tables
export const war = mysqlTable("War", {
  id: varchar("id", { length: 191 }).primaryKey().notNull(),
  attackerVillageId: varchar("attackerVillageId", { length: 191 }).notNull(),
  defenderVillageId: varchar("defenderVillageId", { length: 191 }).notNull(),
  startedAt: datetime("startedAt", { mode: "date", fsp: 3 })
    .default(sql`(CURRENT_TIMESTAMP(3))`)
    .notNull(),
  endedAt: datetime("endedAt", { mode: "date", fsp: 3 }),
  status: mysqlEnum("status", consts.WAR_STATES).notNull(),
  type: mysqlEnum("type", consts.WAR_TYPES).notNull(),
  sector: smallint("sector").default(0).notNull(),
  shrineHp: smallint("shrineHp").default(consts.WAR_SHRINE_HP).notNull(),
  dailyTokenReduction: int("dailyTokenReduction").default(1000).notNull(),
  lastTokenReductionAt: datetime("lastTokenReductionAt", { mode: "date", fsp: 3 })
    .default(sql`(CURRENT_TIMESTAMP(3))`)
    .notNull(),
  targetStructureRoute: varchar("targetStructureRoute", { length: 191 })
    .default("/townhall")
    .notNull(),
});
export type War = InferSelectModel<typeof war>;

export const warRelations = relations(war, ({ one, many }) => ({
  attackerVillage: one(village, {
    fields: [war.attackerVillageId],
    references: [village.id],
    relationName: "attackerVillage",
  }),
  defenderVillage: one(village, {
    fields: [war.defenderVillageId],
    references: [village.id],
    relationName: "defenderVillage",
  }),
  warAllies: many(warAlly),
  sector: one(sector, {
    fields: [war.sector],
    references: [sector.sector],
    relationName: "sectorWars",
  }),
}));

export const warAlly = mysqlTable(
  "WarAlly",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    warId: varchar("warId", { length: 191 }).notNull(),
    villageId: varchar("villageId", { length: 191 }).notNull(),
    supportVillageId: varchar("supportVillageId", { length: 191 }).notNull(),
    tokensPaid: int("tokensPaid").notNull(),
    joinedAt: datetime("joinedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
  },
  (table) => {
    return {
      warIdIdx: index("WarAlly_warId_idx").on(table.warId),
      villageIdIdx: index("WarAlly_villageId_idx").on(table.villageId),
    };
  },
);
export type WarAlly = InferSelectModel<typeof warAlly>;

export const warAllyRelations = relations(warAlly, ({ one }) => ({
  war: one(war, {
    fields: [warAlly.warId],
    references: [war.id],
  }),
  village: one(village, {
    fields: [warAlly.villageId],
    references: [village.id],
  }),
}));

export const warKill = mysqlTable(
  "WarKill",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    warId: varchar("warId", { length: 191 }).notNull(),
    killerId: varchar("killerId", { length: 191 }).notNull(),
    victimId: varchar("victimId", { length: 191 }).notNull(),
    killerVillageId: varchar("killerVillageId", { length: 191 }).notNull(),
    victimVillageId: varchar("victimVillageId", { length: 191 }).notNull(),
    sector: smallint("sector").default(1337).notNull(),
    shrineHpChange: smallint("shrineHpChange").default(1337).notNull(),
    townhallHpChange: smallint("townhallHpChange").default(1337).notNull(),
    killedAt: datetime("killedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
  },
  (table) => {
    return {
      warIdIdx: index("WarKill_warId_idx").on(table.warId),
      killerIdIdx: index("WarKill_killerId_idx").on(table.killerId),
      victimIdIdx: index("WarKill_victimId_idx").on(table.victimId),
      killerVillageIdIdx: index("WarKill_killerVillageId_idx").on(
        table.killerVillageId,
      ),
      victimVillageIdIdx: index("WarKill_victimVillageId_idx").on(
        table.victimVillageId,
      ),
    };
  },
);

export const warKillRelations = relations(warKill, ({ one }) => ({
  war: one(war, {
    fields: [warKill.warId],
    references: [war.id],
  }),
  killer: one(userData, {
    fields: [warKill.killerId],
    references: [userData.userId],
  }),
  victim: one(userData, {
    fields: [warKill.victimId],
    references: [userData.userId],
  }),
  killerVillage: one(village, {
    fields: [warKill.killerVillageId],
    references: [village.id],
  }),
  victimVillage: one(village, {
    fields: [warKill.victimVillageId],
    references: [village.id],
  }),
}));

// Poll schema
export const poll = mysqlTable(
  "Poll",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description").notNull(),
    allowCustomOptions: boolean("allowCustomOptions").default(false).notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    endDate: datetime("endDate", { mode: "date", fsp: 3 }),
    createdByUserId: varchar("createdByUserId", { length: 191 }).notNull(),
    isActive: boolean("isActive").default(true).notNull(),
  },
  (table) => {
    return {
      createdByUserIdIdx: index("Poll_createdByUserId_idx").on(table.createdByUserId),
    };
  },
);

export const pollRelations = relations(poll, ({ one, many }) => ({
  createdBy: one(userData, {
    fields: [poll.createdByUserId],
    references: [userData.userId],
  }),
  options: many(pollOption),
  votes: many(userPollVote),
}));

export type Poll = InferSelectModel<typeof poll>;

// Poll option schema
export const pollOption = mysqlTable(
  "PollOption",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    pollId: varchar("pollId", { length: 191 }).notNull(),
    text: varchar("text", { length: 255 }).notNull(),
    optionType: mysqlEnum("optionType", consts.PollOptionTypes)
      .default("text")
      .notNull(),
    targetUserId: varchar("targetUserId", { length: 191 }),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    createdByUserId: varchar("createdByUserId", { length: 191 }).notNull(),
    isCustomOption: boolean("isCustomOption").default(false).notNull(),
  },
  (table) => {
    return {
      pollIdIdx: index("PollOption_pollId_idx").on(table.pollId),
      createdByUserIdIdx: index("PollOption_createdByUserId_idx").on(
        table.createdByUserId,
      ),
      targetUserIdIdx: index("PollOption_targetUserId_idx").on(table.targetUserId),
    };
  },
);

export const pollOptionRelations = relations(pollOption, ({ one, many }) => ({
  poll: one(poll, {
    fields: [pollOption.pollId],
    references: [poll.id],
  }),
  createdBy: one(userData, {
    fields: [pollOption.createdByUserId],
    references: [userData.userId],
  }),
  targetUser: one(userData, {
    fields: [pollOption.targetUserId],
    references: [userData.userId],
  }),
  votes: many(userPollVote),
}));

export type PollOption = InferSelectModel<typeof pollOption>;

// User poll vote schema
export const userPollVote = mysqlTable(
  "UserPollVote",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    userId: varchar("userId", { length: 191 }).notNull(),
    pollId: varchar("pollId", { length: 191 }).notNull(),
    optionId: varchar("optionId", { length: 191 }).notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
  },
  (table) => {
    return {
      userIdPollIdIdx: uniqueIndex("UserPollVote_userId_pollId_idx").on(
        table.userId,
        table.pollId,
      ),
      pollIdIdx: index("UserPollVote_pollId_idx").on(table.pollId),
      optionIdIdx: index("UserPollVote_optionId_idx").on(table.optionId),
    };
  },
);

export const userPollVoteRelations = relations(userPollVote, ({ one }) => ({
  user: one(userData, {
    fields: [userPollVote.userId],
    references: [userData.userId],
  }),
  poll: one(poll, {
    fields: [userPollVote.pollId],
    references: [poll.id],
  }),
  option: one(pollOption, {
    fields: [userPollVote.optionId],
    references: [pollOption.id],
  }),
}));

export type UserPollVote = InferSelectModel<typeof userPollVote>;

export const rankedPvpQueue = mysqlTable(
  "RankedPvpQueue",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    userId: varchar("userId", { length: 191 })
      .notNull()
      .references(() => userData.userId),
    rankedLp: int("rankedLp").notNull(),
    queueStartTime: timestamp("queueStartTime").notNull().defaultNow(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (table) => {
    return {
      userIdIdx: index("RankedPvpQueue_userId_idx").on(table.userId),
      rankedLpIdx: index("RankedPvpQueue_rankedLp_idx").on(table.rankedLp),
    };
  },
);

export type RankedPvpQueue = InferSelectModel<typeof rankedPvpQueue>;

export const rankedPvpQueueRelations = relations(rankedPvpQueue, ({ one }) => ({
  user: one(userData, {
    fields: [rankedPvpQueue.userId],
    references: [userData.userId],
  }),
}));

// User upload schema
export const userUpload = mysqlTable(
  "UserUpload",
  {
    id: varchar("id", { length: 191 }).primaryKey().notNull(),
    userId: varchar("userId", { length: 191 }).notNull(),
    imageUrl: varchar("imageUrl", { length: 255 }).notNull(),
    createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
    updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
      .default(sql`(CURRENT_TIMESTAMP(3))`)
      .notNull(),
  },
  (table) => {
    return {
      userIdIdx: index("UserUpload_userId_idx").on(table.userId),
    };
  },
);

export const userUploadRelations = relations(userUpload, ({ one }) => ({
  user: one(userData, {
    fields: [userUpload.userId],
    references: [userData.userId],
  }),
}));

export type UserUpload = InferSelectModel<typeof userUpload>;

export const rankedLoadout = mysqlTable("RankedLoadout", {
  id: varchar("id", { length: 191 }).notNull().primaryKey(),
  userId: varchar("userId", { length: 191 }).notNull(),
  weaponId: varchar("weaponId", { length: 191 }),
  consumable1Id: varchar("consumable1Id", { length: 191 }),
  consumable2Id: varchar("consumable2Id", { length: 191 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const rankedLoadoutRelations = relations(rankedLoadout, ({ one }) => ({
  user: one(userData, {
    fields: [rankedLoadout.userId],
    references: [userData.userId],
  }),
  weapon: one(item, {
    fields: [rankedLoadout.weaponId],
    references: [item.id],
  }),
  consumable1: one(item, {
    fields: [rankedLoadout.consumable1Id],
    references: [item.id],
  }),
  consumable2: one(item, {
    fields: [rankedLoadout.consumable2Id],
    references: [item.id],
  }),
}));

export type RankedLoadout = InferSelectModel<typeof rankedLoadout>;

export const rankedSeason = mysqlTable("RankedSeason", {
  id: varchar("id", { length: 191 }).notNull().primaryKey(),
  name: varchar("name", { length: 191 }).notNull(),
  description: text("description").notNull(),
  startDate: datetime("startDate", { mode: "date", fsp: 3 }).notNull(),
  endDate: datetime("endDate", { mode: "date", fsp: 3 }).notNull(),
  rewards: json("rewards").$type<{
    division: string;
    rewards: {
      type: "item" | "jutsu" | "reputation" | "ryo";
      id?: string;
      amount: number;
    }[];
  }[]>().notNull(),
  createdAt: datetime("createdAt", { mode: "date", fsp: 3 })
    .default(sql`(CURRENT_TIMESTAMP(3))`)
    .notNull(),
  updatedAt: datetime("updatedAt", { mode: "date", fsp: 3 })
    .default(sql`(CURRENT_TIMESTAMP(3))`)
    .notNull(),
});

export type RankedSeason = InferSelectModel<typeof rankedSeason>;
