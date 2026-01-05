/**
 * SpacetimeDB Client Connection Manager
 *
 * Uses the auto-generated bindings from SpacetimeDB to connect and manage
 * Tower Defense game sessions.
 */

import { DbConnection, type ErrorContext, type SubscriptionHandle } from "./bindings";
import type { Infer } from "spacetimedb/sdk";
import type GameSessionType from "./bindings/game_session_type";
import type EnemyType from "./bindings/enemy_type";
import type ProjectileType from "./bindings/projectile_type";
import type CompletedRunType from "./bindings/completed_run_type";
import type SessionUpgradeType from "./bindings/session_upgrade_type";

// Re-export types from bindings for use in useTowerDefense hook
export type GameSession = Infer<typeof GameSessionType>;
export type Enemy = Infer<typeof EnemyType>;
export type Projectile = Infer<typeof ProjectileType>;
export type CompletedRun = Infer<typeof CompletedRunType>;
export type SessionUpgrade = Infer<typeof SessionUpgradeType>;

export interface SpacetimeDBConfig {
  host: string;
  moduleName: string;
}

const DEBUG = false;

// Environment-based config
export const getSpacetimeDBConfig = (): SpacetimeDBConfig => {
  const isProd = process.env.NODE_ENV === "production";

  return {
    host:
      process.env.NEXT_PUBLIC_SPACETIMEDB_HOST ??
      (isProd ? "wss://spacetimedb.com" : "ws://127.0.0.1:3001"),
    moduleName: process.env.NEXT_PUBLIC_SPACETIMEDB_MODULE ?? "towerdefense",
  };
};

/**
 * Connection state for the SpacetimeDB client
 */
export type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

/**
 * Event types for state subscriptions
 */
