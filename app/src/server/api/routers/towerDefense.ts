import { z } from "zod";
import { nanoid } from "nanoid";
import { eq, and, desc, sql, asc, gte, lt } from "drizzle-orm";
import { timingSafeEqual } from "crypto";
import {
  towerDefenseUpgrade,
  userTowerDefenseUpgrade,
  towerDefenseRun,
  towerDefenseCharacter,
  userData,
  type TowerDefenseCharacterDb,
} from "@/drizzle/schema";
import type { InferSelectModel } from "drizzle-orm";
import {
  TD_SCORE_PER_KILL,
  TD_SCORE_TO_POINTS_RATIO,
  TD_INITIAL_GRID_SIZE,
  TD_MAX_GRID_SIZE,
  TD_GRID_EXPAND_EVERY_N_WAVES,
  TD_RANGE_VISUAL_FACTOR,
  TD_PLAYER_BASE_HEALTH,
  TowerDefenseUpgradeTypes,
} from "@/drizzle/constants";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
  baseServerResponse,
  errorResponse,
} from "../trpc";
import { ratelimitMiddleware, hasUserMiddleware } from "../trpc";
import { canChangeContent } from "@/utils/permissions";
import { validateUrlForSsrf } from "@/utils/ssrf";
import {
  purchaseUpgradeInputSchema,
  playerBonusesSchema,
  towerDefenseAbilitySchema,
  insertTowerDefenseCharacterSchema,
  characterAssetConfigSchema,
  signedUpgradeDefinitionSchema,
  signedEnemyDefinitionSchema,
} from "@/validators/towerDefense";
import {
  getShurikenAbility,
  applyUpgradesToAbility,
  calculatePlayerBonuses,
  getModifiedPlayerHealth,
  getDefaultPlayerBonuses,
} from "@/libs/towerDefense/abilities";
import {
  signSessionParams,
  generateSessionNonce,
  type SessionParams,
} from "@/server/utils/towerDefenseCrypto";
import type {
  SignedUpgradeDefinition,
  SignedEnemyDefinition,
} from "@/validators/towerDefense";
import {
  generateRunSeed,
  calculateUpgradeCost,
  directionToSpriteDirection,
} from "@/libs/towerDefense/game";
import { UTApi } from "uploadthing/server";

/**
 * Tower Defense tRPC Router
 *
 * This router handles permanent data stored in MySQL:
 * - Permanent upgrades (userTowerDefenseUpgrade)
 * - Points (userData.towerDefensePoints)
 * - Run history for leaderboards (towerDefenseRun)
 *
 * Active game state is handled by SpacetimeDB - see app/spacetimedb/
 */
