/**
 * React Hook for Tower Defense with SpacetimeDB
 *
 * This hook manages the tower defense game state using SpacetimeDB for
 * authoritative server-side game logic. All game state comes from SpacetimeDB
 * in real time; run stats are signed by the tRPC server at start and the
 * signature is verified when a completed run is claimed.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "@/app/_trpc/client";
import {
  TD_ABILITY_IDS,
  TD_EXISTING_SESSION_CHECK_TIMEOUT_MS,
  TD_HIT_EVENT_DURATION_MS,
  TD_PLAYER_BASE_HEALTH,
} from "@/drizzle/constants";
import {
  clearEnemyAssetConfigCache,
  clearPlayerAssetConfigCache,
  registerEnemyAssetConfig,
  registerPlayerAssetConfig,
} from "@/libs/rendering/towerDefenseCharacters";
import {
  type CompletedRun,
  type Enemy,
  type EnemySpawn,
  type GameSession,
  getSpacetimeDBConnection,
  type Projectile,
  type SessionState,
  type SessionUpgrade,
  type SpacetimeDBEvent,
} from "@/libs/spacetimedb/client";
import { showMutationToast } from "@/libs/toast";
import {
  getDefaultPlayerBonuses,
  getShurikenAbility,
} from "@/libs/towerDefense/abilities";
import { getProjectileProgress } from "@/libs/towerDefense/game";
import { sleep } from "@/utils/time";
import type {
  EntityStore,
  GameMode,
  HexPosition,
  HitEvent,
  HudValues,
  RuntimeState,
  TowerDefenseEnemy,
  TowerDefenseGameState,
  TowerDefenseProjectile,
  TowerDefenseState,
} from "@/validators/towerDefense";
import {
  playerBonusesSchema,
  towerDefenseAbilitySchema,
  towerDefenseEnemySchema,
  towerDefenseGameStateSchema,
  towerDefenseProjectileSchema,
  towerDefenseStateSchema,
} from "@/validators/towerDefense";

// ============================================================================
// MODULE-LEVEL HUD STORE
// ============================================================================
type HudStore = {
  subscribe: (listener: () => void) => () => void;
  getValues: () => HudValues;
  update: (newValues: Partial<HudValues>) => void;
  reset: () => void;
};

const INITIAL_HUD_VALUES: HudValues = {
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

const createHudStore = (): HudStore => {
  const listeners = new Set<() => void>();
  let values: HudValues = INITIAL_HUD_VALUES;

  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getValues: () => values,
    update: (newValues: Partial<HudValues>) => {
      values = { ...values, ...newValues };
      listeners.forEach((l) => {
        l();
      });
    },
    reset: () => {
      values = INITIAL_HUD_VALUES;
      listeners.forEach((l) => {
        l();
      });
    },
  };
};

const hudStore = createHudStore();

/**
 * Custom hook that subscribes to the HUD store using useSyncExternalStore.
 * PERFORMANCE: useSyncExternalStore is more efficient than useState/useEffect:
 * - Only triggers re-renders when getValues() returns a different value
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

/** UI state for the page's lobby, overlays and run metadata; HUD values live in hudStore. */
const initialGameState = towerDefenseGameStateSchema.parse({
  mode: "lobby",
  runId: null,
  seed: null,
  currentWave: 0,
  score: 0,
  state: null,
  waveInProgress: false,
  error: null,
  finalPointsEarned: null,
  existingSession: null,
});

// EntityStore also holds enemy spawn data (static path, maxHealth).
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
  const origin = { col: p.originCol, row: p.originRow };
  const target = { col: p.targetCol, row: p.targetRow };

  const base = towerDefenseProjectileSchema.parse({
    id: `projectile-${p.id}`,
    abilityType: TD_ABILITY_IDS.SHURIKEN,
    origin,
    target,
    progress: getProjectileProgress(origin, target, clientSpawnTime, Date.now()),
    damage: p.damage,
    critRoll: p.critRoll,
  });

  return { ...base, clientSpawnTime };
};

