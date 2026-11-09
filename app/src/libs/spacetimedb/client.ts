/**
 * SpacetimeDB Client Connection Manager
 *
 * Uses the auto-generated bindings from SpacetimeDB to connect and manage
 * Tower Defense game sessions.
 *
 * Data layout:
 * - EnemySpawn carries each enemy's static path data once; Enemy rows carry the volatile state
 * - Projectiles have only insert/delete events; the client computes their progress
 * - The server advances the game every GAME_TICK_MS (app/spacetimedb/src/lib.rs)
 */

import { DbConnection, type ErrorContext, type SubscriptionHandle } from "./bindings";
import type {
  CompletedRun,
  Enemy,
  EnemySpawn,
  GameSession,
  Projectile,
  SessionState,
  SessionUpgrade,
} from "./bindings/types";
import type { CreateSessionParams } from "./bindings/types/reducers";
import { getSpacetimeDBConfig, type SpacetimeDBConfig } from "./config";

export type {
  CompletedRun,
  Enemy,
  EnemySpawn,
  GameSession,
  Projectile,
  SessionState,
  SessionUpgrade,
} from "./bindings/types";

/**
 * The module only lets the identity that created a session act on it, so the identity
 * must survive page reloads for a run to be resumed or claimed after one. SpacetimeDB
 * issues the token on first connect; it is kept per browser. Storage can be unavailable
 * (private windows, blocked site data); the connection then uses a fresh identity.
 */
const tokenStorageKey = (config: SpacetimeDBConfig) =>
  `tnr:spacetimedb-token:${config.host}:${config.moduleName}`;

function readStoredToken(config: SpacetimeDBConfig): string | undefined {
  try {
    return window.localStorage.getItem(tokenStorageKey(config)) ?? undefined;
  } catch {
    return undefined;
  }
}

function clearStoredToken(config: SpacetimeDBConfig) {
  try {
    window.localStorage.removeItem(tokenStorageKey(config));
  } catch {
    // Nothing stored.
  }
}

function storeToken(config: SpacetimeDBConfig, token: string) {
  try {
    window.localStorage.setItem(tokenStorageKey(config), token);
  } catch {
    // Without storage the identity lasts for this page only.
  }
}

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

/**
 * Connection state for the SpacetimeDB client
 */
export type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

