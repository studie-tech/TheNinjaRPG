import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as client from "@/app/_trpc/client";
import { TD_ENEMY_DIRECTIONS } from "@/drizzle/constants";
import { useHudStoreValues, useTowerDefense } from "@/hooks/useTowerDefense";
import * as spacetime from "@/libs/spacetimedb/client";
import type {
  GameSession,
  SessionState,
  SpacetimeDBEvent,
} from "@/libs/spacetimedb/client";
import {
  getDefaultPlayerBonuses,
  getShurikenAbility,
} from "@/libs/towerDefense/abilities";

const USER = "user-1";
const IDENTITY = "identity-1";
let emit: (event: SpacetimeDBEvent) => void = () => undefined;
const connection = {
  subscribe: (callback: (event: SpacetimeDBEvent) => void) => {
    emit = callback;
    return () => undefined;
  },
  connect: vi.fn(async () => undefined),
  getIdentity: () => IDENTITY,
  subscribeToSession: vi.fn(),
  subscribeToGuestSession: vi.fn(),
  createSession: vi.fn(async (_input: Record<string, unknown>) => undefined),
  startWave: vi.fn(async () => undefined),
  getAllSessions: () => [],
};
const params = { initialGridSize: 9, playerMaxHealth: 120, abilityDamage: 7 };
const secureSession = {
  seed: "seed-1",
  nonce: "nonce-1",
  signature: "signature-1",
  upgradeDefinitions: [{ id: "u" }],
  enemyDefinitions: [{ id: "e" }],
  params,
  ability: getShurikenAbility(),
  playerBonuses: getDefaultPlayerBonuses(),
};

const session = (overrides: Partial<GameSession> = {}) =>
  ({
    id: 5n,
    ninjarpgUserId: USER,
    spacetimedbIdentity: IDENTITY,
    seed: "seed-1",
    initialGridSize: 9,
    initialPlayerMaxHealth: 120,
    ...overrides,
  }) as unknown as GameSession;

const sessionState = (overrides: Partial<SessionState> = {}) =>
  ({
    sessionId: 5n,
    status: "active",
    playerHealth: 80,
    playerCol: 4,
    playerRow: 4,
    inRunCurrency: 30,
    gridSize: 9,
    abilityDamage: 7,
    abilityRange: 3,
    abilityCooldownMs: 500,
    abilityCritChance: 0.1,
    abilityDamagePerTile: 0,
    abilityLastUsedAt: 0n,
    healthRegen: 0,
    defensePercent: 0,
    defenseFlat: 0,
    lifestealPercent: 0,
    knockbackChance: 0,
    knockbackForce: 0,
    tokensPerWave: 0,
    tokensPerKill: 10,
    interestPerWave: 0,
    skipEnemyChance: 0,
    score: 40,
    wave: 3,
    waveInProgress: false,
    waveStartTime: 0n,
    playerMaxHealth: 120,
    ...overrides,
  }) as unknown as SessionState;

const enemyEvents = (): SpacetimeDBEvent[] =>
  [
    {
      type: "enemy_spawn_insert",
      spawn: { enemyId: 11n, sessionId: 5n, path: [{ col: 0, row: 0 }], maxHealth: 20 },
    },
    {
      type: "enemy_insert",
      enemy: {
        id: 11n,
        sessionId: 5n,
        enemyType: "bandit",
        col: 0,
        row: 0,
        pathIndex: 0,
        health: 20,
        speed: 1,
        damage: 2,
        attackCooldown: 1,
        lastAttackTime: 0n,
        movementProgress: 0,
        direction: TD_ENEMY_DIRECTIONS[0],
      },
    },
  ] as unknown as SpacetimeDBEvent[];

const query = { useQuery: () => ({ data: undefined }) };
const mutation = (result: unknown) => ({
  useMutation: () => ({ mutateAsync: async () => result }),
});

