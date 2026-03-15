/**
 * SpacetimeDB Client Connection Manager
 *
 * Uses the auto-generated bindings from SpacetimeDB to connect and manage
 * Tower Defense game sessions.
 *
 * COST OPTIMIZATIONS:
 * - EnemySpawn table separates static path data (sent once) from volatile enemy data
 * - Projectile progress computed client-side from spawned_at timestamp
 * - Enemy updates use threshold-based movement (25%, 50%, 75%, 100%)
 * - Tick rate increased to 150ms with client-side interpolation
 */

import type { Infer } from "spacetimedb/sdk";
import { DbConnection, type ErrorContext, type SubscriptionHandle } from "./bindings";
import type CompletedRunType from "./bindings/completed_run_type";
import type EnemyType from "./bindings/enemy_type";
import type GameSessionType from "./bindings/game_session_type";
import type ProjectileType from "./bindings/projectile_type";
import type SessionStateType from "./bindings/session_state_type";
import type SessionUpgradeType from "./bindings/session_upgrade_type";

// Re-export types from bindings for use in useTowerDefense hook
export type GameSession = Infer<typeof GameSessionType>;
export type SessionState = Infer<typeof SessionStateType>;
export type Enemy = Infer<typeof EnemyType>;
export type Projectile = Infer<typeof ProjectileType>;
export type CompletedRun = Infer<typeof CompletedRunType>;
export type SessionUpgrade = Infer<typeof SessionUpgradeType>;

// COST OPTIMIZATION: EnemySpawn contains static data sent once per enemy
// This type mirrors the Rust struct - will be auto-generated after binding regeneration
export interface EnemySpawn {
  enemyId: bigint;
  sessionId: bigint;
  spawnCol: number;
  spawnRow: number;
  maxHealth: number;
  path: Array<{ col: number; row: number }>;
}

export interface SpacetimeDBConfig {
  host: string;
  moduleName: string;
}

const DEBUG = false;

/**
 * Validate user ID to prevent SQL injection in SpacetimeDB queries.
 * Only allows alphanumerics, dashes, and underscores.
 * Returns the validated ID or null if invalid.
 */
const SAFE_USER_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function validateUserId(userId: string | undefined | null): string | null {
  if (!userId) return null;
  if (userId === "guest") return "guest";
  if (!SAFE_USER_ID_PATTERN.test(userId)) {
    console.warn(
      "[SpacetimeDB] Invalid user ID rejected - contains unsafe characters:",
      userId.substring(0, 20),
    );
    return null;
  }
  return userId;
}

// Environment-based config
export const getSpacetimeDBConfig = (): SpacetimeDBConfig => {
  const isProd = process.env.NODE_ENV === "production";

  // DEFAULT HOSTS:
  // - Local: ws://127.0.0.1:3001
  // - SaaS (Testnet/Maincloud): wss://maincloud.spacetimedb.com
  const defaultHost = isProd
    ? "wss://maincloud.spacetimedb.com"
    : "ws://127.0.0.1:3001";

  return {
    host: process.env.NEXT_PUBLIC_SPACETIMEDB_HOST ?? defaultHost,
    moduleName: process.env.NEXT_PUBLIC_SPACETIMEDB_MODULE ?? "towerdefense",
  };
};

/**
 * Connection state for the SpacetimeDB client
 */
export type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

/**
 * Event types for state subscriptions
 * COST OPTIMIZATION: Added enemy_spawn events for static path data
 */
export type SpacetimeDBEvent =
  | { type: "connection_state"; state: ConnectionState }
  | { type: "session_update"; session: GameSession }
  | { type: "session_delete"; sessionId: bigint }
  | { type: "session_state_update"; state: SessionState }
  | { type: "session_state_delete"; sessionId: bigint }
  | { type: "enemy_spawn_insert"; spawn: EnemySpawn }
  | { type: "enemy_spawn_delete"; enemyId: bigint }
  | { type: "enemy_insert"; enemy: Enemy }
  | { type: "enemy_update"; enemy: Enemy }
  | { type: "enemy_delete"; enemyId: bigint }
  | { type: "projectile_insert"; projectile: Projectile }
  | { type: "projectile_delete"; projectileId: bigint }
  | { type: "session_upgrade_insert"; upgrade: SessionUpgrade }
  | { type: "session_upgrade_update"; upgrade: SessionUpgrade }
  | { type: "session_upgrade_delete"; upgradeId: bigint }
  | { type: "completed_run"; run: CompletedRun }
  | { type: "error"; message: string };

