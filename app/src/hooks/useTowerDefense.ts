/**
 * React Hook for Tower Defense with SpacetimeDB
 *
 * This hook manages the tower defense game state using SpacetimeDB for
 * authoritative server-side game logic. All game state comes from SpacetimeDB
 * in real-time - no client-side simulation or server validation needed.
 */

import { useState, useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { api } from "@/app/_trpc/client";
import { profiler } from "@/libs/threejs/util";
import {
  registerEnemyAssetConfig,
  clearEnemyAssetConfigCache,
  registerPlayerAssetConfig,
  clearPlayerAssetConfigCache,
} from "@/libs/threejs/towerDefense";
import {
  getSpacetimeDBConnection,
  type GameSession,
  type SessionState,
  type Enemy,
  type Projectile,
  type SessionUpgrade,
  type CompletedRun,
  type SpacetimeDBEvent,
  type EnemySpawn,
} from "@/libs/spacetimedb/client";
import { getDefaultPlayerBonuses } from "@/libs/towerDefense/abilities";
import { calculateHexDistance } from "@/libs/towerDefense/game";
import {
  towerDefenseEnemySchema,
  towerDefenseProjectileSchema,
  towerDefenseStateSchema,
  towerDefenseAbilitySchema,
  playerBonusesSchema,
  towerDefenseGameStateSchema,
} from "@/validators/towerDefense";
import type {
  TowerDefenseState,
  TowerDefenseEnemy,
  TowerDefenseProjectile,
  HexPosition,
  TowerDefenseGameState,
  GameMode,
  EntityStore,
  RuntimeState,
  HudValues,
} from "@/validators/towerDefense";
import {
  TD_EXISTING_SESSION_CHECK_TIMEOUT_MS,
  TD_HIT_EVENT_DURATION_MS,
  TD_PLAYER_BASE_HEALTH,
  TD_PROJECTILE_SPEED,
} from "@/drizzle/constants";

// ============================================================================
// MODULE-LEVEL HUD STORE (Global Singleton)
// Uses global/window storage to survive Hot Module Replacement
// ============================================================================
type HudStore = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => number;
  getValues: () => HudValues;
  update: (newValues: Partial<HudValues>) => void;
  reset: () => void;
};

// Global key for the store
const HUD_STORE_KEY = "__TOWER_DEFENSE_HUD_STORE__" as const;

// Declare global type for TypeScript
declare global {
  var __TOWER_DEFENSE_HUD_STORE__: HudStore | undefined;
}

const createHudStore = (): HudStore => {
  const listeners = new Set<() => void>();
  let version = 0;
  let values: HudValues = {
    score: 0,
    currentWave: 0,
    waveInProgress: false,
    maxHealth: TD_PLAYER_BASE_HEALTH,
    enemyCount: 0,
    playerHealth: 0,
    abilities: [],
    activeUpgrades: {},
    inRunCurrency: 0,
  };

  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => version,
    getValues: () => values,
    update: (newValues: Partial<HudValues>) => {
      values = { ...values, ...newValues };
      version++;
      listeners.forEach((l) => l());
    },
    reset: () => {
      values = {
        score: 0,
        currentWave: 0,
        waveInProgress: false,
        maxHealth: TD_PLAYER_BASE_HEALTH,
        enemyCount: 0,
        playerHealth: 0,
        abilities: [],
        activeUpgrades: {},
        inRunCurrency: 0,
      };
      version++;
      listeners.forEach((l) => l());
    },
  };
};

// TRUE GLOBAL SINGLETON: Survives HMR and module reloading
// This ensures all imports get the same store instance
const getHudStore = (): HudStore => {
  if (typeof globalThis !== "undefined") {
    if (!globalThis[HUD_STORE_KEY]) {
      globalThis[HUD_STORE_KEY] = createHudStore();
    }
    return globalThis[HUD_STORE_KEY];
  }
  // Fallback for environments without globalThis
  return createHudStore();
};

const hudStore = getHudStore();

// Export for use in page.tsx
export { hudStore };
export type { HudValues };

/**
 * Custom hook that subscribes to the HUD store using useSyncExternalStore.
 * PERFORMANCE: useSyncExternalStore is more efficient than useState/useEffect:
 * - Only triggers re-renders when getSnapshot() returns a different value
 * - React batches updates more efficiently
 * - Designed specifically for external stores
 * - Does NOT cause parent component re-renders
 *
 * The getValues function returns a new object reference when values change
 * (via spread in update()), so Object.is() comparison will detect changes.
 */
export const useHudStoreValues = (): HudValues => {
  // Return the actual values directly - useSyncExternalStore detects changes via Object.is
  return useSyncExternalStore(
    hudStore.subscribe,
    hudStore.getValues,
    hudStore.getValues,
  );
};

/**
 * Game state interface - maintains compatibility with rendering components
 */

const initialGameState = towerDefenseGameStateSchema.parse({
  mode: "lobby",
  runId: null,
  seed: null,
  currentWave: 0,
  score: 0,
  state: null,
  enemies: [], // NOTE: This is kept empty - actual enemies are in entitiesRef
  projectiles: [], // NOTE: This is kept empty - actual projectiles are in entitiesRef
  abilities: [],
  waveStartTime: 0,
  waveInProgress: false,
  isSubmitting: false,
  error: null,
  playerHitEvents: [],
  enemyHitEvents: [],
  finalPointsEarned: null,
  playerBonuses: getDefaultPlayerBonuses(),
  maxHealth: TD_PLAYER_BASE_HEALTH,
  existingSession: null,
  enemyCount: 0, // PERFORMANCE: Synced at throttled 10fps rate for HUD display
});

// COST OPTIMIZATION: Extended EntityStore to include enemy spawn data
// Enemy spawn data (path, maxHealth) is stored separately and never updated
interface ExtendedEntityStore extends EntityStore {
  enemySpawns: Map<string, EnemySpawn>;
}

const createEntityStore = (): ExtendedEntityStore => ({
  enemies: new Map(),
  projectiles: new Map(),
  enemiesArray: [],
  projectilesArray: [],
  enemiesVersion: 0,
  projectilesVersion: 0,
  enemySpawns: new Map(),
});