export const towerDefenseRouter = createTRPCRouter({
  // ============================================
  // Queries
  // ============================================

  /**
   * Get all available upgrade definitions
   */
  getUpgrades: publicProcedure.query(async ({ ctx }) => {
    return await ctx.drizzle.query.towerDefenseUpgrade.findMany({
      orderBy: [desc(towerDefenseUpgrade.upgradeType)],
    });
  }),

  /**
   * Get all character asset configs for rendering
   */
  getAssetConfigs: publicProcedure.query(async ({ ctx }) => {
    const characters = await ctx.drizzle.query.towerDefenseCharacter.findMany();
    return {
      enemyAssetConfigs: getCharacterAssetConfigs(
        characters.filter((c) => !c.isPlayer),
      ),
      playerAssetConfigs: getCharacterAssetConfigs(
        characters.filter((c) => c.isPlayer),
      ),
    };
  }),

  /**
   * Get user's purchased permanent upgrades
   */
  getUserUpgrades: protectedProcedure
    .use(ratelimitMiddleware)
    .use(hasUserMiddleware)
    .query(async ({ ctx }) => {
      const [upgrades, user] = await Promise.all([
        ctx.drizzle.query.userTowerDefenseUpgrade.findMany({
          where: eq(userTowerDefenseUpgrade.userId, ctx.userId),
          with: { upgrade: true },
        }),
        ctx.drizzle.query.userData.findFirst({
          columns: { towerDefensePoints: true },
          where: eq(userData.userId, ctx.userId),
        }),
      ]);

      return {
        upgrades,
        points: user?.towerDefensePoints ?? 0,
      };
    }),

  /**
   * Initiate a secure tower defense session
   *
   * This endpoint calculates all initial session parameters server-side from
   * the user's permanent upgrades, preventing clients from spoofing stats.
   * It returns a signed payload that SpacetimeDB will accept.
   *
   * Security flow:
   * 1. Server fetches user's upgrades AND upgrade definitions from MySQL
   * 2. Server calculates stats using the same formulas as before, but server-side
   * 3. Server signs (userId, nonce, stats, upgrade_definitions) with HMAC
   * 4. Client passes signed params + definitions to SpacetimeDB
   * 5. SpacetimeDB stores everything for use during the game
   * 6. When purchasing in-run upgrades, SpacetimeDB uses the stored signed definitions
   * 7. When claiming, server verifies signature matches all data including definitions
   */
  initiateSecureSession: protectedProcedure
    .use(ratelimitMiddleware)
    .use(hasUserMiddleware)
    .mutation(async ({ ctx }) => {
      const [userUpgrades, upgradeDefinitions, enemyDefinitionsDb, playerCharactersDb] =
        await Promise.all([
          ctx.drizzle.query.userTowerDefenseUpgrade.findMany({
            where: eq(userTowerDefenseUpgrade.userId, ctx.userId),
            with: { upgrade: true },
          }),
          ctx.drizzle.query.towerDefenseUpgrade.findMany(),
          ctx.drizzle.query.towerDefenseCharacter.findMany({
            where: eq(towerDefenseCharacter.isPlayer, false),
            orderBy: [asc(towerDefenseCharacter.firstAppearWave)],
          }),
          ctx.drizzle.query.towerDefenseCharacter.findMany({
            where: eq(towerDefenseCharacter.isPlayer, true),
          }),
        ]);

      const baseShuriken = getShurikenAbility();
      const ability = applyUpgradesToAbility(
        baseShuriken,
        userUpgrades,
        upgradeDefinitions,
      );
      const playerBonuses = calculatePlayerBonuses(userUpgrades, upgradeDefinitions);
      const maxHealth = getModifiedPlayerHealth(userUpgrades, upgradeDefinitions);

      return initiateSession({
        userId: ctx.userId,
        ability,
        playerBonuses,
        maxHealth,
        upgradeDefinitions,
        enemyDefinitionsDb,
        playerCharactersDb,
      });
    }),

  /**
   * Initiate a guest tower defense session (no authentication required)
   *
   * This endpoint allows unauthenticated users to play the game with base stats.
   * Guest sessions cannot earn permanent points - points are only shown for fun.
   */
  initiateGuestSession: publicProcedure.mutation(async ({ ctx }) => {
    const [upgradeDefinitions, enemyDefinitionsDb, playerCharactersDb] =
      await Promise.all([
        ctx.drizzle.query.towerDefenseUpgrade.findMany(),
        ctx.drizzle.query.towerDefenseCharacter.findMany({
          where: eq(towerDefenseCharacter.isPlayer, false),
          orderBy: [asc(towerDefenseCharacter.firstAppearWave)],
        }),
        ctx.drizzle.query.towerDefenseCharacter.findMany({
          where: eq(towerDefenseCharacter.isPlayer, true),
        }),
      ]);

    const ability = getShurikenAbility();
    const playerBonuses = getDefaultPlayerBonuses();
    const maxHealth = TD_PLAYER_BASE_HEALTH;

    return initiateSession({
      userId: "guest",
      ability,
      playerBonuses,
      maxHealth,
      upgradeDefinitions,
      enemyDefinitionsDb,
      playerCharactersDb,
      isGuest: true,
    });
  }),

  /**
   * Get past runs with pagination (for leaderboards)
   */
  getRunHistory: protectedProcedure
    .use(ratelimitMiddleware)
    .use(hasUserMiddleware)
    .input(
      z.object({
        cursor: z.string().optional(),
        limit: z.number().min(1).max(50).default(10),
      }),
    )
    .query(async ({ ctx, input }) => {
      const runs = await ctx.drizzle.query.towerDefenseRun.findMany({
        where: and(
          eq(towerDefenseRun.userId, ctx.userId),
          input.cursor ? lt(towerDefenseRun.id, input.cursor) : undefined,
        ),
        orderBy: [desc(towerDefenseRun.startedAt)],
        limit: input.limit + 1,
      });

      const hasMore = runs.length > input.limit;
      const items = hasMore ? runs.slice(0, -1) : runs;
      const nextCursor = hasMore ? items[items.length - 1]?.id : undefined;

      return { items, nextCursor };
    }),

  /**
   * Get leaderboard - top scores
   */
  getLeaderboard: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20) }))
    .query(async ({ ctx, input }) => {
      const runs = await ctx.drizzle.query.towerDefenseRun.findMany({
        where: eq(towerDefenseRun.status, "COMPLETED"),
        orderBy: [desc(towerDefenseRun.score)],
        limit: input.limit,
        with: {
          user: {
            columns: { username: true, avatar: true, rank: true },
          },
        },
      });

      return runs;
    }),

  // ============================================
  // Mutations
  // ============================================

  /**
   * Purchase or upgrade a permanent upgrade
   */
  purchasePermanentUpgrade: protectedProcedure
    .use(ratelimitMiddleware)
    .use(hasUserMiddleware)
    .input(purchaseUpgradeInputSchema)
    .output(
      baseServerResponse.extend({
        newLevel: z.number().optional(),
        remainingPoints: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [user, upgradeDef, existingUpgrade] = await Promise.all([
        ctx.drizzle.query.userData.findFirst({
          columns: { towerDefensePoints: true },
          where: eq(userData.userId, ctx.userId),
        }),
        ctx.drizzle.query.towerDefenseUpgrade.findFirst({
          where: eq(towerDefenseUpgrade.id, input.upgradeId),
        }),
        ctx.drizzle.query.userTowerDefenseUpgrade.findFirst({
          where: and(
            eq(userTowerDefenseUpgrade.userId, ctx.userId),
            eq(userTowerDefenseUpgrade.upgradeId, input.upgradeId),
          ),
        }),
      ]);

      if (!user) {
        return errorResponse("User not found.");
      }

      if (!upgradeDef) {
        return errorResponse("Upgrade not found.");
      }

      const currentLevel = existingUpgrade?.level ?? 0;

      if (currentLevel >= upgradeDef.maxLevel) {
        return errorResponse("Upgrade already at max level.");
      }

      const cost = calculateUpgradeCost(
        upgradeDef.baseCost,
        upgradeDef.costMultiplier,
        currentLevel,
      );

      // Guarded update to deduct points
      const result = await ctx.drizzle
        .update(userData)
        .set({
          towerDefensePoints: sql`${userData.towerDefensePoints} - ${cost}`,
        })
        .where(
          and(eq(userData.userId, ctx.userId), gte(userData.towerDefensePoints, cost)),
        );

      if (result.rowsAffected === 0) {
        return errorResponse("Insufficient points.");
      }

      // Upsert the upgrade
      await ctx.drizzle
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

      return {
        success: true,
        message: `Upgraded to level ${currentLevel + 1}!`,
        newLevel: currentLevel + 1,
        remainingPoints: user.towerDefensePoints - cost,
      };
    }),

  // ============================================
  // SpacetimeDB Integration
  // ============================================

  /**
   * Claim a completed run from SpacetimeDB
   *
   * This endpoint verifies the run data using HMAC signatures to prevent cheating.
   *
   * Security flow:
   * 1. Client initiated session via initiateSecureSession, receiving a signature
   * 2. Client passed signature + params to SpacetimeDB's create_session
   * 3. SpacetimeDB stored the signature and all original params
   * 4. Game runs, SpacetimeDB calculates final score/wave/points
   * 5. When game ends, SpacetimeDB creates CompletedRun with all data
   * 6. Client calls this endpoint with all the data from CompletedRun
   * 7. Server verifies:
   *    - Session signature matches the userId + nonce + all original params
   *    - Points earned matches the formula (score / 100)
   * 8. Only if valid, points are awarded
   */
  claimCompletedRun: protectedProcedure
    .use(ratelimitMiddleware)
    .use(hasUserMiddleware)
    .input(
      z.object({
        spacetimeSessionId: z.string(),
        // Session signature from SpacetimeDB CompletedRun
        sessionSignature: z.string().min(1, "Session signature required"),
        nonce: z.string().min(1, "Session nonce required"),
        // Definitions JSON for signature verification
        upgradeDefinitionsJson: z.string().min(1, "Upgrade definitions required"),
        enemyDefinitionsJson: z.string().min(1, "Enemy definitions required"),
        // All original session params needed to verify the signature
        abilityDamage: towerDefenseAbilitySchema.shape.damage,
        abilityRange: towerDefenseAbilitySchema.shape.range,
        abilityCooldownMs: towerDefenseAbilitySchema.shape.cooldownMs,
        abilityCritChance: towerDefenseAbilitySchema.shape.critChance,
        abilityDamagePerTile: towerDefenseAbilitySchema.shape.damagePerTile,
        playerMaxHealth: z.number().int().min(1),
        ...playerBonusesSchema.shape,
        scorePerKill: z.number().int().min(1),
        scoreToPointsRatio: z.number().int().min(1),
        initialGridSize: z.number().int().min(1),
        maxGridSize: z.number().int().min(1),
        gridExpandFreq: z.number().int().min(1),
        rangeVisualFactor: z.number().min(0),
        // Run results
        finalWave: z.number().int().min(0),
        finalScore: z.number().int().min(0),
        pointsEarned: z.number().int().min(0),
      }),
    )
    .output(
      baseServerResponse.extend({
        pointsEarned: z.number().optional(),
        finalScore: z.number().optional(),
        finalWave: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Parse and validate definitions from JSON using Zod schemas
      const upgradeParseResult = z
        .array(signedUpgradeDefinitionSchema)
        .safeParse(JSON.parse(input.upgradeDefinitionsJson));
      const enemyParseResult = z
        .array(signedEnemyDefinitionSchema)
        .safeParse(JSON.parse(input.enemyDefinitionsJson));

      if (!upgradeParseResult.success) {
        return errorResponse("Invalid upgrade definitions JSON.");
      }
      if (!enemyParseResult.success) {
        return errorResponse("Invalid enemy definitions JSON.");
      }

      const upgradeDefinitions = upgradeParseResult.data;
      const enemyDefinitions = enemyParseResult.data;

      // Verify the session signature matches the claimed parameters + definitions
      // This proves the game started with server-calculated stats AND authentic definitions
      const sessionParams: SessionParams = {
        userId: ctx.userId,
        nonce: input.nonce,
        abilityDamage: input.abilityDamage,
        abilityRange: input.abilityRange,
        abilityCooldownMs: input.abilityCooldownMs,
        abilityCritChance: input.abilityCritChance,
        abilityDamagePerTile: input.abilityDamagePerTile,
        playerMaxHealth: input.playerMaxHealth,
        healthRegen: input.healthRegen,
        defensePercent: input.defensePercent,
        defenseFlat: input.defenseFlat,
        lifestealPercent: input.lifestealPercent,
        knockbackChance: input.knockbackChance,
        knockbackForce: input.knockbackForce,
        tokensPerWave: input.tokensPerWave,
        tokensPerKill: input.tokensPerKill,
        interestPerWave: input.interestPerWave,
        skipEnemyChance: input.skipEnemyChance,
        scorePerKill: input.scorePerKill,
        scoreToPointsRatio: input.scoreToPointsRatio,
        initialGridSize: input.initialGridSize,
        maxGridSize: input.maxGridSize,
        gridExpandFreq: input.gridExpandFreq,
        rangeVisualFactor: input.rangeVisualFactor,
        upgradeDefinitions,
        enemyDefinitions,
      };

      const expectedSignature = signSessionParams(sessionParams);

      // Timing-safe comparison to prevent timing attacks
      const expectedBuffer = Buffer.from(expectedSignature, "utf8");
      const inputBuffer = Buffer.from(input.sessionSignature, "utf8");

      if (
        expectedBuffer.length !== inputBuffer.length ||
        !timingSafeEqual(expectedBuffer, inputBuffer)
      ) {
        return errorResponse(
          "Invalid session signature. The session may have started with tampered data.",
        );
      }

      // Verify points calculation is correct (score / ratio)
      const expectedPoints = Math.floor(input.finalScore / input.scoreToPointsRatio);
      if (input.pointsEarned !== expectedPoints) {
        return errorResponse(
          `Invalid points calculation. Expected ${expectedPoints}, got ${input.pointsEarned}.`,
        );
      }

      // Check if this run was already claimed (prevent double-claiming)
      const existingRun = await ctx.drizzle.query.towerDefenseRun.findFirst({
        where: eq(towerDefenseRun.seed, `spacetime-${input.spacetimeSessionId}`),
      });

      if (existingRun) {
        return errorResponse("This run has already been claimed.");
      }

      await Promise.all([
        // Create run record in MySQL for leaderboards
        ctx.drizzle.insert(towerDefenseRun).values({
          id: nanoid(),
          seed: `spacetime-${input.spacetimeSessionId}`,
          userId: ctx.userId,
          wave: input.finalWave,
          score: input.finalScore,
          gridSize: input.initialGridSize,
          status: "COMPLETED",
          state: {
            playerHealth: 0,
            playerPosition: { col: 0, row: 0 },
            inRunCurrency: 0,
            activeUpgrades: {},
            gridSize: input.initialGridSize,
          },
          endedAt: new Date(),
        }),
        // Award points if any
        input.pointsEarned > 0
          ? ctx.drizzle
              .update(userData)
              .set({
                towerDefensePoints: sql`${userData.towerDefensePoints} + ${input.pointsEarned}`,
              })
              .where(eq(userData.userId, ctx.userId))
          : Promise.resolve(),
      ]);

      return {
        success: true,
        message:
          input.pointsEarned > 0
            ? `Run completed! Earned ${input.pointsEarned} points.`
            : "Run completed!",
        pointsEarned: input.pointsEarned,
        finalScore: input.finalScore,
        finalWave: input.finalWave,
      };
    }),

  // ============================================
  // Character Definition Management (Staff Only)
  // ============================================

  /**
   * Get all character definitions (both players and enemies)
   */
  getCharacters: publicProcedure
    .input(
      z
        .object({
          isPlayer: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const whereClause =
        input?.isPlayer !== undefined
          ? eq(towerDefenseCharacter.isPlayer, input.isPlayer)
          : undefined;
      return await ctx.drizzle.query.towerDefenseCharacter.findMany({
        where: whereClause,
        orderBy: [asc(towerDefenseCharacter.firstAppearWave)],
      });
    }),

  /**
   * Get a single character definition by ID
   */
  getCharacter: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return await ctx.drizzle.query.towerDefenseCharacter.findFirst({
        where: eq(towerDefenseCharacter.id, input.id),
      });
    }),

  /**
   * Get all character names for dropdowns
   */
  getAllCharacterNames: publicProcedure
    .input(
      z
        .object({
          isPlayer: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const whereClause =
        input?.isPlayer !== undefined
          ? eq(towerDefenseCharacter.isPlayer, input.isPlayer)
          : undefined;
      return await ctx.drizzle.query.towerDefenseCharacter.findMany({
        columns: { id: true, name: true, isPlayer: true },
        where: whereClause,
        orderBy: [asc(towerDefenseCharacter.name)],
      });
    }),

  /**
   * Create a new character definition
   */
  createCharacter: protectedProcedure
    .use(ratelimitMiddleware)
    .use(hasUserMiddleware)
    .input(z.object({ isPlayer: z.boolean().default(false) }))
    .output(baseServerResponse.extend({ id: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.drizzle.query.userData.findFirst({
        where: eq(userData.userId, ctx.userId),
        columns: { role: true },
      });

      if (!user || !canChangeContent(user.role)) {
        return errorResponse("Not allowed to create characters");
      }

      const id = nanoid();
      const typeLabel = input.isPlayer ? "Player" : "Enemy";
      await ctx.drizzle.insert(towerDefenseCharacter).values({
        id,
        name: `New ${typeLabel} - ${id.slice(0, 6)}`,
        isPlayer: input.isPlayer,
      });

      return { success: true, message: `${typeLabel} created`, id };
    }),

  /**
   * Update a character definition
   */
  updateCharacter: protectedProcedure
    .use(ratelimitMiddleware)
    .use(hasUserMiddleware)
    .input(
      z.object({
        id: z.string(),
        data: insertTowerDefenseCharacterSchema,
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.drizzle.query.userData.findFirst({
        where: eq(userData.userId, ctx.userId),
        columns: { role: true },
      });

      if (!user || !canChangeContent(user.role)) {
        return errorResponse("Not allowed to update characters");
      }

      const existing = await ctx.drizzle.query.towerDefenseCharacter.findFirst({
        where: eq(towerDefenseCharacter.id, input.id),
      });

      if (!existing) {
        return errorResponse("Character not found");
      }

      await ctx.drizzle
        .update(towerDefenseCharacter)
        .set({
          ...input.data,
          updatedAt: new Date(),
        })
        .where(eq(towerDefenseCharacter.id, input.id));

      return { success: true, message: "Character updated" };
    }),

  /**
   * Delete a character definition
   */
  deleteCharacter: protectedProcedure
    .use(ratelimitMiddleware)
    .use(hasUserMiddleware)
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.drizzle.query.userData.findFirst({
        where: eq(userData.userId, ctx.userId),
        columns: { role: true },
      });

      if (!user || !canChangeContent(user.role)) {
        return errorResponse("Not allowed to delete characters");
      }

      await ctx.drizzle
        .delete(towerDefenseCharacter)
        .where(eq(towerDefenseCharacter.id, input.id));

      return { success: true, message: "Character deleted" };
    }),

  /**
   * Process uploaded character animation zip and create asset config
   */
  processCharacterZip: protectedProcedure
    .use(ratelimitMiddleware)
    .use(hasUserMiddleware)
    .input(
      z.object({
        characterId: z.string(),
        zipUrl: z.string().url(),
      }),
    )
    .output(
      baseServerResponse.extend({
        assetConfig: characterAssetConfigSchema.nullable().optional(),
        availableAnimations: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.drizzle.query.userData.findFirst({
        where: eq(userData.userId, ctx.userId),
        columns: { role: true },
      });

      if (!user || !canChangeContent(user.role)) {
        return errorResponse("Not allowed to process character assets");
      }

      try {
        // SSRF protection
        const isValid = await validateUrlForSsrf(input.zipUrl, [
          "https://ui0arpl8sm.ufs.sh/f/",
        ]);
        if (!isValid) {
          return errorResponse("Invalid or disallowed zipUrl");
        }

        // Fetch the zip file
        const response = await fetch(input.zipUrl);
        if (!response.ok) {
          return errorResponse("Failed to fetch zip file");
        }

        const zipBuffer = await response.arrayBuffer();
        // Dynamic import for JSZip to avoid bundling issues
        const JSZip = (await import("jszip")).default;
        const zip = await JSZip.loadAsync(zipBuffer);

        // Look for metadata.json
        const metadataFile = zip.file("metadata.json");
        if (!metadataFile) {
          return errorResponse("No metadata.json found in zip file");
        }

        const metadataContent = await metadataFile.async("string");
        // Validate metadata structure with Zod schema
        const metadataSchema = z.object({
          character: z.object({ name: z.string() }).optional(),
          frames: z.object({
            rotations: z.record(z.string()).optional(),
            animations: z.record(z.record(z.array(z.string()))).optional(),
          }),
        });

        const parseResult = metadataSchema.safeParse(JSON.parse(metadataContent));
        if (!parseResult.success) {
          return errorResponse(`Invalid metadata.json: ${parseResult.error.message}`);
        }
        const metadata = parseResult.data;

        const utapi = new UTApi();
        const uploadedUrls: Map<string, string> = new Map();
        const filesToUpload: { path: string; file: File }[] = [];

        // Collect all image files to upload
        for (const path of Object.keys(zip.files)) {
          const zipEntry = zip.files[path];
          if (!zipEntry) continue;
          if (
            !zipEntry.dir &&
            (path.endsWith(".png") || path.endsWith(".jpg") || path.endsWith(".webp"))
          ) {
            const content = await zipEntry.async("uint8array");
            const ext = path.split(".").pop() || "png";
            const mimeType =
              ext === "jpg"
                ? "image/jpeg"
                : ext === "webp"
                  ? "image/webp"
                  : "image/png";
            // Convert Uint8Array to Buffer for proper BlobPart compatibility
            const buffer = Buffer.from(content);
            const file = new File([buffer], path.replace(/\//g, "_"), {
              type: mimeType,
            });
            filesToUpload.push({ path, file });
          }
        }

        // Upload in batches of 20
        const batchSize = 20;
        for (let i = 0; i < filesToUpload.length; i += batchSize) {
          const batch = filesToUpload.slice(i, i + batchSize);
          const uploadResults = await utapi.uploadFiles(batch.map((f) => f.file));

          for (let j = 0; j < batch.length; j++) {
            const result = uploadResults[j];
            if (result && result.data?.ufsUrl) {
              uploadedUrls.set(batch[j]!.path, result.data.ufsUrl);
            }
          }
        }

        // Build rotations mapping
        const rotations: Record<string, string> = {};
        if (metadata.frames.rotations) {
          for (const [direction, path] of Object.entries(metadata.frames.rotations)) {
            const url = uploadedUrls.get(path);
            if (url) {
              // Map short directions to long format
              const longDir = directionToSpriteDirection(direction);
              if (longDir) {
                rotations[longDir] = url;
              }
            }
          }
        }

        // Build animations list (without state assignment - that's done in UI)
        const availableAnimations: string[] = [];
        const animations: Array<{
          name: string;
          state: "idle" | "moving" | "throw" | "punch";
          frames: Record<string, string[]>;
          frameDurationMs: number;
          loop: boolean;
        }> = [];

        if (metadata.frames.animations) {
          for (const [animName, directionFrames] of Object.entries(
            metadata.frames.animations,
          )) {
            availableAnimations.push(animName);

            const framesRecord: Record<string, string[]> = {};
            for (const [direction, framePaths] of Object.entries(directionFrames)) {
              const longDir = directionToSpriteDirection(direction);
              if (longDir && Array.isArray(framePaths)) {
                framesRecord[longDir] = framePaths
                  .map((p) => uploadedUrls.get(p))
                  .filter((url): url is string => !!url);
              }
            }

            // Default to idle state - user will configure in UI
            animations.push({
              name: animName,
              state: "idle",
              frames: framesRecord,
              frameDurationMs: 100,
              loop: true,
            });
          }
        }

        const assetConfig = {
          rotations,
          animations,
        };

        // Save to database
        await ctx.drizzle
          .update(towerDefenseCharacter)
          .set({
            assetConfig,
            updatedAt: new Date(),
          })
          .where(eq(towerDefenseCharacter.id, input.characterId));

        return {
          success: true,
          message: `Processed ${filesToUpload.length} files and created asset config`,
          assetConfig,
          availableAnimations,
        };
      } catch (error) {
        console.error("Error processing character zip:", error);
        return errorResponse(
          `Failed to process zip: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }),

  /**
   * Update asset config animation settings
   */
  updateAssetConfig: protectedProcedure
    .use(ratelimitMiddleware)
    .use(hasUserMiddleware)
    .input(
      z.object({
        characterId: z.string(),
        assetConfig: characterAssetConfigSchema,
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.drizzle.query.userData.findFirst({
        where: eq(userData.userId, ctx.userId),
        columns: { role: true },
      });

      if (!user || !canChangeContent(user.role)) {
        return errorResponse("Not allowed to update asset config");
      }

      await ctx.drizzle
        .update(towerDefenseCharacter)
        .set({
          assetConfig: input.assetConfig,
          updatedAt: new Date(),
        })
        .where(eq(towerDefenseCharacter.id, input.characterId));

      return { success: true, message: "Asset config updated" };
    }),

  // ============================================
  // Upgrade Definition Management (Staff Only)
  // ============================================

  /**
   * Get a single upgrade definition by ID
   */
  getUpgrade: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return await ctx.drizzle.query.towerDefenseUpgrade.findFirst({
        where: eq(towerDefenseUpgrade.id, input.id),
      });
    }),

  /**
   * Update an upgrade definition
   * Note: Upgrades can only be created/deleted by coding admins as they are tightly coupled with code
   */
  updateUpgrade: protectedProcedure
    .use(ratelimitMiddleware)
    .use(hasUserMiddleware)
    .input(
      z.object({
        id: z.string(),
        data: z.object({
          name: z.string().min(1).max(191),
          description: z.string(),
          maxLevel: z.number().int().min(1),
          baseCost: z.number().int().min(0),
          costMultiplier: z.number().min(1),
          upgradeType: z.enum(TowerDefenseUpgradeTypes),
          effectValue: z.number().min(0),
        }),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.drizzle.query.userData.findFirst({
        where: eq(userData.userId, ctx.userId),
        columns: { role: true },
      });

      if (!user || !canChangeContent(user.role)) {
        return errorResponse("Not allowed to update upgrades");
      }

      const existing = await ctx.drizzle.query.towerDefenseUpgrade.findFirst({
        where: eq(towerDefenseUpgrade.id, input.id),
      });

      if (!existing) {
        return errorResponse("Upgrade not found");
      }

      await ctx.drizzle
        .update(towerDefenseUpgrade)
        .set({
          ...input.data,
          updatedAt: new Date(),
        })
        .where(eq(towerDefenseUpgrade.id, input.id));

      return { success: true, message: "Upgrade updated" };
    }),
});

// ============================================
// Helper Functions for Session Initiation
// ============================================

type TowerDefenseUpgradeDb = InferSelectModel<typeof towerDefenseUpgrade>;

/** Convert DB enemy characters to game format */
function convertDbEnemiesToGameFormat(characters: TowerDefenseCharacterDb[]) {
  return characters.map((def) => ({
    id: def.id,
    enemyType: def.id,
    baseHealth: def.baseHealth,
    baseSpeed: def.baseSpeed,
    baseDamage: def.baseDamage,
    attackCooldown: def.attackCooldown,
    healthScaling: def.healthScaling,
    speedScaling: def.speedScaling,
    damageScaling: def.damageScaling,
    firstAppearWave: def.firstAppearWave,
    baseCount: def.baseCount,
    countScaling: def.countScaling,
  }));
}

/** Convert upgrade definitions to signed format for SpacetimeDB */
function toSignedUpgradeDefinitions(
  upgrades: TowerDefenseUpgradeDb[],
): SignedUpgradeDefinition[] {
  return upgrades.map((def) => ({
    id: def.id,
    maxLevel: def.maxLevel,
    baseCost: def.baseCost,
    costMultiplier: def.costMultiplier,
    effectValue: def.effectValue,
    upgradeType: def.upgradeType,
  }));
}

/** Convert enemy definitions to signed format for SpacetimeDB */
function toSignedEnemyDefinitions(
  enemies: ReturnType<typeof convertDbEnemiesToGameFormat>,
): SignedEnemyDefinition[] {
  return enemies.map((def) => ({
    id: def.id,
    enemyType: def.enemyType,
    baseHealth: def.baseHealth,
    baseSpeed: def.baseSpeed,
    baseDamage: def.baseDamage,
    attackCooldown: def.attackCooldown,
    healthScaling: def.healthScaling,
    speedScaling: def.speedScaling,
    damageScaling: def.damageScaling,
    firstAppearWave: def.firstAppearWave,
    baseCount: def.baseCount,
    countScaling: def.countScaling,
  }));
}

/** Build session params from ability, bonuses, and definitions */
function buildSessionParams(input: {
  userId: string;
  nonce: string;
  ability: ReturnType<typeof getShurikenAbility>;
  maxHealth: number;
  playerBonuses: ReturnType<typeof getDefaultPlayerBonuses>;
  signedUpgradeDefinitions: SignedUpgradeDefinition[];
  signedEnemyDefinitions: SignedEnemyDefinition[];
}): SessionParams {
  return {
    userId: input.userId,
    nonce: input.nonce,
    abilityDamage: input.ability.damage,
    abilityRange: input.ability.range,
    abilityCooldownMs: input.ability.cooldownMs,
    abilityCritChance: input.ability.critChance,
    abilityDamagePerTile: input.ability.damagePerTile,
    playerMaxHealth: input.maxHealth,
    healthRegen: input.playerBonuses.healthRegen,
    defensePercent: input.playerBonuses.defensePercent,
    defenseFlat: input.playerBonuses.defenseFlat,
    lifestealPercent: input.playerBonuses.lifestealPercent,
    knockbackChance: input.playerBonuses.knockbackChance,
    knockbackForce: input.playerBonuses.knockbackForce,
    tokensPerWave: input.playerBonuses.tokensPerWave,
    tokensPerKill: input.playerBonuses.tokensPerKill,
    interestPerWave: input.playerBonuses.interestPerWave,
    skipEnemyChance: input.playerBonuses.skipEnemyChance,
    scorePerKill: TD_SCORE_PER_KILL,
    scoreToPointsRatio: TD_SCORE_TO_POINTS_RATIO,
    initialGridSize: TD_INITIAL_GRID_SIZE,
    maxGridSize: TD_MAX_GRID_SIZE,
    gridExpandFreq: TD_GRID_EXPAND_EVERY_N_WAVES,
    rangeVisualFactor: TD_RANGE_VISUAL_FACTOR,
    upgradeDefinitions: input.signedUpgradeDefinitions,
    enemyDefinitions: input.signedEnemyDefinitions,
  };
}

/** Extract client params from session params (exclude server-only fields) */
function extractClientParams(sessionParams: SessionParams) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { userId, nonce, upgradeDefinitions, enemyDefinitions, ...clientParams } =
    sessionParams;
  return clientParams;
}

/**
 * Shared logic for initiating a tower defense session
 */
function initiateSession(input: {
  userId: string;
  ability: ReturnType<typeof getShurikenAbility>;
  playerBonuses: ReturnType<typeof getDefaultPlayerBonuses>;
  maxHealth: number;
  upgradeDefinitions: TowerDefenseUpgradeDb[];
  enemyDefinitionsDb: TowerDefenseCharacterDb[];
  playerCharactersDb: TowerDefenseCharacterDb[];
  isGuest?: boolean;
}) {
  const {
    userId,
    ability,
    playerBonuses,
    maxHealth,
    upgradeDefinitions,
    enemyDefinitionsDb,
    playerCharactersDb,
    isGuest,
  } = input;

  // Generate unique identifiers
  const nonce = generateSessionNonce();
  const seed = generateRunSeed();

  // Convert to signed formats for SpacetimeDB
  const signedUpgradeDefinitions = toSignedUpgradeDefinitions(upgradeDefinitions);
  const enemyDefinitions = convertDbEnemiesToGameFormat(enemyDefinitionsDb);
  const signedEnemyDefinitions = toSignedEnemyDefinitions(enemyDefinitions);

  // Build and sign session parameters
  const sessionParams = buildSessionParams({
    userId,
    nonce,
    ability,
    maxHealth,
    playerBonuses,
    signedUpgradeDefinitions,
    signedEnemyDefinitions,
  });
  const signature = signSessionParams(sessionParams);

  // Pick a random player character (or null if none configured)
  const playerCharacter =
    playerCharactersDb.length > 0
      ? playerCharactersDb[Math.floor(Math.random() * playerCharactersDb.length)]
      : null;

  return {
    seed,
    nonce,
    signature,
    isGuest,
    params: extractClientParams(sessionParams),
    upgradeDefinitions: signedUpgradeDefinitions,
    enemyDefinitions: signedEnemyDefinitions,
    enemyAssetConfigs: getCharacterAssetConfigs(enemyDefinitionsDb),
    playerCharacter: playerCharacter
      ? {
          id: playerCharacter.id,
          name: playerCharacter.name,
          assetConfig: playerCharacter.assetConfig,
          scaleFactor: playerCharacter.scaleFactor,
        }
      : null,
    ability,
    playerBonuses,
  };
}

/** Get character asset configs for rendering */
function getCharacterAssetConfigs(characters: TowerDefenseCharacterDb[]) {
  return characters
    .filter(
      (
        def,
      ): def is TowerDefenseCharacterDb & {
        assetConfig: NonNullable<TowerDefenseCharacterDb["assetConfig"]>;
      } => def.assetConfig !== null,
    )
    .map((def) => ({
      enemyType: def.id,
      assetConfig: def.assetConfig,
      scaleFactor: def.scaleFactor,
    }));
}
