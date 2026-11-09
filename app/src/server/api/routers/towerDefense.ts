import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { UTApi, UTFile } from "uploadthing/server";
import { z } from "zod";
import {
  TD_GRID_EXPAND_EVERY_N_WAVES,
  TD_INITIAL_GRID_SIZE,
  TD_MAX_GRID_SIZE,
  TD_PLAYER_BASE_HEALTH,
  TD_RANGE_VISUAL_FACTOR,
  TD_SCORE_PER_KILL,
  TD_SCORE_TO_POINTS_RATIO,
} from "@/drizzle/constants";
import {
  type TowerDefenseCharacterDb,
  type TowerDefenseUpgrade,
  towerDefenseCharacter,
} from "@/drizzle/schema";
import {
  applyUpgradesToAbility,
  calculatePlayerBonuses,
  getDefaultPlayerBonuses,
  getModifiedPlayerHealth,
  getShurikenAbility,
} from "@/libs/towerDefense/abilities";
import {
  calculateUpgradeCost,
  directionToSpriteDirection,
} from "@/libs/towerDefense/game";
import { servedUfsUrl, UPLOADTHING_HOST } from "@/libs/uploadthing";
import { findUserRoleById } from "@/queries/profile";
import {
  deleteTowerDefenseCharacterForDeleteCharacter,
  findTowerDefenseCharacterForGetCharacter,
  findTowerDefenseUpgradeById,
  findUserDataForGetUserUpgrades,
  findUserTowerDefenseUpgradeForPurchasePermanentUpgrade,
  insertTowerDefenseCharacterForCreateCharacter,
  insertTowerDefenseClaimReceiptForClaimCompletedRun,
  insertTowerDefenseRunForClaimCompletedRun,
  insertUserTowerDefenseUpgradeForPurchasePermanentUpgrade,
  listTowerDefenseCharacterForGetAssetConfigs,
  listTowerDefenseCharacterForGetCharacters,
  listTowerDefenseCharacterForInitiateSession,
  listTowerDefenseRunForGetLeaderboard,
  listTowerDefenseRunForGetRunHistory,
  listTowerDefenseUpgradeForGetUpgrades,
  listTowerDefenseUpgradeForInitiateSecureSession,
  listUserTowerDefenseUpgradeForGetUserUpgrades,
  updateTowerDefenseCharacterAssets,
  updateTowerDefenseCharacterForUpdateCharacter,
  updateTowerDefenseUpgradeForUpdateUpgrade,
  updateUserDataForClaimCompletedRun,
  updateUserDataForPurchasePermanentUpgrade,
} from "@/queries/towerDefense";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
  ratelimitMiddleware,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { constantTimeEquals } from "@/server/utils/constantTime";
import {
  clientErrorMessage,
  isMysqlDuplicateKeyError,
} from "@/server/utils/mysqlErrors";
import { logDatabaseFailure } from "@/server/utils/sentry";
import { validateUrlForSsrf } from "@/server/utils/ssrf";
import {
  areTowerDefenseClaimsEnabled,
  fetchSpacetimeCompletedRun,
  TOWER_DEFENSE_CLAIMS_PAUSED_MESSAGE,
  towerDefenseClaimKey,
} from "@/server/utils/towerDefenseClaims";
import {
  generateSessionNonce,
  type SessionParams,
  signSessionParams,
} from "@/server/utils/towerDefenseCrypto";
import { chunkArray, getRandomElement } from "@/utils/array";
import { canChangeContent } from "@/utils/permissions";
import { idSchema } from "@/validators/misc";
import type {
  CharacterAnimationState,
  SignedEnemyDefinition,
  SignedUpgradeDefinition,
} from "@/validators/towerDefense";
import {
  characterAssetConfigSchema,
  signedEnemyDefinitionSchema,
  signedUpgradeDefinitionSchema,
  updateTowerDefenseUpgradeSchema,
} from "@/validators/towerDefense";
import { insertTowerDefenseCharacterSchema } from "@/validators/towerDefenseCharacter";