const createRuntimeState = (): RuntimeState => ({
  score: 0,
  currentWave: 0,
  waveInProgress: false,
  waveStartTime: 0,
  maxHealth: TD_PLAYER_BASE_HEALTH,
  state: null,
  abilities: [],
  playerBonuses: getDefaultPlayerBonuses(),
  enemyCount: 0,
});

/**
 * Convert SpacetimeDB Enemy to TowerDefenseEnemy format for rendering
 * COST OPTIMIZATION: Path and maxHealth come from separate EnemySpawn table
 * which is only sent once per enemy (never updated)
 */
const convertEnemy = (
  e: Enemy,
  spawnData: EnemySpawn | undefined,
): TowerDefenseEnemy => {
  const path = spawnData?.path ?? [];
  const maxHealth = spawnData?.maxHealth ?? e.health;

  return towerDefenseEnemySchema.parse({
    id: `enemy-${e.id}`,
    aiUserId: "",
    enemyType: e.enemyType,
    position: { col: e.col, row: e.row },
    path: path.map((p) => ({ col: p.col, row: p.row })),
    pathIndex: e.pathIndex,
    health: e.health,
    maxHealth,
    speed: e.speed,
    damage: e.damage,
    attackCooldown: e.attackCooldown,
    lastAttackTime: e.lastAttackTime > BigInt(0) ? Number(e.lastAttackTime) : undefined,
    movementProgress: e.movementProgress,
    direction: e.direction,
  });
};

// Extended projectile type that includes clientSpawnTime for client-side interpolation
type TowerDefenseProjectileWithSpawn = TowerDefenseProjectile & {
  clientSpawnTime: number;
};

/**
 * Convert SpacetimeDB Projectile to TowerDefenseProjectile format for rendering
 * COST OPTIMIZATION: Progress is computed client-side from client spawn timestamp
 * Server only sends insert/delete events, no progress updates
 *
 * @param p - The projectile from SpacetimeDB
 * @param existingClientSpawnTime - If updating an existing projectile, use its original spawn time
 */
const convertProjectile = (
  p: Projectile,
  existingClientSpawnTime?: number,
): TowerDefenseProjectileWithSpawn => {
  const clientSpawnTime = existingClientSpawnTime ?? Date.now();
  const elapsed = (Date.now() - clientSpawnTime) / 1000;
  const origin = { col: p.originCol, row: p.originRow };
  const target = { col: p.targetCol, row: p.targetRow };
  const distance = calculateHexDistance(origin, target);
  const computedProgress =
    distance > 0 ? Math.min((elapsed * TD_PROJECTILE_SPEED) / distance, 1.0) : 1.0;

  const base = towerDefenseProjectileSchema.parse({
    id: `projectile-${p.id}`,
    abilityType: "shuriken",
    origin,
    target,
    progress: computedProgress,
    damage: p.damage,
    critRoll: p.critRoll,
  });

  return { ...base, clientSpawnTime };
};

/**
 * Convert SpacetimeDB session state to TowerDefenseState for compatibility
 */
const sessionStateToState = (
  state: SessionState,
  activeUpgrades: Record<string, number> = {},
): TowerDefenseState =>
  towerDefenseStateSchema.parse({
    playerHealth: state.playerHealth,
    playerPosition: { col: state.playerCol, row: state.playerRow },
    inRunCurrency: state.inRunCurrency,
    activeUpgrades,
    gridSize: state.gridSize,
  });

/**
 *
 * @param userId - The user's ID (undefined for guest mode)
 * @returns The game state
 */
