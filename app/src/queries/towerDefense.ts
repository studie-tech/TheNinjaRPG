/**
 * Database access for tower defense; authorization and transaction scopes stay in callers.
 */
import { and, asc, desc, eq, exists, gte, lt, or, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { nanoid } from "nanoid";
import {
  towerDefenseCharacter,
  towerDefenseClaimReceipt,
  towerDefenseRun,
  towerDefenseUpgrade,
  userData,
  userTowerDefenseUpgrade,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/** Build the `towerDefenseRun` deletion for `GET`, using predicates on `status`. */
export const deleteTowerDefenseRunForGET = (client: Pick<DrizzleClient, "delete">) =>
  client.delete(towerDefenseRun).where(eq(towerDefenseRun.status, "COMPLETED"));

/** Build the `towerDefenseUpgrade` listing for `getUpgrades`. */
export const listTowerDefenseUpgradeForGetUpgrades = (
  client: Pick<DrizzleClient, "query">,
) =>
  client.query.towerDefenseUpgrade.findMany({
    orderBy: [desc(towerDefenseUpgrade.upgradeType)],
  });

/** Build the `towerDefenseCharacter` listing for `getAssetConfigs`. */
export const listTowerDefenseCharacterForGetAssetConfigs = (
  client: Pick<DrizzleClient, "query">,
) => client.query.towerDefenseCharacter.findMany();

/** Build the `userTowerDefenseUpgrade` listing for `getUserUpgrades`, using predicates on `userId`. */
export const listUserTowerDefenseUpgradeForGetUserUpgrades = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.userTowerDefenseUpgrade.findMany({
    where: eq(userTowerDefenseUpgrade.userId, ctx.userId),
    with: { upgrade: true },
  });

/** Build the `userData` lookup for `getUserUpgrades`, selecting only `towerDefensePoints`, using predicates on `userId`. */
export const findUserDataForGetUserUpgrades = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.userData.findFirst({
    columns: { towerDefensePoints: true },
    where: eq(userData.userId, ctx.userId),
  });

/** Build the `towerDefenseUpgrade` listing for `initiateSecureSession`. */
export const listTowerDefenseUpgradeForInitiateSecureSession = (
  client: Pick<DrizzleClient, "query">,
) => client.query.towerDefenseUpgrade.findMany();

/** Build the `towerDefenseCharacter` listing for session definitions, in wave order. */
export const listTowerDefenseCharacterForInitiateSession = (
  client: Pick<DrizzleClient, "query">,
) =>
  client.query.towerDefenseCharacter.findMany({
    orderBy: [asc(towerDefenseCharacter.firstAppearWave)],
  });

/**
 * List a caller's runs after an ID cursor using the same timestamp/ID order as the page.
 * The cursor lookup stays in the statement and cannot reference another user's history.
 */
export const listTowerDefenseRunForGetRunHistory = (
  client: Pick<DrizzleClient, "select">,
  ctx: { userId: string },
  input: { cursor?: string; limit: number },
) => {
  const cursorRun = alias(towerDefenseRun, "cursorRun");
  return client
    .select()
    .from(towerDefenseRun)
    .where(
      and(
        eq(towerDefenseRun.userId, ctx.userId),
        input.cursor
          ? exists(
              client
                .select({ id: cursorRun.id })
                .from(cursorRun)
                .where(
                  and(
                    eq(cursorRun.id, input.cursor),
                    eq(cursorRun.userId, ctx.userId),
                    or(
                      lt(towerDefenseRun.startedAt, cursorRun.startedAt),
                      and(
                        eq(towerDefenseRun.startedAt, cursorRun.startedAt),
                        lt(towerDefenseRun.id, cursorRun.id),
                      ),
                    ),
                  ),
                ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(towerDefenseRun.startedAt), desc(towerDefenseRun.id))
    .limit(input.limit + 1);
};

/** Build the `towerDefenseRun` listing for `getLeaderboard`, using predicates on `status`. */
export const listTowerDefenseRunForGetLeaderboard = (
  client: Pick<DrizzleClient, "query">,
  input: { limit: number },
) =>
  client.query.towerDefenseRun.findMany({
    where: eq(towerDefenseRun.status, "COMPLETED"),
    orderBy: [desc(towerDefenseRun.score)],
    limit: input.limit,
    with: {
      user: {
        columns: { username: true, avatar: true, rank: true },
      },
    },
  });

/**
 * Build the `userTowerDefenseUpgrade` lookup for `purchasePermanentUpgrade`, using
 * predicates on `userId` and `upgradeId`.
 */
export const findUserTowerDefenseUpgradeForPurchasePermanentUpgrade = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
  input: { upgradeId: string },
) =>
  client.query.userTowerDefenseUpgrade.findFirst({
    where: and(
      eq(userTowerDefenseUpgrade.userId, ctx.userId),
      eq(userTowerDefenseUpgrade.upgradeId, input.upgradeId),
    ),
  });

/**
 * Build the `userData` update for `purchasePermanentUpgrade`, setting
 * `towerDefensePoints`, using predicates on `userId` and `towerDefensePoints`.
 */
export const updateUserDataForPurchasePermanentUpgrade = (
  client: Pick<DrizzleClient, "update">,
  cost: number,
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({
      towerDefensePoints: sql`${userData.towerDefensePoints} - ${cost}`,
    })
    .where(
      and(eq(userData.userId, ctx.userId), gte(userData.towerDefensePoints, cost)),
    );

/** Build the `userTowerDefenseUpgrade` insert for `purchasePermanentUpgrade`, updating duplicate keys. */
export const insertUserTowerDefenseUpgradeForPurchasePermanentUpgrade = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: { upgradeId: string },
  currentLevel: number,
) =>
  client
    .insert(userTowerDefenseUpgrade)
    .values({
      id: nanoid(),
      userId: ctx.userId,
      upgradeId: input.upgradeId,
      level: currentLevel + 1,
    })
    .onDuplicateKeyUpdate({
      set: { level: currentLevel + 1 },
    });

/** Build the `towerDefenseClaimReceipt` insert for `claimCompletedRun`. */
export const insertTowerDefenseClaimReceiptForClaimCompletedRun = (
  client: Pick<DrizzleClient, "insert">,
  claimKey: string,
  ctx: { userId: string },
  input: { spacetimeSessionId: string },
  finalWave: number,
  finalScore: number,
  pointsEarned: number,
) =>
  client.insert(towerDefenseClaimReceipt).values({
    id: nanoid(),
    claimKey,
    userId: ctx.userId,
    spacetimeSessionId: input.spacetimeSessionId,
    wave: finalWave,
    score: finalScore,
    pointsEarned,
  });

/** Build the `userData` update for `claimCompletedRun`, setting `towerDefensePoints`, using predicates on `userId`. */
export const updateUserDataForClaimCompletedRun = (
  client: Pick<DrizzleClient, "update">,
  pointsEarned: number,
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({
      towerDefensePoints: sql`${userData.towerDefensePoints} + ${pointsEarned}`,
    })
    .where(eq(userData.userId, ctx.userId));

/** Build the `towerDefenseRun` insert for `claimCompletedRun`. */
export const insertTowerDefenseRunForClaimCompletedRun = (
  client: Pick<DrizzleClient, "insert">,
  claimKey: string,
  ctx: { userId: string },
  finalWave: number,
  finalScore: number,
  run: { initial_grid_size: number },
) =>
  client.insert(towerDefenseRun).values({
    id: nanoid(),
    seed: claimKey,
    userId: ctx.userId,
    wave: finalWave,
    score: finalScore,
    gridSize: run.initial_grid_size,
    status: "COMPLETED",
    state: {
      playerHealth: 0,
      playerPosition: { col: 0, row: 0 },
      inRunCurrency: 0,
      activeUpgrades: {},
      gridSize: run.initial_grid_size,
    },
    endedAt: new Date(),
  });

/** Build the `towerDefenseCharacter` listing for `getCharacters`, using the configured predicates. */
export const listTowerDefenseCharacterForGetCharacters = (
  client: Pick<DrizzleClient, "query">,
  whereClause: undefined | SQL<unknown>,
) =>
  client.query.towerDefenseCharacter.findMany({
    where: whereClause,
    orderBy: [asc(towerDefenseCharacter.firstAppearWave)],
  });

/** Build the `towerDefenseCharacter` lookup for `getCharacter`, using predicates on `id`. */
export const findTowerDefenseCharacterForGetCharacter = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.towerDefenseCharacter.findFirst({
    where: eq(towerDefenseCharacter.id, input.id),
  });

/** Build the `towerDefenseCharacter` insert for `createCharacter`. */
export const insertTowerDefenseCharacterForCreateCharacter = (
  client: Pick<DrizzleClient, "insert">,
  id: string,
  typeLabel: "Player" | "Enemy",
  input: { isPlayer: false | true },
) =>
  client.insert(towerDefenseCharacter).values({
    id,
    name: `New ${typeLabel} - ${id.slice(0, 6)}`,
    isPlayer: input.isPlayer,
  });

/** Build the `towerDefenseCharacter` update for `updateCharacter`, setting `updatedAt`, using predicates on `id`. */
export const updateTowerDefenseCharacterForUpdateCharacter = (
  client: Pick<DrizzleClient, "update">,
  input: {
    data: import("@/validators/towerDefenseCharacter").InsertTowerDefenseCharacter;
    id: string;
  },
) =>
  client
    .update(towerDefenseCharacter)
    .set({
      ...input.data,
      updatedAt: new Date(),
    })
    .where(eq(towerDefenseCharacter.id, input.id));

/** Build the `towerDefenseCharacter` deletion for `deleteCharacter`, using predicates on `id`. */
export const deleteTowerDefenseCharacterForDeleteCharacter = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
) => client.delete(towerDefenseCharacter).where(eq(towerDefenseCharacter.id, input.id));

/** Build a tower defense character asset update with a fresh update timestamp. */
export const updateTowerDefenseCharacterAssets = (
  client: Pick<DrizzleClient, "update">,
  assetConfig: {
    rotations: Record<string, string>;
    animations: {
      name: string;
      state: import("@/validators/towerDefense").CharacterAnimationState;
      frames: Record<string, string[]>;
      frameDurationMs: number;
      loop: false | true;
    }[];
  },
  characterId: string,
) =>
  client
    .update(towerDefenseCharacter)
    .set({
      assetConfig,
      updatedAt: new Date(),
    })
    .where(eq(towerDefenseCharacter.id, characterId));

/** Build a tower defense upgrade lookup by ID. */
export const findTowerDefenseUpgradeById = (
  client: Pick<DrizzleClient, "query">,
  upgradeId: string,
) =>
  client.query.towerDefenseUpgrade.findFirst({
    where: eq(towerDefenseUpgrade.id, upgradeId),
  });

/** Build the `towerDefenseUpgrade` update for `updateUpgrade`, setting `updatedAt`, using predicates on `id`. */
export const updateTowerDefenseUpgradeForUpdateUpgrade = (
  client: Pick<DrizzleClient, "update">,
  input: {
    data: import("@/validators/towerDefense").UpdateTowerDefenseUpgrade;
    id: string;
  },
) =>
  client
    .update(towerDefenseUpgrade)
    .set({
      ...input.data,
      updatedAt: new Date(),
    })
    .where(eq(towerDefenseUpgrade.id, input.id));