const purchaseUpgradeInputSchema = z.object({
  upgradeId: z.string(),
});

/**
 * A claim names the SpacetimeDB session only. Score, wave and the signed session
 * parameters are read from that session's authoritative completed_run row; the
 * definitions are not stored there, so the client supplies them and the session
 * signature proves they are the ones the server signed.
 */
const claimCompletedRunInputSchema = z.object({
  spacetimeSessionId: z.string().regex(/^\d{1,20}$/, "Invalid session ID"),
  upgradeDefinitionsJson: z.string().min(1, "Upgrade definitions required"),
  enemyDefinitionsJson: z.string().min(1, "Enemy definitions required"),
});

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
  getUpgrades: publicProcedure
    .meta({ mcp: { description: "Get all tower defense upgrades" } })
    .query(async ({ ctx }) => {
      return await listTowerDefenseUpgradeForGetUpgrades(ctx.drizzle);
    }),

  /**
   * Get all character asset configs for rendering
   */
  getAssetConfigs: publicProcedure
    .meta({ mcp: { description: "Get tower defense asset configs" } })
    .query(async ({ ctx }) => {
      const characters = await listTowerDefenseCharacterForGetAssetConfigs(ctx.drizzle);
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
    .meta({ mcp: { description: "Get user's tower defense upgrades" } })
    .use(ratelimitMiddleware)
    .query(async ({ ctx }) => {
      const [upgrades, user] = await Promise.all([
        listUserTowerDefenseUpgradeForGetUserUpgrades(ctx.drizzle, ctx),
        findUserDataForGetUserUpgrades(ctx.drizzle, ctx),
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
   * 2. Server calculates the starting stats from those upgrades
   * 3. Server signs (userId, nonce, stats, upgrade_definitions) with HMAC
   * 4. Client passes signed params + definitions to SpacetimeDB
   * 5. SpacetimeDB stores everything for use during the game
   * 6. When purchasing in-run upgrades, SpacetimeDB uses the stored signed definitions
   * 7. When claiming, server verifies signature matches all data including definitions
   */
  initiateSecureSession: protectedProcedure
    .meta({
      mcp: { description: "Start a secure tower defense session" },
    })
    .use(ratelimitMiddleware)
    .mutation(async ({ ctx }) => {
      const [userUpgrades, definitions] = await Promise.all([
        listUserTowerDefenseUpgradeForGetUserUpgrades(ctx.drizzle, ctx),
        fetchSessionDefinitions(ctx.drizzle),
      ]);
      const { upgradeDefinitions } = definitions;

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
        ...definitions,
      });
    }),

  /**
   * Initiate a guest tower defense session (no authentication required)
   *
   * This endpoint allows unauthenticated users to play the game with base stats.
   * Guest sessions cannot earn permanent points - points are only shown for fun.
   */
  initiateGuestSession: publicProcedure
    .meta({
      mcp: { description: "Start a guest tower defense session" },
    })
    .mutation(async ({ ctx }) => {
      const definitions = await fetchSessionDefinitions(ctx.drizzle);
      const ability = getShurikenAbility();
      const playerBonuses = getDefaultPlayerBonuses();
      const maxHealth = TD_PLAYER_BASE_HEALTH;

      return initiateSession({
        userId: "guest",
        ability,
        playerBonuses,
        maxHealth,
        ...definitions,
        isGuest: true,
      });
    }),

  /**
   * List the caller's past runs in stable chronological pages.
   */
  getRunHistory: protectedProcedure
    .meta({
      mcp: { description: "Get user's tower defense run history" },
    })
    .use(ratelimitMiddleware)
    .input(
      z.object({
        cursor: z.string().optional(),
        limit: z.number().min(1).max(50).prefault(10),
      }),
    )
    .query(async ({ ctx, input }) => {
      const runs = await listTowerDefenseRunForGetRunHistory(ctx.drizzle, ctx, input);

      const hasMore = runs.length > input.limit;
      const items = hasMore ? runs.slice(0, -1) : runs;
      const nextCursor = hasMore ? items[items.length - 1]?.id : undefined;

      return { items, nextCursor };
    }),

  /**
   * Get leaderboard - top scores
   */
  getLeaderboard: publicProcedure
    .meta({ mcp: { description: "Get tower defense leaderboard" } })
    .input(z.object({ limit: z.number().min(1).max(100).prefault(20) }))
    .query(async ({ ctx, input }) => {
      const runs = await listTowerDefenseRunForGetLeaderboard(ctx.drizzle, input);

      return runs;
    }),

  // ============================================
  // Mutations
  // ============================================

  /**
   * Purchase or upgrade a permanent upgrade
   */
  purchasePermanentUpgrade: protectedProcedure
    .meta({ mcp: { description: "Purchase tower defense upgrade" } })
    .use(ratelimitMiddleware)
    .input(purchaseUpgradeInputSchema)
    .output(
      baseServerResponse.extend({
        newLevel: z.number().optional(),
        remainingPoints: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [user, upgradeDef, existingUpgrade] = await Promise.all([
        findUserDataForGetUserUpgrades(ctx.drizzle, ctx),
        findTowerDefenseUpgradeById(ctx.drizzle, input.upgradeId),
        findUserTowerDefenseUpgradeForPurchasePermanentUpgrade(ctx.drizzle, ctx, input),
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

      // Guarded update to deduct points. The level comes from the snapshot above, so
      // concurrent purchases by the same account can each pay for the same level (or a
      // stale request can write back a lower one). The cost stays on that account's own
      // points and support can restore it, so this stays a readable check-then-write.
      const result = await updateUserDataForPurchasePermanentUpgrade(
        ctx.drizzle,
        cost,
        ctx,
      );

      if (result.rowsAffected === 0) {
        return errorResponse("Insufficient points.");
      }

      // Upsert the upgrade
      await insertUserTowerDefenseUpgradeForPurchasePermanentUpgrade(
        ctx.drizzle,
        ctx,
        input,
        currentLevel,
      );

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
   * The client names the session; everything that is paid out is read server-side:
   * 1. Claims are refused while `TOWER_DEFENSE_CLAIMS_ENABLED` is not "true".
   * 2. The session's completed_run row is read from SpacetimeDB, whose game loop
   *    computed the final score; it must belong to the caller.
   * 3. The HMAC session signature must match that row's starting parameters, the
   *    caller's user ID and the supplied definitions, proving the run started from
   *    `initiateSecureSession`.
   * 4. A TowerDefenseClaimReceipt keyed on the signed nonce is inserted before points are
   *    granted; its unique key makes each signed session claimable once, and receipts
   *    are kept through the monthly leaderboard reset.
   */
  claimCompletedRun: protectedProcedure
    .meta({ mcp: { description: "Claim completed tower defense run" } })
    .use(ratelimitMiddleware)
    .input(claimCompletedRunInputSchema)
    .output(
      baseServerResponse.extend({
        claimsPaused: z.boolean().optional(),
        pointsEarned: z.number().optional(),
        finalScore: z.number().optional(),
        finalWave: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!areTowerDefenseClaimsEnabled()) {
        return {
          ...errorResponse(TOWER_DEFENSE_CLAIMS_PAUSED_MESSAGE),
          claimsPaused: true,
        };
      }

      const upgradeParseResult = z
        .array(signedUpgradeDefinitionSchema)
        .safeParse(parseJsonOrUndefined(input.upgradeDefinitionsJson));
      const enemyParseResult = z
        .array(signedEnemyDefinitionSchema)
        .safeParse(parseJsonOrUndefined(input.enemyDefinitionsJson));

      if (!upgradeParseResult.success) {
        return errorResponse("Invalid upgrade definitions JSON.");
      }
      if (!enemyParseResult.success) {
        return errorResponse("Invalid enemy definitions JSON.");
      }

      let run: Awaited<ReturnType<typeof fetchSpacetimeCompletedRun>>;
      try {
        run = await fetchSpacetimeCompletedRun(input.spacetimeSessionId);
      } catch (error) {
        console.error("[towerDefense] Failed to read completed run", error);
        return errorResponse(
          "Could not verify this run with the game server. Please try again.",
        );
      }

      if (!run) {
        return errorResponse("No completed run was found for this session.");
      }
      if (run.ninjarpg_user_id !== ctx.userId) {
        return errorResponse("This run belongs to another player.");
      }

      // The signature covers the user, nonce, starting parameters and definitions
      const sessionParams: SessionParams = {
        userId: ctx.userId,
        nonce: run.nonce,
        abilityDamage: run.ability_damage,
        abilityRange: run.ability_range,
        abilityCooldownMs: run.ability_cooldown_ms,
        abilityCritChance: run.ability_crit_chance,
        abilityDamagePerTile: run.ability_damage_per_tile,
        playerMaxHealth: run.player_max_health,
        healthRegen: run.health_regen,
        defensePercent: run.defense_percent,
        defenseFlat: run.defense_flat,
        lifestealPercent: run.lifesteal_percent,
        knockbackChance: run.knockback_chance,
        knockbackForce: run.knockback_force,
        tokensPerWave: run.tokens_per_wave,
        tokensPerKill: run.tokens_per_kill,
        interestPerWave: run.interest_per_wave,
        skipEnemyChance: run.skip_enemy_chance,
        scorePerKill: run.score_per_kill,
        scoreToPointsRatio: run.score_to_points_ratio,
        initialGridSize: run.initial_grid_size,
        maxGridSize: run.max_grid_size,
        gridExpandFreq: run.grid_expand_freq,
        rangeVisualFactor: run.range_visual_factor,
        upgradeDefinitions: upgradeParseResult.data,
        enemyDefinitions: enemyParseResult.data,
      };

      if (
        !constantTimeEquals(signSessionParams(sessionParams), run.session_signature)
      ) {
        return errorResponse(
          "Invalid session signature. The session may have started with tampered data.",
        );
      }

      const finalScore = run.final_score;
      const finalWave = run.final_wave;
      const pointsEarned = Math.floor(finalScore / run.score_to_points_ratio);
      const claimKey = towerDefenseClaimKey(run.nonce);

      // The receipt is the claim: only the insert that wins the unique key pays out
      try {
        await insertTowerDefenseClaimReceiptForClaimCompletedRun(
          ctx.drizzle,
          claimKey,
          ctx,
          input,
          finalWave,
          finalScore,
          pointsEarned,
        );
      } catch (error) {
        if (isMysqlDuplicateKeyError(error)) {
          return errorResponse("This run has already been claimed.");
        }
        throw error;
      }

      const [updateResult] = await Promise.all([
        pointsEarned > 0
          ? updateUserDataForClaimCompletedRun(ctx.drizzle, pointsEarned, ctx)
          : Promise.resolve({ rowsAffected: 1 }),
        // Leaderboard entry; cleared by the monthly reset, unlike the receipt
        insertTowerDefenseRunForClaimCompletedRun(
          ctx.drizzle,
          claimKey,
          ctx,
          finalWave,
          finalScore,
          run,
        ),
      ]);

      if (updateResult.rowsAffected === 0) {
        return errorResponse("Failed to award points. User data might be missing.");
      }

      return {
        success: true,
        message:
          pointsEarned > 0
            ? `Run completed! Earned ${pointsEarned} points.`
            : "Run completed!",
        pointsEarned,
        finalScore,
        finalWave,
      };
    }),

  // ============================================
  // Character Definition Management (Staff Only)
  // ============================================

  /**
   * Get all character definitions (both players and enemies)
   */
  getCharacters: publicProcedure
    .meta({ mcp: { description: "Get tower defense characters" } })
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
      return await listTowerDefenseCharacterForGetCharacters(ctx.drizzle, whereClause);
    }),

  /**
   * Get a single character definition by ID
   */
  getCharacter: publicProcedure
    .meta({ mcp: { description: "Get a tower defense character" } })
    .input(idSchema)
    .query(async ({ ctx, input }) => {
      return await findTowerDefenseCharacterForGetCharacter(ctx.drizzle, input);
    }),

  /**
   * Create a new character definition
   */
  createCharacter: protectedProcedure
    .use(ratelimitMiddleware)
    .input(z.object({ isPlayer: z.boolean().prefault(false) }))
    .output(baseServerResponse.extend({ id: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const user = await findUserRoleById(ctx.drizzle, ctx.userId);

      if (!user || !canChangeContent(user.role)) {
        return errorResponse("Not allowed to create characters");
      }

      const id = nanoid();
      const typeLabel = input.isPlayer ? "Player" : "Enemy";
      await insertTowerDefenseCharacterForCreateCharacter(
        ctx.drizzle,
        id,
        typeLabel,
        input,
      );

      return { success: true, message: `${typeLabel} created`, id };
    }),

  /**
   * Update a character definition
   */
  updateCharacter: protectedProcedure
    .use(ratelimitMiddleware)
    .input(
      z.object({
        id: z.string(),
        data: insertTowerDefenseCharacterSchema,
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await findUserRoleById(ctx.drizzle, ctx.userId);

      if (!user || !canChangeContent(user.role)) {
        return errorResponse("Not allowed to update characters");
      }

      const existing = await findTowerDefenseCharacterForGetCharacter(
        ctx.drizzle,
        input,
      );

      if (!existing) {
        return errorResponse("Character not found");
      }

      await updateTowerDefenseCharacterForUpdateCharacter(ctx.drizzle, input);

      return { success: true, message: "Character updated" };
    }),

  /**
   * Delete a character definition
   */
  deleteCharacter: protectedProcedure
    .use(ratelimitMiddleware)
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await findUserRoleById(ctx.drizzle, ctx.userId);

      if (!user || !canChangeContent(user.role)) {
        return errorResponse("Not allowed to delete characters");
      }

      await deleteTowerDefenseCharacterForDeleteCharacter(ctx.drizzle, input);

      return { success: true, message: "Character deleted" };
    }),

  /**
   * Process uploaded character animation zip and create asset config
   */
  processCharacterZip: protectedProcedure
    .use(ratelimitMiddleware)
    .input(
      z.object({
        characterId: z.string(),
        zipUrl: z.url(),
      }),
    )
    .output(
      baseServerResponse.extend({
        assetConfig: characterAssetConfigSchema.nullable().optional(),
        availableAnimations: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await findUserRoleById(ctx.drizzle, ctx.userId);

      if (!user || !canChangeContent(user.role)) {
        return errorResponse("Not allowed to process character assets");
      }

      try {
        // SSRF protection
        const isValid = await validateUrlForSsrf(input.zipUrl, [
          `${UPLOADTHING_HOST}/f/`,
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
            rotations: z.record(z.string(), z.string()).optional(),
            animations: z
              .record(z.string(), z.record(z.string(), z.array(z.string())))
              .optional(),
          }),
        });

        const parseResult = metadataSchema.safeParse(JSON.parse(metadataContent));
        if (!parseResult.success) {
          return errorResponse(`Invalid metadata.json: ${parseResult.error.message}`);
        }
        const metadata = parseResult.data;

        const utapi = new UTApi();
        const uploadedUrls: Map<string, string> = new Map();
        const filesToUpload: { path: string; file: UTFile }[] = [];

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
            const fileName = path.replace(/\//g, "_");
            const file = new UTFile([buffer], fileName, {
              type: mimeType,
              customId: `${nanoid()}.${ext}`,
            });
            filesToUpload.push({ path, file });
          }
        }

        // Upload in batches of 20
        for (const batch of chunkArray(filesToUpload, 20)) {
          const uploadResults = await utapi.uploadFiles(batch.map((f) => f.file));

          for (let j = 0; j < batch.length; j++) {
            const result = uploadResults[j];
            const batchItem = batch[j];
            if (result?.data?.ufsUrl && batchItem) {
              uploadedUrls.set(batchItem.path, servedUfsUrl(result.data));
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
              rotations[directionToSpriteDirection(direction)] = url;
            }
          }
        }

        // Build animations list (without state assignment - that's done in UI)
        const availableAnimations: string[] = [];
        const animations: Array<{
          name: string;
          state: CharacterAnimationState;
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
              framesRecord[directionToSpriteDirection(direction)] = framePaths
                .map((p) => uploadedUrls.get(p))
                .filter((url): url is string => !!url);
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
        await updateTowerDefenseCharacterAssets(
          ctx.drizzle,
          assetConfig,
          input.characterId,
        );

        return {
          success: true,
          message: `Processed ${filesToUpload.length} files and created asset config`,
          assetConfig,
          availableAnimations,
        };
      } catch (error) {
        console.error("Error processing character zip:", error);
        logDatabaseFailure(error, "Could not process a character zip");
        return errorResponse(
          `Failed to process zip: ${error instanceof Error ? clientErrorMessage(error) : "Unknown error"}`,
        );
      }
    }),

  // ============================================
  // Upgrade Definition Management (Staff Only)
  // ============================================

  /**
   * Get a single upgrade definition by ID
   */
  getUpgrade: publicProcedure
    .meta({ mcp: { description: "Get a tower defense upgrade by ID" } })
    .input(idSchema)
    .query(async ({ ctx, input }) => {
      return await findTowerDefenseUpgradeById(ctx.drizzle, input.id);
    }),

  /**
   * Update an upgrade definition
   * Note: Upgrades can only be created/deleted by coding admins as they are tightly coupled with code
   */
  updateUpgrade: protectedProcedure
    .use(ratelimitMiddleware)
    .input(
      z.object({
        id: z.string(),
        data: updateTowerDefenseUpgradeSchema,
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await findUserRoleById(ctx.drizzle, ctx.userId);

      if (!user || !canChangeContent(user.role)) {
        return errorResponse("Not allowed to update upgrades");
      }

      const existing = await findTowerDefenseUpgradeById(ctx.drizzle, input.id);

      if (!existing) {
        return errorResponse("Upgrade not found");
      }

      await updateTowerDefenseUpgradeForUpdateUpgrade(ctx.drizzle, input);

      return { success: true, message: "Upgrade updated" };
    }),
});

// ============================================
// Helper Functions for Session Initiation
// ============================================

/** Convert upgrade definitions to signed format for SpacetimeDB */
function toSignedUpgradeDefinitions(
  upgrades: TowerDefenseUpgrade[],
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

/** Convert DB enemy characters to signed format for SpacetimeDB */
function toSignedEnemyDefinitions(
  characters: TowerDefenseCharacterDb[],
): SignedEnemyDefinition[] {
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
  const { userId, nonce, upgradeDefinitions, enemyDefinitions, ...clientParams } =
    sessionParams;
  return clientParams;
}

/** Load the definitions a session signs; enemies keep their wave order. */
const fetchSessionDefinitions = async (client: DrizzleClient) => {
  const [upgradeDefinitions, characters] = await Promise.all([
    listTowerDefenseUpgradeForInitiateSecureSession(client),
    listTowerDefenseCharacterForInitiateSession(client),
  ]);
  return {
    upgradeDefinitions,
    enemyDefinitionsDb: characters.filter((c) => !c.isPlayer),
    playerCharactersDb: characters.filter((c) => c.isPlayer),
  };
};

/**
 * Shared logic for initiating a tower defense session
 */
function initiateSession(input: {
  userId: string;
  ability: ReturnType<typeof getShurikenAbility>;
  playerBonuses: ReturnType<typeof getDefaultPlayerBonuses>;
  maxHealth: number;
  upgradeDefinitions: TowerDefenseUpgrade[];
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
  const seed = crypto.randomUUID();

  // Convert to signed formats for SpacetimeDB
  const signedUpgradeDefinitions = toSignedUpgradeDefinitions(upgradeDefinitions);
  const signedEnemyDefinitions = toSignedEnemyDefinitions(enemyDefinitionsDb);

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
  const playerCharacter = getRandomElement(playerCharactersDb) ?? null;

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

/** Parses JSON, returning undefined for malformed input so schema validation rejects it. */
function parseJsonOrUndefined(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}
