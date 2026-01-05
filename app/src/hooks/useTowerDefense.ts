/**
 * React Hook for Tower Defense with SpacetimeDB
 *
 * This hook manages the tower defense game state using SpacetimeDB for
 * authoritative server-side game logic. All game state comes from SpacetimeDB
 * in real-time - no client-side simulation or server validation needed.
 */

import { useState, useCallback, useEffect, useRef, useSyncExternalStore } from "react";

// ============================================================================
// MODULE-LEVEL HUD STORE (Global Singleton)
// Uses global/window storage to survive Hot Module Replacement
// ============================================================================
type HudValues = {
  score: number;
  currentWave: number;
  waveInProgress: boolean;
  maxHealth: number;
  enemyCount: number;
  playerHealth: number;
  abilities: Array<{
    id: string;
    name: string;
    damage: number;
    range: number;
    cooldownMs: number;
    critChance?: number;
    damagePerTile?: number;
    lastUsedAt?: number;
  }>;
  activeUpgrades: Record<string, number>;
  inRunCurrency: number;
};

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
} from "@/libs/spacetimedb/client";
import { getDefaultPlayerBonuses } from "@/libs/towerDefense/abilities";
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
} from "@/validators/towerDefense";
import {
  TD_EXISTING_SESSION_CHECK_TIMEOUT_MS,
  TD_HIT_EVENT_DURATION_MS,
  TD_PLAYER_BASE_HEALTH,
} from "@/drizzle/constants";

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