export type SpacetimeDBEventHandler = (event: SpacetimeDBEvent) => void;

/**
 * SpacetimeDB Connection Class
 *
 * Manages the WebSocket connection to SpacetimeDB, subscriptions to game tables,
 * and reducer calls for game actions.
 */
export class SpacetimeDBConnection {
  private config: SpacetimeDBConfig;
  private connectionState: ConnectionState = "disconnected";
  private eventHandlers: Set<SpacetimeDBEventHandler> = new Set();
  private connection: DbConnection | null = null;
  private globalSubscription: SubscriptionHandle | null = null;
  private sessionSubscription: SubscriptionHandle | null = null;
  private identity: string | null = null;
  private currentSessionId: bigint | null = null;
  private currentUserId: string | null = null;
  // Track if the WebSocket is fully ready for sending (fixes InvalidStateError: Still in CONNECTING state)
  private wsReady = false;

  constructor(config: SpacetimeDBConfig) {
    this.config = config;
  }

  /**
   * Wait for connection to complete (or fail)
   * Used to avoid race conditions when multiple calls to connect() happen concurrently
   * Waits for both connectionState === "connected" AND wsReady === true,
   * ensuring subscriptions are fully applied before proceeding.
   */
  private waitForConnection(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const checkConnection = () => {
        if (this.connectionState === "connected" && this.wsReady) {
          resolve();
        } else if (
          this.connectionState === "error" ||
          this.connectionState === "disconnected"
        ) {
          reject(new Error("Connection failed"));
        } else {
          setTimeout(checkConnection, 100);
        }
      };
      setTimeout(checkConnection, 100);
    });
  }

  /**
   * Wait for WebSocket to be fully ready for sending messages.
   * The SpacetimeDB SDK's onConnect callback may fire before the underlying
   * WebSocket is in OPEN state, causing "Still in CONNECTING state" errors.
   */
  private async waitForWebSocketReady(): Promise<void> {
    const maxAttempts = 20;
    const delayMs = 50;

    for (let i = 0; i < maxAttempts; i++) {
      if (this.wsReady) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    throw new Error("WebSocket not ready after maximum wait time");
  }

  /**
   * Connect to SpacetimeDB
   * @param userId - The user's ID for filtered subscriptions (use "guest" for unauthenticated)
   */
  async connect(userId?: string): Promise<void> {
    // If already connected, just update subscriptions if needed
    if (this.connectionState === "connected") {
      if (userId && userId !== this.currentUserId) {
        const validatedId = validateUserId(userId);
        if (validatedId) {
          this.currentUserId = validatedId;
          this.setupGlobalSubscriptions();
        }
      }
      return;
    }

    // If already connecting, wait for it to complete instead of returning immediately
    // This fixes a race condition where startRun() could call createSession() before
    // the WebSocket was actually open (InvalidStateError)
    if (this.connectionState === "connecting") {
      await this.waitForConnection();
      // After connection completes, update subscriptions if needed
      if (userId && userId !== this.currentUserId) {
        const validatedId = validateUserId(userId);
        if (validatedId) {
          this.currentUserId = validatedId;
          this.setupGlobalSubscriptions();
        }
      }
      return;
    }

    this.currentUserId = validateUserId(userId) ?? "guest";
    this.connectionState = "connecting";
    this.emit({ type: "connection_state", state: "connecting" });

    try {
      const connection = DbConnection.builder()
        .withUri(this.config.host)
        .withModuleName(this.config.moduleName)
        .onConnect((_ctx, identity, _token) => {
          if (DEBUG) {
            console.log(
              "[SpacetimeDB] Connected with identity:",
              identity.toHexString(),
            );
          }
          this.identity = identity.toHexString();

          // Set up filtered subscriptions first to avoid race conditions
          // PERFORMANCE: Only subscribe to this user's data
          // Note: connectionState and wsReady will be set in setupGlobalSubscriptions's onApplied callback
          // This ensures callers cannot send reducers before subscriptions are established
          this.setupGlobalSubscriptions();
        })
        .onDisconnect((_ctx, error) => {
          if (DEBUG) {
            console.log("[SpacetimeDB] Disconnected", error);
          }
          this.connectionState = "disconnected";
          this.wsReady = false;
          this.emit({ type: "connection_state", state: "disconnected" });
        })
        .onConnectError((_ctx, error) => {
          console.error("[SpacetimeDB] Connection error:", error);
          this.connectionState = "error";
          this.emit({ type: "connection_state", state: "error" });
          this.emit({ type: "error", message: String(error) });
        })
        .build();

      this.connection = connection;

      // Wait for connection to complete
      await this.waitForConnection();
    } catch (error) {
      this.connectionState = "error";
      this.emit({ type: "connection_state", state: "error" });
      throw error;
    }
  }

  /**
   * Set up global subscriptions (user-level, not session-specific)
   * PERFORMANCE: Filtered subscriptions to only receive this user's data.
   *
   * For guests, we DON'T subscribe to all guest sessions here.
   * Instead, subscribeToGuestSession() is called with the specific seed
   * before creating a session. This is much more efficient.
   */
  private setupGlobalSubscriptions() {
    if (!this.connection || !this.currentUserId) return;

    // For guests, skip global subscription - they'll use subscribeToGuestSession() with specific seed
    if (this.currentUserId === "guest") {
      this.setupTableHandlers();
      // Mark WebSocket as ready immediately for guests (no subscription to wait for)
      this.connectionState = "connected";
      this.wsReady = true;
      this.emit({ type: "connection_state", state: "connected" });
      return;
    }

    // Only subscribe to this user's sessions and completed runs.
    // User ID is validated by SAFE_USER_ID_PATTERN to prevent SQL injection.
    const queries = [
      `SELECT * FROM game_session WHERE ninjarpg_user_id = '${this.currentUserId}'`,
      `SELECT * FROM session_state`,
      `SELECT * FROM completed_run WHERE ninjarpg_user_id = '${this.currentUserId}'`,
    ];

    this.globalSubscription = this.connection
      .subscriptionBuilder()
      .onApplied(() => {
        if (DEBUG) {
          console.log("[SpacetimeDB] Global subscription applied");
        }
        // Mark WebSocket and connection as ready AFTER subscriptions are applied
        // This ensures reducers won't fire before subscriptions are fully established
        this.connectionState = "connected";
        this.wsReady = true;
        this.emit({ type: "connection_state", state: "connected" });
      })
      .onError((ctx: ErrorContext) => {
        console.error("[SpacetimeDB] Global subscription error:", ctx);
        this.connectionState = "error";
        this.emit({ type: "connection_state", state: "error" });
        this.emit({ type: "error", message: "Global subscription error" });
      })
      .subscribe(queries);

    // Set up table event handlers
    this.setupTableHandlers();
  }

  /**
   * Subscribe to a specific guest session by seed.
   * PERFORMANCE: Much more efficient than subscribing to all guest sessions.
   * Call this BEFORE createSession() so we receive the session_update event.
   */
  subscribeToGuestSession(seed: string): void {
    if (!this.connection) return;

    // Unsubscribe from previous global subscription if any
    if (this.globalSubscription) {
      this.globalSubscription.unsubscribe();
      this.globalSubscription = null;
    }

    // Subscribe to the specific session by seed (unique per session)
    // This ensures we only receive events for OUR session, not all guests
    this.globalSubscription = this.connection
      .subscriptionBuilder()
      .onApplied(() => {
        if (DEBUG) {
          console.log(
            "[SpacetimeDB] Guest session subscription applied for seed:",
            seed,
          );
        }
      })
      .onError((ctx: ErrorContext) => {
        console.error("[SpacetimeDB] Guest session subscription error:", ctx);
        this.connectionState = "error";
        this.emit({ type: "connection_state", state: "error" });
        this.emit({ type: "error", message: "Guest session subscription error" });
      })
      .subscribe([
        `SELECT * FROM game_session WHERE seed = '${seed}'`,
        `SELECT * FROM session_state`,
      ]);
  }

  /**
   * Subscribe to session-specific data (enemies, projectiles, upgrades, enemy spawns)
   * PERFORMANCE: Only called after session is created/resumed
   * This is the key optimization - we only receive entity updates for OUR session
   */
  subscribeToSession(sessionId: bigint): void {
    if (!this.connection) return;

    // Unsubscribe from previous session if any
    if (this.sessionSubscription) {
      this.sessionSubscription.unsubscribe();
      this.sessionSubscription = null;
    }

    this.currentSessionId = sessionId;

    // COST OPTIMIZATION: Filter all entity tables by session_id
    // Including enemy_spawn for static path data
    this.sessionSubscription = this.connection
      .subscriptionBuilder()
      .onApplied(() => {
        if (DEBUG) {
          console.log(
            "[SpacetimeDB] Session subscription applied for:",
            sessionId.toString(),
          );
        }
      })
      .onError((ctx: ErrorContext) => {
        console.error("[SpacetimeDB] Session subscription error:", ctx);
        this.connectionState = "error";
        this.emit({ type: "connection_state", state: "error" });
        this.emit({ type: "error", message: "Session subscription error" });
      })
      .subscribe([
        `SELECT * FROM enemy WHERE session_id = ${sessionId}`,
        `SELECT * FROM enemy_spawn WHERE session_id = ${sessionId}`,
        `SELECT * FROM projectile WHERE session_id = ${sessionId}`,
        `SELECT * FROM session_upgrade WHERE session_id = ${sessionId}`,
        `SELECT * FROM session_state WHERE session_id = ${sessionId}`,
        `SELECT * FROM game_session WHERE id = ${sessionId}`,
      ]);
  }

  /**
   * Unsubscribe from session-specific data
   */
  unsubscribeFromSession(): void {
    if (this.sessionSubscription) {
      this.sessionSubscription.unsubscribe();
      this.sessionSubscription = null;
    }
    this.currentSessionId = null;
  }

  /**
   * Set up handlers for table row events
   */
  private setupTableHandlers() {
    if (!this.connection) return;

    const db = this.connection.db;

    // Game session events
    db.gameSession.onInsert((_ctx, row) => {
      if (DEBUG) {
        console.log("[SpacetimeDB] Session inserted:", row.id);
      }
      this.currentSessionId = row.id;
      this.emit({ type: "session_update", session: row as GameSession });
    });

    db.gameSession.onUpdate((_ctx, _oldRow, newRow) => {
      if (DEBUG) {
        console.log("[SpacetimeDB] Session updated:", newRow.id);
      }
      this.emit({ type: "session_update", session: newRow as GameSession });
    });

    db.gameSession.onDelete((_ctx, row) => {
      if (DEBUG) {
        console.log("[SpacetimeDB] Session deleted:", row.id);
      }
      if (this.currentSessionId === row.id) {
        this.currentSessionId = null;
      }
      this.emit({ type: "session_delete", sessionId: row.id });
    });

    // Session state events
    db.sessionState.onInsert((_ctx, row) => {
      this.emit({ type: "session_state_update", state: row as SessionState });
    });

    db.sessionState.onUpdate((_ctx, _oldRow, newRow) => {
      this.emit({ type: "session_state_update", state: newRow as SessionState });
    });

    db.sessionState.onDelete((_ctx, row) => {
      this.emit({ type: "session_state_delete", sessionId: row.sessionId });
    });

    // COST OPTIMIZATION: Enemy spawn events (static path data, sent once)
    // These are only insert/delete, never update
    if ("enemySpawn" in db) {
      const enemySpawnTable = db.enemySpawn as {
        onInsert: (cb: (ctx: unknown, row: EnemySpawn) => void) => void;
        onDelete: (cb: (ctx: unknown, row: EnemySpawn) => void) => void;
      };

      enemySpawnTable.onInsert((_ctx, row) => {
        if (DEBUG) {
          console.log("[SpacetimeDB] EnemySpawn inserted:", row.enemyId);
        }
        this.emit({ type: "enemy_spawn_insert", spawn: row });
      });

      enemySpawnTable.onDelete((_ctx, row) => {
        if (DEBUG) {
          console.log("[SpacetimeDB] EnemySpawn deleted:", row.enemyId);
        }
        this.emit({ type: "enemy_spawn_delete", enemyId: row.enemyId });
      });
    }

    // Enemy events (volatile data only, no path)
    db.enemy.onInsert((_ctx, row) => {
      this.emit({ type: "enemy_insert", enemy: row as Enemy });
    });

    db.enemy.onUpdate((_ctx, _oldRow, newRow) => {
      this.emit({ type: "enemy_update", enemy: newRow as Enemy });
    });

    db.enemy.onDelete((_ctx, row) => {
      this.emit({ type: "enemy_delete", enemyId: row.id });
    });

    // Projectile events
    // COST OPTIMIZATION: No more projectile_update events - progress computed client-side
    db.projectile.onInsert((_ctx, row) => {
      this.emit({ type: "projectile_insert", projectile: row as Projectile });
    });

    // Note: projectile_update removed - server no longer sends progress updates
    // Client computes progress from spawned_at timestamp

    db.projectile.onDelete((_ctx, row) => {
      this.emit({ type: "projectile_delete", projectileId: row.id });
    });

    // Completed run events
    db.completedRun.onInsert((_ctx, row) => {
      if (DEBUG) {
        console.log("[SpacetimeDB] Completed run:", row.id);
      }
      this.emit({ type: "completed_run", run: row as CompletedRun });
    });

    // Session upgrade events
    db.sessionUpgrade.onInsert((_ctx, row) => {
      if (DEBUG) {
        console.log("[SpacetimeDB] Session upgrade inserted:", row.upgradeId);
      }
      this.emit({ type: "session_upgrade_insert", upgrade: row as SessionUpgrade });
    });

    db.sessionUpgrade.onUpdate((_ctx, _oldRow, newRow) => {
      if (DEBUG) {
        console.log("[SpacetimeDB] Session upgrade updated:", newRow.upgradeId);
      }
      this.emit({ type: "session_upgrade_update", upgrade: newRow as SessionUpgrade });
    });

    db.sessionUpgrade.onDelete((_ctx, row) => {
      if (DEBUG) {
        console.log("[SpacetimeDB] Session upgrade deleted:", row.id);
      }
      this.emit({ type: "session_upgrade_delete", upgradeId: row.id });
    });
  }

  /**
   * Get all active sessions (from local cache)
   */
  getAllSessions(): GameSession[] {
    if (!this.connection) return [];
    return Array.from(this.connection.db.gameSession.iter()) as GameSession[];
  }

  /**
   * Disconnect from SpacetimeDB
   */
  disconnect(): void {
    if (this.sessionSubscription) {
      this.sessionSubscription.unsubscribe();
      this.sessionSubscription = null;
    }
    if (this.globalSubscription) {
      this.globalSubscription.unsubscribe();
      this.globalSubscription = null;
    }
    if (this.connection) {
      this.connection.disconnect();
      this.connection = null;
    }
    this.connectionState = "disconnected";
    this.wsReady = false;
    this.currentSessionId = null;
    this.currentUserId = null;
    this.emit({ type: "connection_state", state: "disconnected" });
    if (DEBUG) {
      console.log("[SpacetimeDB] Disconnected");
    }
  }

  /**
   * Get current connection state
   */
  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  /**
   * Get current identity
   */
  getIdentity(): string | null {
    return this.identity;
  }

  /**
   * Get current session ID
   */
  getCurrentSessionId(): bigint | null {
    return this.currentSessionId;
  }

  /**
   * Subscribe to state events
   */
  subscribe(handler: SpacetimeDBEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  /**
   * Emit an event to all subscribers
   */
  private emit(event: SpacetimeDBEvent): void {
    this.eventHandlers.forEach((handler) => {
      handler(event);
    });
  }

  // ============================================
  // Reducer Calls
  // ============================================

  /**
   * Create a new game session
   *
   * SECURITY: All parameters MUST come from the tRPC initiateSecureSession endpoint.
   * The signature proves these stats AND all definitions were calculated server-side.
   * Do NOT calculate these values client-side - that would allow cheating.
   *
   * The definitions JSON fields contain data from MySQL, signed as part of
   * the session signature to prevent tampering.
   */
  async createSession(params: {
    ninjarpgUserId: string;
    seed: string;
    nonce: string;
    sessionSignature: string;
    upgradeDefinitionsJson: string;
    enemyDefinitionsJson: string;
    abilityDamage: number;
    abilityRange: number;
    abilityCooldownMs: number;
    abilityCritChance: number;
    abilityDamagePerTile: number;
    playerMaxHealth: number;
    healthRegen: number;
    defensePercent: number;
    defenseFlat: number;
    lifestealPercent: number;
    knockbackChance: number;
    knockbackForce: number;
    tokensPerWave: number;
    tokensPerKill: number;
    interestPerWave: number;
    skipEnemyChance: number;
    scorePerKill: number;
    scoreToPointsRatio: number;
    initialGridSize: number;
    maxGridSize: number;
    gridExpandFreq: number;
    rangeVisualFactor: number;
  }): Promise<void> {
    if (!this.connection || this.connectionState !== "connected") {
      throw new Error("Not connected to SpacetimeDB");
    }

    // Wait for WebSocket to be fully ready before sending
    await this.waitForWebSocketReady();

    this.connection.reducers.createSession(params);
    if (DEBUG) {
      console.log("[SpacetimeDB] createSession called with signed definitions");
    }
  }

  /**
   * Start a new wave
   */
  async startWave(sessionId: bigint): Promise<void> {
    if (!this.connection || this.connectionState !== "connected") {
      throw new Error("Not connected to SpacetimeDB");
    }

    this.connection.reducers.startWave({ sessionId });
    if (DEBUG) {
      console.log("[SpacetimeDB] startWave called for session:", sessionId);
    }
  }

  /**
   * Throw shuriken at target
   */
  async throwShuriken(
    sessionId: bigint,
    targetCol: number,
    targetRow: number,
  ): Promise<void> {
    if (!this.connection || this.connectionState !== "connected") {
      throw new Error("Not connected to SpacetimeDB");
    }

    this.connection.reducers.throwShuriken({ sessionId, targetCol, targetRow });
  }

  /**
   * Purchase an in-run upgrade
   *
   * SECURITY: Only the upgradeId is passed. All upgrade parameters (cost, effect, limits)
   * are looked up server-side from hardcoded definitions to prevent cheating.
   */
  async purchaseUpgrade(sessionId: bigint, upgradeId: string): Promise<void> {
    if (!this.connection || this.connectionState !== "connected") {
      throw new Error("Not connected to SpacetimeDB");
    }

    this.connection.reducers.purchaseUpgrade({ sessionId, upgradeId });
    if (DEBUG) {
      console.log("[SpacetimeDB] purchaseUpgrade called:", upgradeId);
    }
  }

  /**
   * Delete a completed run record after claiming
   */
  async deleteCompletedRun(sessionId: bigint): Promise<void> {
    if (!this.connection || this.connectionState !== "connected") {
      throw new Error("Not connected to SpacetimeDB");
    }

    this.connection.reducers.deleteCompletedRun({ sessionId });
    if (DEBUG) {
      console.log("[SpacetimeDB] deleteCompletedRun called:", sessionId);
    }
  }

  /**
   * Abandon a session
   */
  async abandonSession(sessionId: bigint): Promise<void> {
    if (!this.connection || this.connectionState !== "connected") {
      throw new Error("Not connected to SpacetimeDB");
    }

    this.connection.reducers.abandonSession({ sessionId });
    if (DEBUG) {
      console.log("[SpacetimeDB] abandonSession called for session:", sessionId);
    }
  }
}

// Singleton connection instance
let connectionInstance: SpacetimeDBConnection | null = null;

/**
 * Get or create the SpacetimeDB connection
 */
export const getSpacetimeDBConnection = (): SpacetimeDBConnection => {
  if (!connectionInstance) {
    connectionInstance = new SpacetimeDBConnection(getSpacetimeDBConfig());
  }
  return connectionInstance;
};
