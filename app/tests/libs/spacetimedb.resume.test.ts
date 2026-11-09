import { describe, expect, it } from "bun:test";
import {
  SpacetimeDBConnection,
  type SpacetimeDBEvent,
} from "@/libs/spacetimedb/client";

const fixture = () => {
  const callbacks: (() => void)[] = [];
  let subscriptions = 0,
    unsubscriptions = 0;
  const rows = [
    { id: 1n, sessionId: 1n },
    { id: 2n, sessionId: 2n },
  ];
  const table = { iter: () => rows.values() };
  const client = new SpacetimeDBConnection({
    host: "ws://localhost",
    moduleName: "test",
  });
  const builder = {
    onApplied: (callback: () => void) => {
      callbacks.push(callback);
      return builder;
    },
    onError: () => builder,
    subscribe: () => {
      subscriptions++;
      return {
        unsubscribe: () => {
          unsubscriptions++;
        },
      };
    },
  };
  Object.assign(client, {
    connection: {
      db: {
        gameSession: table,
        sessionUpgrade: table,
        enemySpawn: table,
        enemy: table,
        projectile: table,
        sessionState: table,
      },
      subscriptionBuilder: () => builder,
    },
  });
  return { client, callbacks, counts: () => [subscriptions, unsubscriptions] };
};

describe("resuming a cached tower defense session", () => {
  it("reconciles complete session data even when overlapping rows do not emit inserts", () => {
    const { client, callbacks, counts } = fixture();
    const events: SpacetimeDBEvent[] = [];
    client.subscribe((event) => {
      events.push(event);
      if (event.type === "session_update") client.subscribeToSession(event.session.id);
    });
    client.subscribeToSession(1n);
    callbacks[0]!();
    expect(counts()).toEqual([1, 0]);
    expect(events.map((event) => event.type)).toEqual([
      "session_update",
      "session_upgrade_insert",
      "enemy_spawn_insert",
      "enemy_insert",
      "projectile_insert",
      "session_state_update",
    ]);
    expect(events).toHaveLength(6);
    expect(events[0]).toMatchObject({ session: { id: 1n } });
    expect(events[5]).toMatchObject({ state: { sessionId: 1n } });
  });
  it("ignores a late snapshot after switching sessions", () => {
    const { client, callbacks, counts } = fixture();
    const events: SpacetimeDBEvent[] = [];
    client.subscribe((event) => events.push(event));
    client.subscribeToSession(1n);
    client.subscribeToSession(2n);
    callbacks[0]!();
    expect(events).toHaveLength(0);
    callbacks[1]!();
    expect(events).toHaveLength(6);
    expect(events[0]).toMatchObject({ session: { id: 2n } });
    expect(counts()).toEqual([2, 1]);
  });

  it("hydrates a remounted game from an existing subscription without waiting for a row change", () => {
    const { client, callbacks, counts } = fixture();
    const original: SpacetimeDBEvent[] = [];
    const unsubscribe = client.subscribe((event) => original.push(event));
    client.subscribeToSession(1n);
    callbacks[0]!();
    unsubscribe();
    const resumed: SpacetimeDBEvent[] = [];
    client.subscribe((event) => {
      resumed.push(event);
      if (event.type === "session_update") client.subscribeToSession(event.session.id);
    });
    client.subscribeToSession(1n, { replayCached: true });
    expect(counts()).toEqual([1, 0]);
    expect(resumed.map((event) => event.type)).toEqual(
      original.map((event) => event.type),
    );
    expect(resumed.at(-1)).toMatchObject({
      type: "session_state_update",
      state: { sessionId: 1n },
    });
    expect(resumed).toHaveLength(6);
  });
});

describe("switching users on a live connection", () => {
  it("replaces the global subscription without registering row listeners again", async () => {
    let listeners = 0,
      subscriptions = 0,
      unsubscriptions = 0;
    const table = {
      iter: () => [].values(),
      onInsert: () => {
        listeners++;
      },
      onUpdate: () => {
        listeners++;
      },
      onDelete: () => {
        listeners++;
      },
    };
    const builder = {
      onApplied: () => builder,
      onError: () => builder,
      subscribe: () => {
        subscriptions++;
        return {
          unsubscribe: () => {
            unsubscriptions++;
          },
        };
      },
    };
    const client = new SpacetimeDBConnection({
      host: "ws://localhost",
      moduleName: "test",
    });
    Object.assign(client, {
      connectionState: "connected",
      currentUserId: "guest",
      connection: {
        db: {
          gameSession: table,
          sessionUpgrade: table,
          enemySpawn: table,
          enemy: table,
          projectile: table,
          sessionState: table,
          completedRun: table,
        },
        subscriptionBuilder: () => builder,
      },
    });
    await client.connect("user-a");
    await client.connect("user-b");
    expect(listeners).toBe(0);
    expect([subscriptions, unsubscriptions]).toEqual([2, 1]);
  });
});

describe("a connection still opening", () => {
  it("waits for it and then follows the new user", async () => {
    let subscriptions = 0;
    const builder = {
      onApplied: () => builder,
      onError: () => builder,
      subscribe: () => {
        subscriptions++;
        return { unsubscribe: () => {} };
      },
    };
    const client = new SpacetimeDBConnection({
      host: "ws://localhost",
      moduleName: "test",
    });
    Object.assign(client, {
      connectionState: "connecting",
      currentUserId: "guest",
      connection: { subscriptionBuilder: () => builder },
    });
    const connecting = client.connect("user-a");
    Object.assign(client, { connectionState: "connected" });
    await connecting;
    expect(subscriptions).toBe(1);
  });

  it("rejects when it fails", async () => {
    const client = new SpacetimeDBConnection({
      host: "ws://localhost",
      moduleName: "test",
    });
    Object.assign(client, { connectionState: "connecting" });
    const connecting = client.connect("user-a");
    Object.assign(client, { connectionState: "error" });
    await expect(connecting).rejects.toThrow("Connection failed");
  });
});

describe("reducer calls", () => {
  const calls = (client: SpacetimeDBConnection) => [
    () =>
      client.createSession({} as Parameters<SpacetimeDBConnection["createSession"]>[0]),
    () => client.startWave(1n),
    () => client.throwShuriken(1n, 2, 3),
    () => client.purchaseUpgrade(1n, "upgrade"),
    () => client.deleteCompletedRun(1n),
    () => client.abandonSession(1n),
  ];

  it("refuse without a live connection", async () => {
    const closed = new SpacetimeDBConnection({
      host: "ws://localhost",
      moduleName: "test",
    });
    const opening = new SpacetimeDBConnection({
      host: "ws://localhost",
      moduleName: "test",
    });
    Object.assign(opening, { connectionState: "connecting", connection: {} });
    for (const client of [closed, opening]) {
      for (const call of calls(client)) {
        await expect(call()).rejects.toThrow("Not connected to SpacetimeDB");
      }
    }
  });

  it("reach the connection once it is live", async () => {
    const sent: string[] = [];
    const reducers = new Proxy(
      {},
      {
        get: (_target, name) => async () => {
          sent.push(String(name));
        },
      },
    );
    const client = new SpacetimeDBConnection({
      host: "ws://localhost",
      moduleName: "test",
    });
    Object.assign(client, { connectionState: "connected", connection: { reducers } });
    for (const call of calls(client)) await call();
    expect(sent).toEqual([
      "createSession",
      "startWave",
      "throwShuriken",
      "purchaseUpgrade",
      "deleteCompletedRun",
      "abandonSession",
    ]);
  });
});