export const useTowerDefense = (userId?: string) => {
  // Track if this is a guest session
  const isGuestRef = useRef(false);
  // State - only contains UI-relevant data (mode, score, wave, health)
  // Entities (enemies, projectiles) are in refs to avoid re-renders
  const [gameState, setGameState] = useState<TowerDefenseGameState>(initialGameState);

  // PERFORMANCE: Entity store lives outside React state
  // Animation loop reads directly from this - no re-renders on entity updates
  // COST OPTIMIZATION: Extended to include enemySpawns for static path data
  const entitiesRef = useRef<ExtendedEntityStore>(createEntityStore());

  // PERFORMANCE: Runtime state lives outside React state
  // All game data updates here immediately, React state syncs on throttle
  const runtimeStateRef = useRef<RuntimeState>(createRuntimeState());

  // PERFORMANCE: Track in-run upgrades in a ref to ensure they are available
  // even if session_upgrade events arrive before session_state events.
  // This also prevents upgrades from leaking between runs.
  const sessionUpgradesRef = useRef<Record<string, number>>({});

  // Ref for SpacetimeDB connection
  const connectionRef = useRef(getSpacetimeDBConnection());
  // Ref for the static session data
  const staticSessionRef = useRef<GameSession | null>(null);
  // Ref for session ID
  const sessionIdRef = useRef<bigint | null>(null);
  // Ref for completed run data for claim verification
  const completedRunRef = useRef<CompletedRun | null>(null);
  // Ref for tRPC utils
  const utils = api.useUtils();

  // Hit events refs (also don't need to trigger re-renders)
  const playerHitEventsRef = useRef<TowerDefenseGameState["playerHitEvents"]>([]);
  const enemyHitEventsRef = useRef<TowerDefenseGameState["enemyHitEvents"]>([]);

  // PERFORMANCE: Track mode in a ref to avoid calling setGameState just to read current state
  const currentModeRef = useRef<GameMode>("lobby");
  const currentExistingSessionRef =
    useRef<TowerDefenseGameState["existingSession"]>(null);
  const currentWaveInProgressRef = useRef(false);

  // Sync refs when state changes (ensures refs stay accurate)
  useEffect(() => {
    currentModeRef.current = gameState.mode;
    currentExistingSessionRef.current = gameState.existingSession;
    currentWaveInProgressRef.current = gameState.waveInProgress;
  }, [gameState.mode, gameState.existingSession, gameState.waveInProgress]);

  /**
   * Reset all game refs for a fresh session or when returning to lobby.
   * PERFORMANCE: This ensures no data leaks between runs.
   */
  const resetGameRefs = useCallback(() => {
    // Clear entities
    const store = entitiesRef.current;
    store.enemies.clear();
    store.projectiles.clear();
    store.enemySpawns.clear();
    store.enemiesArray = [];
    store.projectilesArray = [];
    store.enemiesVersion++;
    store.projectilesVersion++;

    // Reset runtime and session data
    runtimeStateRef.current = createRuntimeState();
    sessionUpgradesRef.current = {};
    staticSessionRef.current = null;
    sessionIdRef.current = null;
    completedRunRef.current = null;
    playerHitEventsRef.current = [];
    enemyHitEventsRef.current = [];
  }, []);

  /**
   * Update the module-level HUD store with current runtime state.
   * Called after runtimeStateRef is updated to sync HUD components.
   */
  const syncHudStore = useCallback(() => {
    const runtime = runtimeStateRef.current;
    const newValues = {
      score: runtime.score,
      currentWave: runtime.currentWave,
      waveInProgress: runtime.waveInProgress,
      maxHealth: runtime.maxHealth,
      enemyCount: runtime.enemyCount,
      playerHealth: runtime.state?.playerHealth ?? 0,
      abilities: runtime.abilities,
      activeUpgrades: sessionUpgradesRef.current,
      inRunCurrency: runtime.state?.inRunCurrency ?? 0,
    };
    hudStore.update(newValues);
  }, []);

  // Queries for upgrades - only fetch user upgrades if logged in
  const { data: upgradesData } = api.towerDefense.getUserUpgrades.useQuery(undefined, {
    enabled: !!userId && (gameState.mode === "lobby" || gameState.mode === "game-over"),
  });
  const { data: upgradeDefinitions } = api.towerDefense.getUpgrades.useQuery();

  // Query for asset configs (needed for both start and resume)
  const { data: assetConfigs } = api.towerDefense.getAssetConfigs.useQuery(undefined, {
    staleTime: Infinity, // These don't change often
  });

  // Register asset configs when data arrives
  useEffect(() => {
    if (assetConfigs) {
      clearEnemyAssetConfigCache();
      clearPlayerAssetConfigCache();
      if (assetConfigs.enemyAssetConfigs) {
        for (const {
          enemyType,
          assetConfig,
          scaleFactor,
        } of assetConfigs.enemyAssetConfigs) {
          registerEnemyAssetConfig(enemyType, assetConfig, scaleFactor);
        }
      }
      if (assetConfigs.playerAssetConfigs) {
        for (const { assetConfig, scaleFactor } of assetConfigs.playerAssetConfigs) {
          registerPlayerAssetConfig(assetConfig, scaleFactor);
        }
      }
    }
  }, [assetConfigs]);

  // Mutation for initiating secure session (logged in users)
  const initiateSessionMutation = api.towerDefense.initiateSecureSession.useMutation();
  // Mutation for initiating guest session (unauthenticated users)
  const initiateGuestSessionMutation =
    api.towerDefense.initiateGuestSession.useMutation();

  /**
   * Handle session update from SpacetimeDB (Static Data)
   */
  const handleSessionUpdate = useCallback(
    (session: GameSession) => {
      const sessionIdStr = session.id.toString();
      const isOurUserSession = userId && session.ninjarpgUserId === userId;
      const isGuestSession = !userId && session.ninjarpgUserId === "guest";
      const isOurSession = isOurUserSession || isGuestSession;

      if (isOurSession || sessionIdRef.current === session.id) {
        staticSessionRef.current = session;
      }

      // Lobby mode: check for existing sessions
      if (currentModeRef.current === "lobby" && sessionIdRef.current === null) {
        if (isOurUserSession) {
          // We don't have the volatile state yet, but we can show that a session exists
          // It will be fully updated when the session_state_update arrives
          setGameState((prev) => ({
            ...prev,
            seed: session.seed, // Set seed even in lobby, so it's ready for resume
            existingSession: prev.existingSession || {
              id: sessionIdStr,
              seed: session.seed,
              gridSize: session.initialGridSize,
              wave: 0,
              score: 0,
              health: 0,
              maxHealth: session.initialPlayerMaxHealth,
            },
          }));
        }
      }

      // If we are connecting/resuming, subscribe to session-specific data
      // PERFORMANCE: This filters entity updates to only our session
      if (currentModeRef.current === "connecting" && isOurSession) {
        // Set session ID ref immediately so we track this session
        sessionIdRef.current = session.id;
        // Subscribe to this session's entities (enemies, projectiles, upgrades)
        connectionRef.current.subscribeToSession(session.id);
        setGameState((prev) => ({
          ...prev,
          seed: session.seed,
        }));
      }

      // If we already have this session tracked, ensure seed is set
      if (sessionIdRef.current === session.id && isOurSession) {
        setGameState((prev) => ({
          ...prev,
          seed: session.seed,
        }));
      }
    },
    [userId],
  );

  /**
   * Handle session state update from SpacetimeDB (Volatile Data)
   * PERFORMANCE: Updates runtime ref immediately, React state only for mode changes
   */
  const handleSessionStateUpdate = useCallback(
    (state: SessionState) => {
      const sessionIdStr = state.sessionId.toString();
      const isActiveSession = state.status === "active";
      const isOurTrackedSession =
        sessionIdRef.current !== null && state.sessionId === sessionIdRef.current;

      const session = staticSessionRef.current;
      const currentMode = currentModeRef.current;
      const isResuming =
        currentMode === "connecting" && sessionIdRef.current === state.sessionId;

      if (!session || session.id !== state.sessionId) {
        // If we are already tracking this session, we can proceed even if static data hasn't arrived
        if (!isResuming && !isOurTrackedSession) {
          return;
        }
      }

      // Preserve existing session data for fallback when session is null
      const prevExistingSession = currentExistingSessionRef.current;

      // Build new runtime state from session state
      const newState = sessionStateToState(state, sessionUpgradesRef.current);

      const newAbilities = [
        towerDefenseAbilitySchema.parse({
          id: "shuriken",
          name: "Shuriken Throw",
          damage: state.abilityDamage,
          range: state.abilityRange,
          cooldownMs: state.abilityCooldownMs,
          critChance: state.abilityCritChance,
          damagePerTile: state.abilityDamagePerTile,
          lastUsedAt:
            state.abilityLastUsedAt > BigInt(0)
              ? Number(state.abilityLastUsedAt)
              : undefined,
        }),
      ];
      const newBonuses = playerBonusesSchema.parse({
        healthRegen: state.healthRegen,
        defensePercent: state.defensePercent,
        defenseFlat: state.defenseFlat,
        lifestealPercent: state.lifestealPercent,
        knockbackChance: state.knockbackChance,
        knockbackForce: state.knockbackForce,
        tokensPerWave: state.tokensPerWave,
        tokensPerKill: state.tokensPerKill,
        interestPerWave: state.interestPerWave,
        skipEnemyChance: state.skipEnemyChance,
      });

      // Check for player hit (needs to happen before updating runtime state)
      const playerJustHit =
        runtimeStateRef.current.state &&
        state.playerHealth < runtimeStateRef.current.state.playerHealth;

      if (playerJustHit) {
        // Add to ref for animation loop access (no React state update needed)
        playerHitEventsRef.current = [
          ...playerHitEventsRef.current,
          {
            id: `player-hit-${Date.now()}`,
            position: { col: state.playerCol, row: state.playerRow },
            timestamp: Date.now(),
          },
        ];
      }

      // Update runtime state ref IMMEDIATELY (no re-render)
      if (isOurTrackedSession || sessionIdRef.current === null) {
        runtimeStateRef.current = {
          score: state.score,
          currentWave: state.wave,
          waveInProgress: state.waveInProgress,
          waveStartTime: Number(state.waveStartTime),
          maxHealth: state.playerMaxHealth,
          state: newState,
          abilities: newAbilities,
          playerBonuses: newBonuses,
          enemyCount: runtimeStateRef.current.enemyCount, // Preserve current enemy count
        };
        // CRITICAL: Ensure waveInProgress ref is also updated immediately
        currentWaveInProgressRef.current = state.waveInProgress;
      }

      // PERFORMANCE: Use refs to read current state without triggering setGameState
      const currentExistingSession = currentExistingSessionRef.current;

      // Lobby mode: check for existing sessions
      if (currentMode === "lobby" && sessionIdRef.current === null) {
        if (
          isActiveSession &&
          userId &&
          (session?.ninjarpgUserId === userId || isResuming)
        ) {
          if (
            currentExistingSession?.id === sessionIdStr &&
            currentExistingSession?.wave === state.wave &&
            currentExistingSession?.score === state.score &&
            currentExistingSession?.health === state.playerHealth
          ) {
            return; // No change needed
          }
          const newExistingSession = {
            id: sessionIdStr,
            seed: session?.seed || prevExistingSession?.seed || "",
            gridSize: state.gridSize,
            wave: state.wave,
            score: state.score,
            health: state.playerHealth,
            maxHealth: state.playerMaxHealth,
          };
          currentExistingSessionRef.current = newExistingSession;
          setGameState((prev) => ({
            ...prev,
            existingSession: newExistingSession,
          }));
        }
        return;
      }

      // Tracked session: check for mode changes
      if (isOurTrackedSession || currentMode === "connecting") {
        sessionIdRef.current = state.sessionId;

        const isGameOver = state.status === "completed";

        // Calculate new mode
        let newMode: GameMode = currentMode;
        if (isGameOver) {
          newMode = "game-over";
        } else if (state.waveInProgress) {
          newMode = "playing";
        } else if (currentMode === "playing" || currentMode === "connecting") {
          // Wave is not in progress, and we were playing or connecting -> wave has ended
          newMode = "wave-end";
        }

        // PERFORMANCE: Only update React state if mode changed or critical update needed
        const modeChanged = newMode !== currentMode;
        const needsImmediateUpdate = modeChanged || isGameOver;

        if (needsImmediateUpdate) {
          // Full state sync for mode changes - update refs first
          currentModeRef.current = newMode;
          currentWaveInProgressRef.current = state.waveInProgress;
          currentExistingSessionRef.current = null;
          setGameState((prev) => ({
            ...prev,
            mode: newMode,
            runId: sessionIdStr,
            seed: prev.seed || session?.seed || prevExistingSession?.seed || null, // Ensure seed is preserved/updated
            currentWave: state.wave,
            score: state.score,
            state: newState,
            waveInProgress: state.waveInProgress,
            waveStartTime: Number(state.waveStartTime),
            maxHealth: state.playerMaxHealth,
            existingSession: null,
            abilities: newAbilities,
            playerBonuses: newBonuses,
          }));
          // ALSO sync HUD store for mode changes (so InRunUpgrades gets initial values)
          syncHudStore();
        } else {
          // For non-critical updates during gameplay, update HUD store
          syncHudStore();
        }
        return;
      }

      // Update existing session info
      if (currentExistingSession?.id === sessionIdStr) {
        if (!isActiveSession) {
          currentExistingSessionRef.current = null;
          setGameState((prev) => ({ ...prev, existingSession: null }));
        } else {
          const updatedExistingSession = {
            id: sessionIdStr,
            seed: session?.seed || prevExistingSession?.seed || "",
            gridSize: state.gridSize,
            wave: state.wave,
            score: state.score,
            health: state.playerHealth,
            maxHealth: state.playerMaxHealth,
          };
          currentExistingSessionRef.current = updatedExistingSession;
          setGameState((prev) => ({
            ...prev,
            existingSession: updatedExistingSession,
          }));
        }
      }
    },
    [userId, syncHudStore],
  );

  /**
   * Handle session upgrade from SpacetimeDB
   * PERFORMANCE: Updates runtime ref, schedules throttled UI update
   */
  const handleSessionUpgrade = useCallback(
    (upgrade: SessionUpgrade) => {
      // Only process upgrades for our active session
      if (sessionIdRef.current === null || upgrade.sessionId !== sessionIdRef.current) {
        return;
      }

      // Update the upgrades ref directly (independent of runtime state)
      sessionUpgradesRef.current = {
        ...sessionUpgradesRef.current,
        [upgrade.upgradeId]: upgrade.level,
      };

      // Also update runtime state if it exists (for compatibility)
      const runtime = runtimeStateRef.current;
      if (runtime.state) {
        runtimeStateRef.current = {
          ...runtime,
          state: {
            ...runtime.state,
            activeUpgrades: sessionUpgradesRef.current,
          },
        };
      }

      // Sync HUD store
      syncHudStore();
    },
    [syncHudStore],
  );

  /**
   * COST OPTIMIZATION: Store enemy spawn data (path, maxHealth)
   * This data is sent once per enemy and never updated, saving bandwidth
   */
  const insertEnemySpawn = useCallback((spawn: EnemySpawn) => {
    const store = entitiesRef.current;
    const id = `enemy-${spawn.enemyId}`;
    store.enemySpawns.set(id, spawn);
  }, []);

  const deleteEnemySpawn = useCallback((enemyId: bigint) => {
    const store = entitiesRef.current;
    const id = `enemy-${enemyId}`;
    store.enemySpawns.delete(id);
  }, []);

  /**
   * Update enemy in store directly (no React state, no re-renders).
   * PERFORMANCE CRITICAL: This is called for every SpacetimeDB entity event.
   * COST OPTIMIZATION: Uses separate spawn data for path/maxHealth
   */
  const updateEnemyInStore = useCallback((enemy: Enemy) => {
    const store = entitiesRef.current;
    const id = `enemy-${enemy.id}`;
    // Look up spawn data for path and maxHealth
    const spawnData = store.enemySpawns.get(id);
    store.enemies.set(id, convertEnemy(enemy, spawnData));
    store.enemiesArray = Array.from(store.enemies.values());
    store.enemiesVersion++;
    // Update runtime enemy count for throttled UI sync
    runtimeStateRef.current.enemyCount = store.enemies.size;
  }, []);

  const deleteEnemyFromStore = useCallback((enemyId: bigint) => {
    const store = entitiesRef.current;
    const id = `enemy-${enemyId}`;
    const deleted = store.enemies.get(id);
    if (deleted) {
      // Add hit event
      enemyHitEventsRef.current = [
        ...enemyHitEventsRef.current,
        {
          id: `hit-${id}-${Date.now()}`,
          position: deleted.position,
          timestamp: Date.now(),
        },
      ];
    }
    store.enemies.delete(id);
    // Also delete spawn data
    store.enemySpawns.delete(id);
    store.enemiesArray = Array.from(store.enemies.values());
    store.enemiesVersion++;
    // Update runtime enemy count for throttled UI sync
    runtimeStateRef.current.enemyCount = store.enemies.size;
  }, []);

  /**
   * COST OPTIMIZATION: Projectiles no longer receive update events from server
   * Progress is computed client-side from client spawn timestamp
   * We preserve the original client spawn time if the projectile already exists
   */
  const updateProjectileInStore = useCallback((projectile: Projectile) => {
    const store = entitiesRef.current;
    const id = `projectile-${projectile.id}`;
    // Preserve existing client spawn time if this projectile was already in the store
    const existing = store.projectiles.get(id) as
      | TowerDefenseProjectileWithSpawn
      | undefined;
    const existingClientSpawnTime = existing?.clientSpawnTime;
    store.projectiles.set(id, convertProjectile(projectile, existingClientSpawnTime));
    store.projectilesArray = Array.from(store.projectiles.values());
    store.projectilesVersion++;
  }, []);

  const deleteProjectileFromStore = useCallback((projectileId: bigint) => {
    const store = entitiesRef.current;
    const id = `projectile-${projectileId}`;
    store.projectiles.delete(id);
    store.projectilesArray = Array.from(store.projectiles.values());
    store.projectilesVersion++;
  }, []);

  const clearEntityStore = useCallback(() => {
    const store = entitiesRef.current;
    store.enemies.clear();
    store.projectiles.clear();
    store.enemySpawns.clear();
    store.enemiesArray = [];
    store.projectilesArray = [];
    store.enemiesVersion++;
    store.projectilesVersion++;
    playerHitEventsRef.current = [];
    enemyHitEventsRef.current = [];
    // Clear runtime enemy count
    runtimeStateRef.current.enemyCount = 0;
  }, []);

  /**
   * Handle SpacetimeDB events.
   * PERFORMANCE OPTIMIZATION: Entity updates go directly to refs - NO React re-renders.
   * Only session/UI updates trigger setGameState.
   */
  useEffect(() => {
    const connection = connectionRef.current;

    const handleEvent = (event: SpacetimeDBEvent) => {
      const endMark = profiler.mark(`stdb_event_${event.type}`);

      switch (event.type) {
        case "connection_state":
          if (event.state === "error") {
            setGameState((prev) => ({
              ...prev,
              mode: "lobby",
              error: "Connection to game server failed",
            }));
          }
          break;

        case "session_update":
          handleSessionUpdate(event.session);
          break;

        case "session_state_update":
          handleSessionStateUpdate(event.state);
          break;

        case "session_delete":
          setGameState((prev) => {
            if (prev.existingSession?.id === event.sessionId.toString()) {
              return { ...prev, existingSession: null };
            }
            return prev;
          });
          break;

        case "session_state_delete":
          // Handled by session_delete
          break;

        // COST OPTIMIZATION: Enemy spawn events for static path data (sent once)
        case "enemy_spawn_insert":
          insertEnemySpawn(event.spawn);
          break;

        case "enemy_spawn_delete":
          deleteEnemySpawn(event.enemyId);
          break;

        // PERFORMANCE: Entity events update refs directly - minimal React re-renders
        case "enemy_insert":
          updateEnemyInStore(event.enemy);
          syncHudStore(); // Enemy count changed
          break;

        case "enemy_update":
          updateEnemyInStore(event.enemy);
          // No syncHudStore - count unchanged, avoid re-render
          break;

        case "enemy_delete":
          deleteEnemyFromStore(event.enemyId);
          syncHudStore(); // Enemy count changed
          break;

        // COST OPTIMIZATION: Projectile progress computed client-side
        // No more projectile_update events - only insert/delete
        case "projectile_insert":
          updateProjectileInStore(event.projectile);
          break;

        case "projectile_delete":
          deleteProjectileFromStore(event.projectileId);
          break;

        case "completed_run":
          {
            const isOurSession =
              sessionIdRef.current !== null &&
              event.run.sessionId === sessionIdRef.current;
            if (isOurSession) {
              completedRunRef.current = event.run;
              setGameState((prev) => ({
                ...prev,
                mode: "game-over",
                finalPointsEarned: event.run.pointsEarned,
                existingSession: null,
              }));
            }
          }
          break;

        case "session_upgrade_insert":
        case "session_upgrade_update":
          handleSessionUpgrade(event.upgrade);
          break;

        case "session_upgrade_delete":
          // Session upgrades are deleted when session ends - cleanup handled by session delete
          break;

        case "error":
          setGameState((prev) => ({
            ...prev,
            error: event.message,
          }));
          break;
      }
      endMark();
    };

    const unsubscribe = connection.subscribe(handleEvent);
    return () => unsubscribe();
  }, [
    userId,
    handleSessionUpdate,
    handleSessionStateUpdate,
    handleSessionUpgrade,
    insertEnemySpawn,
    deleteEnemySpawn,
    updateEnemyInStore,
    deleteEnemyFromStore,
    updateProjectileInStore,
    deleteProjectileFromStore,
    syncHudStore,
  ]);

  /**
   * Start a new run
   *
   * SECURITY: This now uses a secure flow where stats are calculated server-side:
   * 1. Call tRPC initiateSecureSession (or initiateGuestSession for guests) to get server-calculated stats + signature
   * 2. Pass the signed params to SpacetimeDB
   * 3. This prevents clients from faking their upgrade stats
   */
  const startRun = useCallback(async () => {
    try {
      // CRITICAL: Update mode ref SYNCHRONOUSLY before any async operations
      // This ensures handleSessionUpdate recognizes we're "connecting" when
      // SpacetimeDB sends back the session_update event
      currentModeRef.current = "connecting";
      setGameState((prev) => ({ ...prev, mode: "connecting", error: null }));
      // PERFORMANCE: Reset all refs and HUD store for fresh run
      resetGameRefs();
      hudStore.reset();

      // Step 1: Get server-calculated stats with HMAC signature
      // Use guest session if no userId, otherwise use secure session with permanent upgrades
      const secureSession = userId
        ? await initiateSessionMutation.mutateAsync()
        : await initiateGuestSessionMutation.mutateAsync();

      // Track if this is a guest session
      isGuestRef.current = !userId;

      // Step 2: Connect to SpacetimeDB with userId for filtered subscriptions
      // PERFORMANCE: This ensures we only receive data for our user's sessions
      const connection = connectionRef.current;
      await connection.connect(userId);

      // Step 2b: For guests, subscribe to the specific session by seed BEFORE creating it
      // PERFORMANCE: This is much more efficient than subscribing to all guest sessions
      if (!userId) {
        connection.subscribeToGuestSession(secureSession.seed);
      }

      // Step 3: Create session on SpacetimeDB with signed parameters
      // The signature proves these values AND all definitions were calculated server-side
      await connection.createSession({
        ninjarpgUserId: userId ?? "guest",
        seed: secureSession.seed,
        nonce: secureSession.nonce,
        sessionSignature: secureSession.signature,
        // Definitions from MySQL, signed as part of the session signature
        upgradeDefinitionsJson: JSON.stringify(secureSession.upgradeDefinitions),
        enemyDefinitionsJson: JSON.stringify(secureSession.enemyDefinitions),
        abilityDamage: secureSession.params.abilityDamage,
        abilityRange: secureSession.params.abilityRange,
        abilityCooldownMs: secureSession.params.abilityCooldownMs,
        abilityCritChance: secureSession.params.abilityCritChance,
        abilityDamagePerTile: secureSession.params.abilityDamagePerTile,
        playerMaxHealth: secureSession.params.playerMaxHealth,
        healthRegen: secureSession.params.healthRegen,
        defensePercent: secureSession.params.defensePercent,
        defenseFlat: secureSession.params.defenseFlat,
        lifestealPercent: secureSession.params.lifestealPercent,
        knockbackChance: secureSession.params.knockbackChance,
        knockbackForce: secureSession.params.knockbackForce,
        tokensPerWave: secureSession.params.tokensPerWave,
        tokensPerKill: secureSession.params.tokensPerKill,
        interestPerWave: secureSession.params.interestPerWave,
        skipEnemyChance: secureSession.params.skipEnemyChance,
        scorePerKill: secureSession.params.scorePerKill,
        scoreToPointsRatio: secureSession.params.scoreToPointsRatio,
        initialGridSize: secureSession.params.initialGridSize,
        maxGridSize: secureSession.params.maxGridSize,
        gridExpandFreq: secureSession.params.gridExpandFreq,
        rangeVisualFactor: secureSession.params.rangeVisualFactor,
      });

      // The session_update event will trigger and update the game state to "playing"
      // Set initial local state while waiting for server response
      const center = Math.floor(secureSession.params.initialGridSize / 2);
      const initialState = {
        playerHealth: secureSession.params.playerMaxHealth,
        playerPosition: { col: center, row: center },
        inRunCurrency: 0,
        activeUpgrades: {},
        gridSize: secureSession.params.initialGridSize,
      };

      // PERFORMANCE: Update runtime ref IMMEDIATELY so ThreeJS sees it on mount
      runtimeStateRef.current = {
        ...runtimeStateRef.current,
        maxHealth: secureSession.params.playerMaxHealth,
        state: initialState,
        abilities: [secureSession.ability],
        playerBonuses: secureSession.playerBonuses,
      };

      setGameState((prev) => ({
        ...prev,
        seed: secureSession.seed,
        abilities: [secureSession.ability],
        playerBonuses: secureSession.playerBonuses,
        maxHealth: secureSession.params.playerMaxHealth,
        state: initialState,
      }));

      // PERFORMANCE: Sync HUD store so UI updates immediately
      syncHudStore();
    } catch (error) {
      setGameState((prev) => ({
        ...prev,
        mode: "lobby",
        error: error instanceof Error ? error.message : "Failed to start run",
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initiateSessionMutation, initiateGuestSessionMutation, userId, resetGameRefs]);

  /**
   * Resume an existing active session
   */
  const resumeRun = useCallback(async () => {
    const sessionToResume = gameState.existingSession;
    if (!sessionToResume) {
      return;
    }

    try {
      // CRITICAL: Update mode ref SYNCHRONOUSLY before any async operations
      currentModeRef.current = "connecting";
      setGameState((prev) => ({ ...prev, mode: "connecting", error: null }));

      // PERFORMANCE: Reset all refs and HUD store for resumed run
      resetGameRefs();
      hudStore.reset();

      const connection = connectionRef.current;
      await connection.connect(userId);

      // Set the session ID reference to the existing session
      const existingSessionId = BigInt(sessionToResume.id);
      sessionIdRef.current = existingSessionId;

      // PERFORMANCE: Subscribe to session-specific data (enemies, projectiles)
      connection.subscribeToSession(existingSessionId);

      // Transition to connecting mode and set initial state
      // The mode will be corrected to "playing" or "wave-end" when session_state arrives
      const center = Math.floor(sessionToResume.gridSize / 2);
      const initialState = {
        playerHealth: sessionToResume.health,
        playerPosition: { col: center, row: center },
        inRunCurrency: 0,
        activeUpgrades: {},
        gridSize: sessionToResume.gridSize,
      };

      // PERFORMANCE: Update runtime ref IMMEDIATELY so ThreeJS sees it on mount
      // We use current values from ref for abilities/bonuses since we don't have them in existingSession yet
      // They will be updated by the first session_state event.
      runtimeStateRef.current = {
        ...runtimeStateRef.current,
        currentWave: sessionToResume.wave,
        score: sessionToResume.score,
        maxHealth: sessionToResume.maxHealth,
        state: initialState,
      };

      setGameState((prev) => ({
        ...prev,
        mode: "connecting",
        runId: sessionToResume.id,
        seed: sessionToResume.seed,
        currentWave: sessionToResume.wave,
        score: sessionToResume.score,
        maxHealth: sessionToResume.maxHealth,
        state: initialState,
        existingSession: null,
      }));

      // PERFORMANCE: Sync HUD store so UI updates immediately
      syncHudStore();
    } catch (error) {
      setGameState((prev) => ({
        ...prev,
        mode: "lobby",
        error: error instanceof Error ? error.message : "Failed to resume run",
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState.existingSession, userId, resetGameRefs]);

  /**
   * Cancel an existing session without playing
   */
  const cancelExistingSession = useCallback(async () => {
    if (!gameState.existingSession) {
      return;
    }

    try {
      const connection = connectionRef.current;
      // PERFORMANCE: Pass userId for filtered subscriptions
      await connection.connect(userId);

      await connection.abandonSession(BigInt(gameState.existingSession.id));
      // NOTE: We don't disconnect immediately anymore.
      // The server will delete the session, which triggers a 'session_delete' event
      // that handles the UI cleanup and then we can disconnect in returnToLobby
      // if needed, or just let it stay for the next action.
      setGameState((prev) => ({
        ...prev,
        existingSession: null,
      }));
    } catch (error) {
      setGameState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : "Failed to cancel session",
      }));
    }
  }, [gameState.existingSession, userId]);

  /**
   * Check for existing sessions by connecting briefly
   */
  const checkForExistingSession = useCallback(async () => {
    // Guests don't have existing sessions to check
    if (!userId) return;

    try {
      const connection = connectionRef.current;
      // PERFORMANCE: Pass userId for filtered subscriptions
      await connection.connect(userId);

      // Check local cache for existing sessions
      const sessions = connection.getAllSessions();
      sessions.forEach((session) => {
        handleSessionUpdate(session);
      });

      // The subscription will also receive any new/updated sessions
      // Give it a moment to receive any existing session data from network if just connected
      await new Promise((resolve) =>
        setTimeout(resolve, TD_EXISTING_SESSION_CHECK_TIMEOUT_MS),
      );
    } catch (error) {
      // Silently fail - this is just a check
      console.log("[useTowerDefense] Failed to check for existing session:", error);
    }
  }, [handleSessionUpdate, userId]);

  /**
   * Start a new wave
   */
  const startWave = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (sessionId === null) {
      console.error("[useTowerDefense] No session ID to start wave");
      return;
    }

    try {
      // Clear entities from refs (no React state update needed for entities)
      clearEntityStore();
      setGameState((prev) => ({
        ...prev,
        waveStartTime: Date.now(),
      }));
      await connectionRef.current.startWave(sessionId);
    } catch (error) {
      setGameState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : "Failed to start wave",
      }));
    }
  }, [clearEntityStore]);

  /**
   * Throw shuriken at target
   */
  const throwShuriken = useCallback(async (target: HexPosition) => {
    const sessionId = sessionIdRef.current;
    if (sessionId === null) return;

    try {
      await connectionRef.current.throwShuriken(sessionId, target.col, target.row);
    } catch (error) {
      // Silently fail for cooldown errors - they're expected
      if (error instanceof Error && !error.message.includes("cooldown")) {
        setGameState((prev) => ({
          ...prev,
          error: error.message,
        }));
      }
    }
  }, []);

  /**
   * Purchase an in-run upgrade
   *
   * SECURITY: Only the upgradeId is sent. SpacetimeDB looks up all upgrade
   * parameters from hardcoded definitions to prevent cheating.
   */
  const purchaseInRunUpgrade = useCallback(async (upgradeId: string) => {
    const sessionId = sessionIdRef.current;
    if (sessionId === null) return;

    try {
      await connectionRef.current.purchaseUpgrade(sessionId, upgradeId);
    } catch (error) {
      setGameState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : "Failed to purchase upgrade",
      }));
    }
  }, []);

  /**
   * Abandon current run
   */
  const abandonRun = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (sessionId === null) return;

    try {
      await connectionRef.current.abandonSession(sessionId);
      // PERFORMANCE: Unsubscribe from session data before disconnecting
      connectionRef.current.unsubscribeFromSession();
      connectionRef.current.disconnect();

      // Reset all game data
      resetGameRefs();
      setGameState(initialGameState);

      if (userId) {
        void utils.towerDefense.getUserUpgrades.invalidate();
      }
    } catch (error) {
      setGameState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : "Failed to abandon run",
      }));
    }
  }, [utils, resetGameRefs, userId]);

  /**
   * Submit wave (auto-handled by SpacetimeDB, provided for interface compatibility)
   */
  const submitWave = useCallback(async () => {
    await startWave();
  }, [startWave]);

  // Mutation for claiming completed runs
  const claimRunMutation = api.towerDefense.claimCompletedRun.useMutation({
    onSuccess: () => {
      void utils.towerDefense.getUserUpgrades.invalidate();
    },
  });

  /**
   * Return to lobby
   *
   * SECURITY: When claiming, we pass all the data from SpacetimeDB's CompletedRun
   * The server verifies the session signature matches the claimed params + all definitions,
   * proving the game started with legitimate server-calculated stats and authentic data.
   *
   * NOTE: Guest sessions cannot claim points - they are skipped.
   */
  const returnToLobby = useCallback(async () => {
    // If we have a completed run with points, claim it first (only for logged-in users)
    const completedRun = completedRunRef.current;
    const session = staticSessionRef.current;
    const isGuest = isGuestRef.current;
    if (
      gameState.mode === "game-over" &&
      gameState.runId &&
      completedRun &&
      session &&
      !isGuest &&
      userId
    ) {
      try {
        // COST OPTIMIZATION: CompletedRun now stores definitions_hash instead of full JSON
        // We pass the original definitions from the session for signature verification
        await claimRunMutation.mutateAsync({
          spacetimeSessionId: gameState.runId,
          sessionSignature: completedRun.sessionSignature,
          nonce: completedRun.nonce,
          // Get definitions from original session (not from completedRun which has hash)
          upgradeDefinitionsJson: session.upgradeDefinitionsJson,
          enemyDefinitionsJson: session.enemyDefinitionsJson,
          // Original session params for signature verification
          abilityDamage: completedRun.abilityDamage,
          abilityRange: completedRun.abilityRange,
          abilityCooldownMs: completedRun.abilityCooldownMs,
          abilityCritChance: completedRun.abilityCritChance,
          abilityDamagePerTile: completedRun.abilityDamagePerTile,
          playerMaxHealth: completedRun.playerMaxHealth,
          healthRegen: completedRun.healthRegen,
          defensePercent: completedRun.defensePercent,
          defenseFlat: completedRun.defenseFlat,
          lifestealPercent: completedRun.lifestealPercent,
          knockbackChance: completedRun.knockbackChance,
          knockbackForce: completedRun.knockbackForce,
          tokensPerWave: completedRun.tokensPerWave,
          tokensPerKill: completedRun.tokensPerKill,
          interestPerWave: completedRun.interestPerWave,
          skipEnemyChance: completedRun.skipEnemyChance,
          scorePerKill: completedRun.scorePerKill,
          scoreToPointsRatio: completedRun.scoreToPointsRatio,
          initialGridSize: completedRun.initialGridSize,
          maxGridSize: completedRun.maxGridSize,
          gridExpandFreq: completedRun.gridExpandFreq,
          rangeVisualFactor: completedRun.rangeVisualFactor,
          // Run results
          finalWave: completedRun.finalWave,
          finalScore: completedRun.finalScore,
          pointsEarned: completedRun.pointsEarned,
        });

        // Step 2: Delete from SpacetimeDB to save storage costs
        if (sessionIdRef.current) {
          await connectionRef.current.deleteCompletedRun(sessionIdRef.current);
        }
      } catch (error) {
        console.error("[useTowerDefense] Failed to claim run:", error);
        // Continue to lobby even if claim fails
      }
    }

    // CLEANUP: For guests, delete the completed run and abandon the session
    // This prevents guest sessions from accumulating in SpacetimeDB
    if (isGuest && sessionIdRef.current) {
      try {
        await connectionRef.current.deleteCompletedRun(sessionIdRef.current);
        await connectionRef.current.abandonSession(sessionIdRef.current);
      } catch (error) {
        console.error("[useTowerDefense] Failed to cleanup guest session:", error);
        // Continue to lobby even if cleanup fails
      }
    }

    // PERFORMANCE: Unsubscribe from session data before disconnecting
    connectionRef.current.unsubscribeFromSession();
    connectionRef.current.disconnect();

    // Reset all game data
    resetGameRefs();
    isGuestRef.current = false;
    setGameState(initialGameState);

    if (userId) {
      void utils.towerDefense.getUserUpgrades.invalidate();
    }
  }, [gameState.mode, gameState.runId, claimRunMutation, utils, resetGameRefs, userId]);

  /**
   * Clear error
   */
  const clearError = useCallback(() => {
    setGameState((prev) => ({ ...prev, error: null }));
  }, []);

  /**
   * Update function - called by animation loop
   * With SpacetimeDB, game logic runs server-side, so this only handles
   * visual cleanup (hit events) - now in refs, no React re-renders.
   */
  const update = useCallback((_deltaTime: number) => {
    const now = Date.now();

    // Clean up old hit events from refs (no React state update)
    playerHitEventsRef.current = playerHitEventsRef.current.filter(
      (e) => now - e.timestamp < TD_HIT_EVENT_DURATION_MS,
    );
    enemyHitEventsRef.current = enemyHitEventsRef.current.filter(
      (e) => now - e.timestamp < TD_HIT_EVENT_DURATION_MS,
    );
  }, []);

  /**
   * Get current entities directly from refs.
   * PERFORMANCE: This doesn't trigger re-renders - animation loop can call this freely.
   * COST OPTIMIZATION: Projectile progress is recomputed each call based on clientSpawnTime
   */
  const getEntities = useCallback(() => {
    const store = entitiesRef.current;
    const now = Date.now();

    // COST OPTIMIZATION: Recompute projectile progress client-side
    // Server only sends spawn/delete events, progress computed locally from clientSpawnTime
    const projectilesWithProgress = store.projectilesArray.map((p) => {
      const proj = p as TowerDefenseProjectileWithSpawn;
      const elapsed = (now - proj.clientSpawnTime) / 1000;
      const distance = calculateHexDistance(p.origin, p.target);
      const progress =
        distance > 0 ? Math.min((elapsed * TD_PROJECTILE_SPEED) / distance, 1.0) : 1.0;
      return { ...p, progress };
    });

    return {
      enemies: store.enemiesArray,
      projectiles: projectilesWithProgress,
      playerHitEvents: playerHitEventsRef.current,
      enemyHitEvents: enemyHitEventsRef.current,
    };
  }, []);

  return {
    // State (UI-only for mode changes, NOT for HUD values)
    gameState,
    upgradesData,
    upgradeDefinitions,

    // NOTE: hudStore is now exported at module level - import { hudStore } from "@/hooks/useTowerDefense"

    // PERFORMANCE: Direct ref access for animation loop
    entitiesRef,
    runtimeStateRef, // Runtime state for animation loop (always current)
    playerHitEventsRef,
    getEntities,

    // Actions
    startRun,
    resumeRun,
    startWave,
    throwShuriken,
    update,
    submitWave,
    abandonRun,
    returnToLobby,
    clearError,
    purchaseInRunUpgrade,
    cancelExistingSession,
    checkForExistingSession,

    // Loading states
    isStarting: gameState.mode === "connecting",
    isSubmitting: gameState.isSubmitting,
    isAbandoning: false,

    // Guest mode flag
    isGuest: !userId,
  };
};