/**
 * Convert SpacetimeDB session state to the TowerDefenseState render shape
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
  const [isReturningToLobby, setIsReturningToLobby] = useState(false);
  // React state alone cannot prevent two clicks in the same render frame.
  const returnToLobbyInFlightRef = useRef(false);

  // PERFORMANCE: Entity store lives outside React state
  // Animation loop reads directly from this - no re-renders on entity updates
  const entitiesRef = useRef<ExtendedEntityStore>(createEntityStore());

  // PERFORMANCE: Runtime state lives outside React state. Game data updates here
  // immediately and syncHudStore pushes it to the HUD store synchronously.
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
  const playerHitEventsRef = useRef<HitEvent[]>([]);

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
    clearEntities(entitiesRef.current);

    // Reset runtime and session data
    runtimeStateRef.current = createRuntimeState();
    sessionUpgradesRef.current = {};
    staticSessionRef.current = null;
    sessionIdRef.current = null;
    completedRunRef.current = null;
    playerHitEventsRef.current = [];
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

      // Lobby mode: check for existing sessions. Only the connection identity that
      // created a session may act on it, so sessions from other browsers are not offered.
      if (currentModeRef.current === "lobby" && sessionIdRef.current === null) {
        if (
          isOurUserSession &&
          session.spacetimedbIdentity === connectionRef.current.getIdentity()
        ) {
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
          ...getShurikenAbility(),
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
          ((session?.ninjarpgUserId === userId &&
            session.spacetimedbIdentity === connectionRef.current.getIdentity()) ||
            isResuming)
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
            existingSession: null,
          }));
        }
        // Mode changes also need it, so InRunUpgrades gets initial values
        syncHudStore();
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
   * PERFORMANCE: Updates runtime ref and syncs the HUD store
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

      // Keep runtime state's activeUpgrades in sync
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
    // The live enemy count lives in runtime state and the HUD store
    runtimeStateRef.current.enemyCount = store.enemies.size;
  }, []);

  const deleteEnemyFromStore = useCallback((enemyId: bigint) => {
    const store = entitiesRef.current;
    const id = `enemy-${enemyId}`;
    store.enemies.delete(id);
    // Also delete spawn data
    store.enemySpawns.delete(id);
    store.enemiesArray = Array.from(store.enemies.values());
    store.enemiesVersion++;
    runtimeStateRef.current.enemyCount = store.enemies.size;
  }, []);

  /**
   * COST OPTIMIZATION: Projectiles only receive insert/delete events from the server;
   * progress is computed client-side from the client spawn timestamp
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
    clearEntities(entitiesRef.current);
    playerHitEventsRef.current = [];
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
   * SECURITY: Stats are calculated server-side:
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
        ...secureSession.params,
      });

      // The session_update event will trigger and update the game state to "playing"
      // Set initial local state while waiting for server response
      const initialState = initialPlayerState(
        secureSession.params.initialGridSize,
        secureSession.params.playerMaxHealth,
      );

      // PERFORMANCE: Update runtime ref IMMEDIATELY so the renderer sees it on mount
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

      // Transition to connecting mode and set initial state
      // The mode will be corrected to "playing" or "wave-end" when session_state arrives
      const initialState = initialPlayerState(
        sessionToResume.gridSize,
        sessionToResume.health,
      );

      // PERFORMANCE: Update runtime ref IMMEDIATELY so the renderer sees it on mount
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
        state: initialState,
        existingSession: null,
      }));

      // A reused connection can publish its cached snapshot while connecting.
      // Prepare fallback state first so it cannot overwrite authoritative abilities or mode.
      const connection = connectionRef.current;
      await connection.connect(userId);

      // Set the session ID reference to the existing session
      const existingSessionId = BigInt(sessionToResume.id);
      sessionIdRef.current = existingSessionId;

      // PERFORMANCE: Subscribe to session-specific data (enemies, projectiles)
      connection.subscribeToSession(existingSessionId, { replayCached: true });

      // PERFORMANCE: Sync HUD store so UI updates immediately
      syncHudStore();
    } catch (error) {
      setGameState((prev) => ({
        ...prev,
        mode: "lobby",
        error: error instanceof Error ? error.message : "Failed to resume run",
      }));
    }
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
      // Stay connected: the server deletes the session and emits session_delete,
      // which handles UI cleanup; returnToLobby disconnects if needed, otherwise
      // the connection stays open for the next action.
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
      await sleep(TD_EXISTING_SESSION_CHECK_TIMEOUT_MS);
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

  // Mutation for claiming completed runs
  const claimRunMutation = api.towerDefense.claimCompletedRun.useMutation();

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
    if (returnToLobbyInFlightRef.current) return;
    returnToLobbyInFlightRef.current = true;
    setIsReturningToLobby(true);

    // Authenticated completed runs are recorded before leaving the result screen.
    const completedRun = completedRunRef.current;
    const session = staticSessionRef.current;
    const isGuest = isGuestRef.current;
    const runId = gameState.runId;
    const isAuthenticatedCompletedRun =
      gameState.mode === "game-over" && !isGuest && !!userId;

    if (isAuthenticatedCompletedRun && (!runId || !completedRun || !session)) {
      setGameState((prev) => ({
        ...prev,
        error: "The completed run is still loading. Please try again.",
      }));
      returnToLobbyInFlightRef.current = false;
      setIsReturningToLobby(false);
      return;
    }

    const shouldClaimRun =
      isAuthenticatedCompletedRun && runId && completedRun && session;

    setGameState((prev) => ({ ...prev, error: null }));

    if (shouldClaimRun) {
      try {
        // The server reads the result from SpacetimeDB; the definitions are not stored in
        // completed_run, so the ones this session was created with are sent for the
        // signature check.
        const claimResult = await claimRunMutation.mutateAsync({
          spacetimeSessionId: runId,
          upgradeDefinitionsJson: session.upgradeDefinitionsJson,
          enemyDefinitionsJson: session.enemyDefinitionsJson,
        });

        if (claimResult.claimsPaused) {
          // Retrying cannot succeed while claims are paused, so the player is told and
          // returned to the lobby instead of being held on the result screen.
          showMutationToast({ success: false, message: claimResult.message });
        } else if (!claimResult.success) {
          throw new Error(claimResult.message);
        }
      } catch (error) {
        console.error("[useTowerDefense] Failed to claim run:", error);
        setGameState((prev) => ({
          ...prev,
          error: `Unable to claim this run: ${
            error instanceof Error ? error.message : "Unknown error"
          }. Your result is safe—please try again.`,
        }));
        returnToLobbyInFlightRef.current = false;
        setIsReturningToLobby(false);
        return;
      }

      // The claim was recorded (or claims are paused). SpacetimeDB cleanup is
      // best-effort from here: failing it must never invite a duplicate claim.
      if (sessionIdRef.current) {
        try {
          await connectionRef.current.deleteCompletedRun(sessionIdRef.current);
        } catch (error) {
          console.error("[useTowerDefense] Failed to delete completed run:", error);
        }
      }
    }

    // CLEANUP: For guests, delete the session along with its completed run
    // This prevents guest sessions from accumulating in SpacetimeDB
    if (isGuest && sessionIdRef.current) {
      try {
        await connectionRef.current.deleteCompletedRun(sessionIdRef.current);
      } catch (error) {
        console.error("[useTowerDefense] Failed to cleanup guest session:", error);
        // Continue to lobby even if cleanup fails
      }
    }

    // PERFORMANCE: Unsubscribe from session data before disconnecting
    try {
      connectionRef.current.unsubscribeFromSession();
      connectionRef.current.disconnect();
    } catch (error) {
      console.error("[useTowerDefense] Failed to disconnect cleanly:", error);
    }

    // Reset all game data
    resetGameRefs();
    isGuestRef.current = false;
    setGameState(initialGameState);

    if (userId) {
      void utils.towerDefense.getUserUpgrades.invalidate();
    }
    returnToLobbyInFlightRef.current = false;
    setIsReturningToLobby(false);
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
   * visual cleanup of hit events held in refs, without React re-renders.
   */
  const update = useCallback((_deltaTime: number) => {
    const now = Date.now();

    // Clean up old hit events from refs (no React state update)
    playerHitEventsRef.current = playerHitEventsRef.current.filter(
      (e) => now - e.timestamp < TD_HIT_EVENT_DURATION_MS,
    );
  }, []);

  return {
    // State (UI-only for mode changes, NOT for HUD values)
    gameState,
    upgradesData,
    upgradeDefinitions,

    // PERFORMANCE: Direct ref access for animation loop
    entitiesRef,
    runtimeStateRef, // Runtime state for animation loop (always current)
    playerHitEventsRef,

    // Actions
    startRun,
    resumeRun,
    startWave,
    throwShuriken,
    update,
    abandonRun,
    returnToLobby,
    clearError,
    purchaseInRunUpgrade,
    cancelExistingSession,
    checkForExistingSession,

    // Loading states
    isStarting: gameState.mode === "connecting",
    isReturningToLobby,
    isClaimingRewards:
      isReturningToLobby &&
      !isGuestRef.current &&
      (completedRunRef.current?.pointsEarned ?? 0) > 0,

    // Guest mode flag
    isGuest: !userId,
  };
};

/** Empty the entity store and bump its versions so the renderer drops the old entities. */
const clearEntities = (store: ExtendedEntityStore) => {
  store.enemies.clear();
  store.projectiles.clear();
  store.enemySpawns.clear();
  store.enemiesArray = [];
  store.projectilesArray = [];
  store.enemiesVersion++;
  store.projectilesVersion++;
};

/** Local player state shown until the session's first state update: centred, no upgrades. */
const initialPlayerState = (gridSize: number, playerHealth: number) => {
  const center = Math.floor(gridSize / 2);
  return {
    playerHealth,
    playerPosition: { col: center, row: center },
    inRunCurrency: 0,
    activeUpgrades: {},
    gridSize,
  };
};