/**
 * Event types for state subscriptions; enemy_spawn carries static path data once per enemy.
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

  constructor(config: SpacetimeDBConfig) {
    this.config = config;
  }

  /**
   * Wait for connection to complete (or fail)
   * Used to avoid race conditions when multiple calls to connect() happen concurrently
   * "connected" is only set once subscriptions are applied, so this also waits for those.
   */
  private waitForConnection(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const checkConnection = () => {
        if (this.connectionState === "connected") {
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
   * Connect to SpacetimeDB
   * @param userId - The user's ID for filtered subscriptions (use "guest" for unauthenticated)
   */
  async connect(userId?: string): Promise<void> {
    // If already connected, just update subscriptions if needed
    if (this.connectionState === "connected") {
      this.switchUser(userId);
      return;
    }

    // If already connecting, wait for it to complete so callers such as startRun() never
    // send on a WebSocket that is not open yet (InvalidStateError)
    if (this.connectionState === "connecting") {
      await this.waitForConnection();
      this.switchUser(userId);
      return;
    }

    this.currentUserId = validateUserId(userId) ?? "guest";
    this.connectionState = "connecting";
    this.emit({ type: "connection_state", state: "connecting" });

    try {
      const connection = DbConnection.builder()
        .withUri(this.config.host)
        .withDatabaseName(this.config.moduleName)
        .withToken(readStoredToken(this.config))
        .onConnect((_ctx, identity, token) => {
          storeToken(this.config, token);
          this.identity = identity.toHexString();
          // Row listeners accumulate per registration, so attach them once per connection.
          this.setupTableHandlers();

          // Set up the user-level subscriptions first to avoid race conditions
          // Note: connectionState will be set in setupGlobalSubscriptions's onApplied callback
          // This ensures callers cannot send reducers before subscriptions are established
          this.setupGlobalSubscriptions();
        })
        .onDisconnect(() => {
          this.connectionState = "disconnected";
          this.emit({ type: "connection_state", state: "disconnected" });
        })
        .onConnectError((_ctx, error) => {
          console.error("[SpacetimeDB] Connection error:", error);
          // A stored token the server no longer accepts would fail every reconnect.
          clearStoredToken(this.config);
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

  /** Follow a new user on an open connection. */
  private switchUser(userId?: string) {
    if (userId && userId !== this.currentUserId) {
      const validatedId = validateUserId(userId);
      if (validatedId) {
        this.currentUserId = validatedId;
        this.setupGlobalSubscriptions();
      }
    }
  }

  /**
   * Set up global subscriptions (user-level, not session-specific).
   * game_session and completed_run are filtered to this user. session_state has no user
   * column and is subscribed whole: the lobby's resume card reads wave, score and health
   * from it before subscribeToSession runs.
   *
   * For guests, we DON'T subscribe to all guest sessions here.
   * Instead, subscribeToGuestSession() is called with the specific seed
   * before creating a session. This is much more efficient.
   */
  private setupGlobalSubscriptions() {
    if (!this.connection || !this.currentUserId) return;

    if (this.globalSubscription) {
      this.globalSubscription.unsubscribe();
      this.globalSubscription = null;
    }

    // For guests, skip global subscription - they'll use subscribeToGuestSession() with specific seed
    if (this.currentUserId === "guest") {
      // Guests are connected immediately (no subscription to wait for)
      this.connectionState = "connected";
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
        // Mark the connection as ready AFTER subscriptions are applied
        // This ensures reducers won't fire before subscriptions are fully established
        this.connectionState = "connected";
        this.emit({ type: "connection_state", state: "connected" });
      })
      .onError((ctx: ErrorContext) => {
        console.error("[SpacetimeDB] Global subscription error:", ctx);
        this.connectionState = "error";
        this.emit({ type: "connection_state", state: "error" });
        this.emit({ type: "error", message: "Global subscription error" });
      })
      .subscribe(queries);
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

    // Subscribe to the specific session by seed (unique per session), so only OUR
    // game_session row arrives; session_state is subscribed whole, as above
    this.globalSubscription = this.connection
      .subscriptionBuilder()
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
  subscribeToSession(sessionId: bigint, options?: { replayCached?: boolean }): void {
    if (!this.connection) return;
    if (this.currentSessionId === sessionId && this.sessionSubscription) {
      // A newly mounted game has fresh refs even when this connection still owns the subscription.
      if (options?.replayCached) this.replaySessionSnapshot(sessionId);
      return;
    }

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
        // Overlapping subscriptions do not re-insert rows already in the local cache.
        // Reconcile the resumed session explicitly after its complete snapshot arrives.
        this.replaySessionSnapshot(sessionId);
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

  private replaySessionSnapshot(sessionId: bigint): void {
    if (!this.connection || this.currentSessionId !== sessionId) return;
    const db = this.connection.db;
    for (const session of db.gameSession.iter())
      if (session.id === sessionId) this.emit({ type: "session_update", session });
    for (const upgrade of db.sessionUpgrade.iter())
      if (upgrade.sessionId === sessionId)
        this.emit({ type: "session_upgrade_insert", upgrade });
    for (const spawn of db.enemySpawn.iter())
      if (spawn.sessionId === sessionId)
        this.emit({ type: "enemy_spawn_insert", spawn });
    for (const enemy of db.enemy.iter())
      if (enemy.sessionId === sessionId) this.emit({ type: "enemy_insert", enemy });
    for (const projectile of db.projectile.iter())
      if (projectile.sessionId === sessionId)
        this.emit({ type: "projectile_insert", projectile });
    for (const state of db.sessionState.iter())
      if (state.sessionId === sessionId)
        this.emit({ type: "session_state_update", state });
  }

  /**
   * Set up handlers for table row events
   */
  private setupTableHandlers() {
    if (!this.connection) return;

    const db = this.connection.db;

    // Game session events
    db.gameSession.onInsert((_ctx, row) => {
      this.currentSessionId = row.id;
      this.emit({ type: "session_update", session: row as GameSession });
    });

    db.gameSession.onUpdate((_ctx, _oldRow, newRow) => {
      this.emit({ type: "session_update", session: newRow as GameSession });
    });

    db.gameSession.onDelete((_ctx, row) => {
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

    // Enemy spawn events (static path data, sent once)
    // These are only insert/delete, never update
    db.enemySpawn.onInsert((_ctx, row) => {
      this.emit({ type: "enemy_spawn_insert", spawn: row });
    });

    db.enemySpawn.onDelete((_ctx, row) => {
      this.emit({ type: "enemy_spawn_delete", enemyId: row.enemyId });
    });

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

    // Projectile events: insert/delete only; the client computes progress
    db.projectile.onInsert((_ctx, row) => {
      this.emit({ type: "projectile_insert", projectile: row as Projectile });
    });

    db.projectile.onDelete((_ctx, row) => {
      this.emit({ type: "projectile_delete", projectileId: row.id });
    });

    // Completed run events
    db.completedRun.onInsert((_ctx, row) => {
      this.emit({ type: "completed_run", run: row as CompletedRun });
    });

    // Session upgrade events
    db.sessionUpgrade.onInsert((_ctx, row) => {
      this.emit({ type: "session_upgrade_insert", upgrade: row as SessionUpgrade });
    });

    db.sessionUpgrade.onUpdate((_ctx, _oldRow, newRow) => {
      this.emit({ type: "session_upgrade_update", upgrade: newRow as SessionUpgrade });
    });

    db.sessionUpgrade.onDelete((_ctx, row) => {
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
    this.currentSessionId = null;
    this.currentUserId = null;
    this.emit({ type: "connection_state", state: "disconnected" });
  }

  /**
   * Get current identity
   */
  getIdentity(): string | null {
    return this.identity;
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

  /** The live connection, for a reducer call. */
  private requireConnection(): DbConnection {
    if (!this.connection || this.connectionState !== "connected") {
      throw new Error("Not connected to SpacetimeDB");
    }
    return this.connection;
  }

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
  async createSession(params: CreateSessionParams): Promise<void> {
    await this.requireConnection().reducers.createSession(params);
  }

  /**
   * Start a new wave
   */
  async startWave(sessionId: bigint): Promise<void> {
    await this.requireConnection().reducers.startWave({ sessionId });
  }

  /**
   * Throw shuriken at target
   */
  async throwShuriken(
    sessionId: bigint,
    targetCol: number,
    targetRow: number,
  ): Promise<void> {
    await this.requireConnection().reducers.throwShuriken({
      sessionId,
      targetCol,
      targetRow,
    });
  }

  /**
   * Purchase an in-run upgrade
   *
   * SECURITY: Only the upgradeId is passed. All upgrade parameters (cost, effect, limits)
   * are looked up server-side from hardcoded definitions to prevent cheating.
   */
  async purchaseUpgrade(sessionId: bigint, upgradeId: string): Promise<void> {
    await this.requireConnection().reducers.purchaseUpgrade({ sessionId, upgradeId });
  }

  /**
   * Delete a completed run record after claiming
   */
  async deleteCompletedRun(sessionId: bigint): Promise<void> {
    await this.requireConnection().reducers.deleteCompletedRun({ sessionId });
  }

  /**
   * Abandon a session
   */
  async abandonSession(sessionId: bigint): Promise<void> {
    await this.requireConnection().reducers.abandonSession({ sessionId });
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