export type SpacetimeDBEvent =
  | { type: "connection_state"; state: ConnectionState }
  | { type: "session_update"; session: GameSession }
  | { type: "session_delete"; sessionId: bigint }
  | { type: "enemy_insert"; enemy: Enemy }
  | { type: "enemy_update"; enemy: Enemy }
  | { type: "enemy_delete"; enemyId: bigint }
  | { type: "projectile_insert"; projectile: Projectile }
  | { type: "projectile_update"; projectile: Projectile }
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
  private subscription: SubscriptionHandle | null = null;
  private identity: string | null = null;
  private currentSessionId: bigint | null = null;

  constructor(config: SpacetimeDBConfig) {
    this.config = config;
  }

  /**
   * Connect to SpacetimeDB
   */
  async connect(): Promise<void> {
    if (this.connectionState === "connected" || this.connectionState === "connecting") {
      return;
    }

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
          this.connectionState = "connected";
          this.emit({ type: "connection_state", state: "connected" });

          // Set up subscriptions after connection
          this.setupSubscriptions();
        })
        .onDisconnect((ctx, error) => {
          if (DEBUG) {
            console.log("[SpacetimeDB] Disconnected", error);
          }
          this.connectionState = "disconnected";
          this.emit({ type: "connection_state", state: "disconnected" });
        })
        .onConnectError((ctx, error) => {
          console.error("[SpacetimeDB] Connection error:", error);
          this.connectionState = "error";
          this.emit({ type: "connection_state", state: "error" });
          this.emit({ type: "error", message: String(error) });
        })
        .build();

      this.connection = connection;

      // Wait for connection to complete
      await new Promise<void>((resolve, reject) => {
        const checkConnection = () => {
          if (this.connectionState === "connected") {
            resolve();
          } else if (this.connectionState === "error") {
            reject(new Error("Connection failed"));
          } else {
            setTimeout(checkConnection, 100);
          }
        };
        setTimeout(checkConnection, 100);
      });
    } catch (error) {
      this.connectionState = "error";
      this.emit({ type: "connection_state", state: "error" });
      throw error;
    }
  }

  /**
   * Set up table subscriptions
   */
  private setupSubscriptions() {
    if (!this.connection) return;

    // Subscribe to all game tables
    this.subscription = this.connection
      .subscriptionBuilder()
      .onApplied(() => {
        if (DEBUG) {
          console.log("[SpacetimeDB] Subscription applied");
        }
      })
      .onError((ctx: ErrorContext) => {
        console.error("[SpacetimeDB] Subscription error:", ctx);
        this.emit({ type: "error", message: "Subscription error" });
      })
      .subscribe([
        "SELECT * FROM game_session",
        "SELECT * FROM enemy",
        "SELECT * FROM projectile",
        "SELECT * FROM completed_run",
        "SELECT * FROM session_upgrade",
      ]);

    // Set up table event handlers
    this.setupTableHandlers();
  }

  /**
   * Set up handlers for table row events
   */
  private setupTableHandlers() {
    if (!this.connection) return;

    const db = this.connection.db;

    // Game session events
    db.gameSession.onInsert((ctx, row) => {
      if (DEBUG) {
        console.log("[SpacetimeDB] Session inserted:", row.id);
      }
      this.currentSessionId = row.id;
      this.emit({ type: "session_update", session: row as GameSession });
    });

    db.gameSession.onUpdate((ctx, oldRow, newRow) => {
      if (DEBUG) {
        console.log("[SpacetimeDB] Session updated:", newRow.id);
      }
      this.emit({ type: "session_update", session: newRow as GameSession });
    });

    db.gameSession.onDelete((ctx, row) => {
      if (DEBUG) {
        console.log("[SpacetimeDB] Session deleted:", row.id);
      }
      if (this.currentSessionId === row.id) {
        this.currentSessionId = null;
      }
      this.emit({ type: "session_delete", sessionId: row.id });
    });

    // Enemy events
    db.enemy.onInsert((ctx, row) => {
      this.emit({ type: "enemy_insert", enemy: row as Enemy });
    });

    db.enemy.onUpdate((ctx, oldRow, newRow) => {
      this.emit({ type: "enemy_update", enemy: newRow as Enemy });
    });

    db.enemy.onDelete((ctx, row) => {
      this.emit({ type: "enemy_delete", enemyId: row.id });
    });

    // Projectile events
    db.projectile.onInsert((ctx, row) => {
      this.emit({ type: "projectile_insert", projectile: row as Projectile });
    });

    db.projectile.onUpdate((ctx, oldRow, newRow) => {
      this.emit({ type: "projectile_update", projectile: newRow as Projectile });
    });

    db.projectile.onDelete((ctx, row) => {
      this.emit({ type: "projectile_delete", projectileId: row.id });
    });

    // Completed run events
    db.completedRun.onInsert((ctx, row) => {
      if (DEBUG) {
        console.log("[SpacetimeDB] Completed run:", row.id);
      }
      this.emit({ type: "completed_run", run: row as CompletedRun });
    });

    // Session upgrade events
    db.sessionUpgrade.onInsert((ctx, row) => {
      if (DEBUG) {
        console.log("[SpacetimeDB] Session upgrade inserted:", row.upgradeId);
      }
      this.emit({ type: "session_upgrade_insert", upgrade: row as SessionUpgrade });
    });

    db.sessionUpgrade.onUpdate((ctx, oldRow, newRow) => {
      if (DEBUG) {
        console.log("[SpacetimeDB] Session upgrade updated:", newRow.upgradeId);
      }
      this.emit({ type: "session_upgrade_update", upgrade: newRow as SessionUpgrade });
    });

    db.sessionUpgrade.onDelete((ctx, row) => {
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
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
    if (this.connection) {
      this.connection.disconnect();
      this.connection = null;
    }
    this.connectionState = "disconnected";
    this.currentSessionId = null;
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
    this.eventHandlers.forEach((handler) => handler(event));
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
    if (!this.connection) {
      throw new Error("Not connected to SpacetimeDB");
    }

    this.connection.reducers.createSession(params);
    if (DEBUG) {
      console.log("[SpacetimeDB] createSession called with signed definitions");
    }
  }

  /**
   * Start a new wave
   */
  async startWave(sessionId: bigint): Promise<void> {
    if (!this.connection) {
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
    if (!this.connection) {
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
    if (!this.connection) {
      throw new Error("Not connected to SpacetimeDB");
    }

    this.connection.reducers.purchaseUpgrade({ sessionId, upgradeId });
    if (DEBUG) {
      console.log("[SpacetimeDB] purchaseUpgrade called:", upgradeId);
    }
  }

  /**
   * Abandon a session
   */
  async abandonSession(sessionId: bigint): Promise<void> {
    if (!this.connection) {
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