const createEntityStore = (): EntityStore => ({
  enemies: new Map(),
  projectiles: new Map(),
  enemiesArray: [],
  projectilesArray: [],
  enemiesVersion: 0,
  projectilesVersion: 0,
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
 */
const convertEnemy = (e: Enemy): TowerDefenseEnemy => {
  return towerDefenseEnemySchema.parse({
    id: `enemy-${e.id}`,
    aiUserId: "",
    enemyType: e.enemyType as "standard" | "heavy",
    position: { col: e.col, row: e.row },
    path: e.path.map((p) => ({ col: p.col, row: p.row })),
    pathIndex: e.pathIndex,
    health: e.health,
    maxHealth: e.maxHealth,
    speed: e.speed,
    damage: e.damage,
    attackCooldown: e.attackCooldown,
    lastAttackTime: e.lastAttackTime > BigInt(0) ? Number(e.lastAttackTime) : undefined,
    movementProgress: e.movementProgress,
    direction: e.direction as TowerDefenseEnemy["direction"],
  });
};

/**
 * Convert SpacetimeDB Projectile to TowerDefenseProjectile format for rendering
 */
const convertProjectile = (p: Projectile): TowerDefenseProjectile =>
  towerDefenseProjectileSchema.parse({
    id: `projectile-${p.id}`,
    abilityType: "shuriken",
    origin: { col: p.originCol, row: p.originRow },
    target: { col: p.targetCol, row: p.targetRow },
    progress: p.progress,
    damage: p.damage,
    critRoll: p.critRoll,
  });

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
  const entitiesRef = useRef<EntityStore>(createEntityStore());

  // PERFORMANCE: Runtime state lives outside React state
  // All game data updates here immediately, React state syncs on throttle
  const runtimeStateRef = useRef<RuntimeState>(createRuntimeState());

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
      activeUpgrades: runtime.state?.activeUpgrades ?? {},
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
      if (!session || session.id !== state.sessionId) {
        // We need the static session info to process the state
        return;
      }

      // Build new runtime state from session state
      const newState = sessionStateToState(
        state,
        runtimeStateRef.current.state?.activeUpgrades ?? {},
      );

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
        tokens_per_kill: state.tokensPerKill,
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
      }

      // PERFORMANCE: Use refs to read current state without triggering setGameState
      const currentMode = currentModeRef.current;
      const currentExistingSession = currentExistingSessionRef.current;
      const currentWaveInProgress = currentWaveInProgressRef.current;

      // Lobby mode: check for existing sessions
      if (currentMode === "lobby" && sessionIdRef.current === null) {
        if (isActiveSession && userId && session.ninjarpgUserId === userId) {
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
        const waveJustEnded = currentWaveInProgress && !state.waveInProgress;
        const isNewSession = currentMode === "connecting" && state.status === "active";

        // Calculate new mode
        let newMode: GameMode = currentMode;
        if (isGameOver) {
          newMode = "game-over";
        } else if (state.waveInProgress) {
          newMode = "playing";
        } else if (waveJustEnded) {
          newMode = "wave-end";
        } else if (isNewSession) {
          newMode = "wave-end";
        }

        // PERFORMANCE: Only update React state if mode changed or critical update needed
        const modeChanged = newMode !== currentMode;
        const needsImmediateUpdate = modeChanged || isNewSession || isGameOver;

        if (needsImmediateUpdate) {
          // Full state sync for mode changes - update refs first
          currentModeRef.current = newMode;
          currentWaveInProgressRef.current = state.waveInProgress;
          currentExistingSessionRef.current = null;
          setGameState((prev) => ({
            ...prev,
            mode: newMode,
            runId: sessionIdStr,
            seed: prev.seed || session.seed, // Ensure seed is preserved/updated
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

      // Update runtime state ref immediately (no re-render)
      const runtime = runtimeStateRef.current;
      if (runtime.state) {
        runtimeStateRef.current = {
          ...runtime,
          state: {
            ...runtime.state,
            activeUpgrades: {
              ...runtime.state.activeUpgrades,
              [upgrade.upgradeId]: upgrade.level,
            },
          },
        };
      }

      // Sync HUD store
      syncHudStore();
    },
    [syncHudStore],
  );

  /**
   * Update enemy in store directly (no React state, no re-renders).
   * PERFORMANCE CRITICAL: This is called for every SpacetimeDB entity event.
   */
  const updateEnemyInStore = useCallback((enemy: Enemy) => {
    const store = entitiesRef.current;
    const id = `enemy-${enemy.id}`;
    store.enemies.set(id, convertEnemy(enemy));
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
    store.enemiesArray = Array.from(store.enemies.values());
    store.enemiesVersion++;
    // Update runtime enemy count for throttled UI sync
    runtimeStateRef.current.enemyCount = store.enemies.size;
  }, []);

  const updateProjectileInStore = useCallback((projectile: Projectile) => {
    const store = entitiesRef.current;
    const id = `projectile-${projectile.id}`;
    store.projectiles.set(id, convertProjectile(projectile));
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

        case "projectile_insert":
          updateProjectileInStore(event.projectile);
          break;

        case "projectile_update":
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
      // Reset HUD store for fresh run
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
      setGameState((prev) => ({
        ...prev,
        seed: secureSession.seed,
        abilities: [secureSession.ability],
        playerBonuses: secureSession.playerBonuses,
        maxHealth: secureSession.params.playerMaxHealth,
        state: {
          playerHealth: secureSession.params.playerMaxHealth,
          playerPosition: { col: 2, row: 2 },
          inRunCurrency: 0,
          activeUpgrades: {},
          gridSize: 5,
        },
      }));
    } catch (error) {
      setGameState((prev) => ({
        ...prev,
        mode: "lobby",
        error: error instanceof Error ? error.message : "Failed to start run",
      }));
    }
  }, [initiateSessionMutation, initiateGuestSessionMutation, userId]);

  /**
   * Resume an existing active session
   */
  const resumeRun = useCallback(async () => {
    if (!gameState.existingSession) {
      return;
    }

    try {
      // CRITICAL: Update mode ref SYNCHRONOUSLY before any async operations
      currentModeRef.current = "connecting";
      setGameState((prev) => ({ ...prev, mode: "connecting", error: null }));
      // Reset HUD store for resumed run
      hudStore.reset();

      const connection = connectionRef.current;
      await connection.connect(userId);

      // Set the session ID reference to the existing session
      const existingSessionId = BigInt(gameState.existingSession.id);
      sessionIdRef.current = existingSessionId;

      // PERFORMANCE: Subscribe to session-specific data (enemies, projectiles)
      connection.subscribeToSession(existingSessionId);

      // Get existing session data if we have it in ref
      const existingStatic = staticSessionRef.current;
      const seed =
        existingStatic?.id === existingSessionId ? existingStatic.seed : null;

      // Transition to wave-end mode so the user can start the next wave
      // The session data will be updated from SpacetimeDB events
      setGameState((prev) => ({
        ...prev,
        mode: "wave-end",
        runId: prev.existingSession?.id ?? null,
        seed: seed,
        currentWave: prev.existingSession?.wave ?? 0,
        score: prev.existingSession?.score ?? 0,
        maxHealth: prev.existingSession?.maxHealth ?? TD_PLAYER_BASE_HEALTH,
        state: {
          playerHealth: prev.existingSession?.health ?? TD_PLAYER_BASE_HEALTH,
          playerPosition: { col: 2, row: 2 }, // Will be updated by server
          inRunCurrency: 0,
          activeUpgrades: {},
          gridSize: 5,
        },
        existingSession: null,
      }));
    } catch (error) {
      setGameState((prev) => ({
        ...prev,
        mode: "lobby",
        error: error instanceof Error ? error.message : "Failed to resume run",
      }));
    }
  }, [gameState.existingSession, userId]);

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
      sessionIdRef.current = null;
      clearEntityStore();
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
  }, [utils, clearEntityStore, userId]);

  /**
   * Submit wave (auto-handled by SpacetimeDB, provided for interface compatibility)
   */
  const submitWave = useCallback(async () => {
    // Wave completion is automatic with SpacetimeDB
    // Just start the next wave
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
    const isGuest = isGuestRef.current;
    if (
      gameState.mode === "game-over" &&
      gameState.runId &&
      completedRun &&
      !isGuest &&
      userId
    ) {
      try {
        // Pass all data from SpacetimeDB for signature verification
        await claimRunMutation.mutateAsync({
          spacetimeSessionId: gameState.runId,
          sessionSignature: completedRun.sessionSignature,
          nonce: completedRun.nonce,
          // Definitions for signature verification
          upgradeDefinitionsJson: completedRun.upgradeDefinitionsJson,
          enemyDefinitionsJson: completedRun.enemyDefinitionsJson,
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

    // PERFORMANCE: Unsubscribe from session data before disconnecting
    connectionRef.current.unsubscribeFromSession();
    connectionRef.current.disconnect();
    sessionIdRef.current = null;
    completedRunRef.current = null;
    isGuestRef.current = false;
    clearEntityStore();
    setGameState(initialGameState);
    if (userId) {
      void utils.towerDefense.getUserUpgrades.invalidate();
    }
  }, [
    gameState.mode,
    gameState.runId,
    claimRunMutation,
    utils,
    clearEntityStore,
    userId,
  ]);

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
   */
  const getEntities = useCallback(() => {
    const store = entitiesRef.current;
    return {
      enemies: store.enemiesArray,
      projectiles: store.projectilesArray,
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