beforeEach(() => {
  emit = () => undefined;
  for (const mock of [
    connection.connect,
    connection.subscribeToSession,
    connection.subscribeToGuestSession,
    connection.createSession,
    connection.startWave,
  ]) {
    mock.mockClear();
  }
  vi.spyOn(spacetime, "getSpacetimeDBConnection").mockReturnValue(
    connection as unknown as spacetime.SpacetimeDBConnection,
  );
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({}),
    towerDefense: {
      getUserUpgrades: query,
      getUpgrades: query,
      getAssetConfigs: query,
      initiateSecureSession: mutation(secureSession),
      initiateGuestSession: mutation(secureSession),
      claimCompletedRun: mutation({ success: true, message: "" }),
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const render = () =>
  renderHook(() => ({ td: useTowerDefense(USER), hud: useHudStoreValues() }));

describe("tower defense session flow", () => {
  it("offers our own unfinished session from the lobby with its latest progress", async () => {
    const { result } = render();
    await act(async () => {
      emit({ type: "session_update", session: session() });
    });
    expect(result.current.td.gameState.seed).toBe("seed-1");
    expect(result.current.td.gameState.existingSession).toEqual({
      id: "5",
      seed: "seed-1",
      gridSize: 9,
      wave: 0,
      score: 0,
      health: 0,
      maxHealth: 120,
    });
    await act(async () => {
      emit({ type: "session_state_update", state: sessionState() });
    });
    expect(result.current.td.gameState.existingSession).toEqual({
      id: "5",
      seed: "seed-1",
      gridSize: 9,
      wave: 3,
      score: 40,
      health: 80,
      maxHealth: 120,
    });
    await act(async () => {
      emit({
        type: "session_update",
        session: session({
          id: 6n,
          spacetimedbIdentity: "other",
        } as Partial<GameSession>),
      });
    });
    expect(result.current.td.gameState.existingSession?.id).toBe("5");
  });

  it("starts a run with the signed parameters and follows the server into play", async () => {
    const { result } = render();
    await act(async () => {
      await result.current.td.startRun();
    });
    expect(connection.connect).toHaveBeenCalledWith(USER);
    expect(connection.createSession).toHaveBeenCalledWith({
      ninjarpgUserId: USER,
      seed: "seed-1",
      nonce: "nonce-1",
      sessionSignature: "signature-1",
      upgradeDefinitionsJson: JSON.stringify([{ id: "u" }]),
      enemyDefinitionsJson: JSON.stringify([{ id: "e" }]),
      ...params,
    });
    const initialState = {
      playerHealth: 120,
      playerPosition: { col: 4, row: 4 },
      inRunCurrency: 0,
      activeUpgrades: {},
      gridSize: 9,
    };
    expect(result.current.td.gameState).toEqual(
      expect.objectContaining({
        mode: "connecting",
        seed: "seed-1",
        state: initialState,
      }),
    );
    expect(result.current.td.runtimeStateRef.current).toEqual(
      expect.objectContaining({
        maxHealth: 120,
        state: initialState,
        abilities: [secureSession.ability],
        playerBonuses: secureSession.playerBonuses,
      }),
    );
    expect(result.current.hud).toEqual(
      expect.objectContaining({
        maxHealth: 120,
        playerHealth: 120,
        abilities: [secureSession.ability],
      }),
    );

    await act(async () => {
      emit({ type: "session_update", session: session() });
    });
    expect(connection.subscribeToSession).toHaveBeenCalledWith(5n);
    expect(result.current.td.gameState.seed).toBe("seed-1");

    await act(async () => {
      emit({
        type: "session_state_update",
        state: sessionState({ waveInProgress: true }),
      });
    });
    expect(result.current.td.gameState).toEqual(
      expect.objectContaining({
        mode: "playing",
        runId: "5",
        currentWave: 3,
        score: 40,
        waveInProgress: true,
        existingSession: null,
      }),
    );
    expect(result.current.hud).toEqual(
      expect.objectContaining({
        score: 40,
        currentWave: 3,
        playerHealth: 80,
        inRunCurrency: 30,
      }),
    );

    await act(async () => {
      emit({
        type: "session_state_update",
        state: sessionState({ waveInProgress: true, score: 55, playerHealth: 70 }),
      });
    });
    expect(result.current.td.gameState.score).toBe(40);
    expect(result.current.hud).toEqual(
      expect.objectContaining({ score: 55, playerHealth: 70 }),
    );
  });

  it("clears the previous wave's entities before starting the next one", async () => {
    const { result } = render();
    await act(async () => {
      await result.current.td.startRun();
    });
    await act(async () => {
      emit({ type: "session_update", session: session() });
    });
    await act(async () => {
      for (const event of enemyEvents()) emit(event);
    });
    const store = result.current.td.entitiesRef.current;
    expect(store.enemies.size).toBe(1);
    expect(store.enemiesArray[0]).toEqual(
      expect.objectContaining({ id: "enemy-11", maxHealth: 20 }),
    );
    expect(result.current.hud.enemyCount).toBe(1);
    const versions = [store.enemiesVersion, store.projectilesVersion];
    await act(async () => {
      await result.current.td.startWave();
    });
    expect(connection.startWave).toHaveBeenCalledWith(5n);
    expect(store.enemies.size).toBe(0);
    expect(store.enemySpawns.size).toBe(0);
    expect(store.enemiesArray).toEqual([]);
    expect(store.projectilesArray).toEqual([]);
    expect([store.enemiesVersion, store.projectilesVersion]).toEqual([
      versions[0]! + 1,
      versions[1]! + 1,
    ]);
    expect(result.current.td.runtimeStateRef.current.enemyCount).toBe(0);
  });

  it("resumes an offered session from its saved progress with fresh entities", async () => {
    const { result } = render();
    await act(async () => {
      emit({ type: "session_update", session: session() });
    });
    await act(async () => {
      emit({
        type: "session_state_update",
        state: sessionState({ gridSize: 11, playerHealth: 64 }),
      });
    });
    await act(async () => {
      for (const event of enemyEvents()) emit(event);
    });
    await act(async () => {
      await result.current.td.resumeRun();
    });
    const initialState = {
      playerHealth: 64,
      playerPosition: { col: 5, row: 5 },
      inRunCurrency: 0,
      activeUpgrades: {},
      gridSize: 11,
    };
    expect(result.current.td.gameState).toEqual(
      expect.objectContaining({
        mode: "connecting",
        runId: "5",
        seed: "seed-1",
        currentWave: 3,
        score: 40,
        state: initialState,
        existingSession: null,
      }),
    );
    expect(result.current.td.runtimeStateRef.current).toEqual(
      expect.objectContaining({
        currentWave: 3,
        score: 40,
        maxHealth: 120,
        state: initialState,
      }),
    );
    expect(result.current.td.entitiesRef.current.enemies.size).toBe(0);
    expect(connection.subscribeToSession).toHaveBeenCalledWith(5n, {
      replayCached: true,
    });
    expect(result.current.hud).toEqual(
      expect.objectContaining({ playerHealth: 64, currentWave: 3, score: 40 }),
    );
  });
});
