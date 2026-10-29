import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { jutsu, jutsuLoadout, userData, userJutsu } from "@/drizzle/schema";
import { exportJutsuLoadout } from "@/libs/loadout";
import { jutsuRouter } from "@/server/api/routers/jutsu";
import type { DrizzleClient } from "@/server/db";
import { insertUsers } from "../../../../setup/factories";
import { beforeStatements } from "../../../../setup/statements";
import { callerFor, callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../../../setup/testDatabase";

const USER = "jutsu-sharing-recipient";
const text = exportJutsuLoadout(["sharing-b", "sharing-a"]);

describeWithDatabase("jutsu loadout sharing atomic SQL", () => {
  beforeEach(async () => {
    await resetTables(jutsuLoadout, userJutsu, jutsu, userData);
    await insertUsers([{ userId: USER, username: USER, rank: "GENIN", level: 20, federalStatus: "GOLD", isOutlaw: true }]);
    const database = await getTestDatabase();
    await database.insert(jutsu).values(["sharing-a", "sharing-b", "sharing-old"].map((id) => ({
      id, name: id, description: id, battleDescription: id, effects: [],
      target: "SELF" as const, range: 0, requiredRank: "GENIN" as const,
      jutsuType: "NORMAL" as const, image: "",
    })));
    await database.insert(userJutsu).values(["sharing-a", "sharing-b", "sharing-old"].map((jutsuId) => ({
      id: `owned-${jutsuId}`, userId: USER, jutsuId, level: 10, equipped: jutsuId === "sharing-old",
    })));
    await database.insert(jutsuLoadout).values([
      { id: "sharing-active", userId: USER, name: "Keep name", jutsuIds: ["sharing-old"], createdAt: new Date(0) },
      { id: "sharing-inactive", userId: USER, name: "Other", jutsuIds: ["sharing-old"], createdAt: new Date(1) },
    ]);
    await database.update(userData).set({ jutsuLoadout: "sharing-active" }).where(eq(userData.userId, USER));
  });

  /** Obtain a real server preview for the existing recipient slot. */
  const previewInput = async (loadoutId = "sharing-active", sharedText = text) => {
    const caller = await callerFor(jutsuRouter, USER);
    const result = await caller.previewJutsuLoadout({ loadoutId, text: sharedText });
    if (!result.success) throw new Error(result.message);
    return { loadoutId, text: sharedText, previewToken: result.preview.token };
  };
  /** Read slots and inventory with stable ordering for before/after comparisons. */
  const snapshot = async () => {
    const database = await getTestDatabase();
    const [loadouts, owned] = await Promise.all([
      database.query.jutsuLoadout.findMany({ where: eq(jutsuLoadout.userId, USER) }),
      database.query.userJutsu.findMany({ where: eq(userJutsu.userId, USER) }),
    ]);
    owned.sort((left, right) => left.jutsuId.localeCompare(right.jutsuId));
    return { loadouts, owned, equipped: owned.filter((entry) => entry.equipped).map((entry) => entry.jutsuId).sort() };
  };

  it("replaces active saved IDs and equipped flags together, preserving names and training", async () => {
    const input = await previewInput();
    const before = await snapshot();
    const caller = await callerFor(jutsuRouter, USER);
    const result = await caller.importJutsuLoadout(input);
    expect(result.success).toBe(true);
    expect(result.userPatch).toMatchObject({ jutsuLoadout: "sharing-active", loadout: { jutsuIds: ["sharing-b", "sharing-a"] } });
    const after = await snapshot();
    expect(after.loadouts.find((entry) => entry.id === input.loadoutId)).toMatchObject({ name: "Keep name", jutsuIds: ["sharing-b", "sharing-a"] });
    expect(after.equipped).toEqual(["sharing-a", "sharing-b"]);
    expect(after.owned.map(({ equipped: _, ...entry }) => entry)).toEqual(before.owned.map(({ equipped: _, ...entry }) => entry));
  });

  it("updates only the saved IDs for an inactive destination", async () => {
    const input = await previewInput("sharing-inactive");
    const before = await snapshot();
    const caller = await callerFor(jutsuRouter, USER);
    const result = await caller.importJutsuLoadout(input);
    expect(result.success).toBe(true);
    expect(result.userPatch?.loadout).toBeUndefined();
    expect(result.userPatch?.jutsuLoadout).toBeUndefined();
    const after = await snapshot();
    expect(after.loadouts.find((entry) => entry.id === input.loadoutId)).toMatchObject({ name: "Other", jutsuIds: ["sharing-b", "sharing-a"] });
    expect(after.owned).toEqual(before.owned);
  });

  it.each(["sharing-active", "sharing-inactive"])("does not overwrite a concurrent destination edit in %s", async (loadoutId) => {
    const input = await previewInput(loadoutId);
    const database = await getTestDatabase();
    const interleaved = beforeStatements(database, jutsuLoadout, [() => database.update(jutsuLoadout).set({ jutsuIds: ["sharing-old", "sharing-a"] }).where(eq(jutsuLoadout.id, loadoutId))]);
    const caller = callerForDatabase(jutsuRouter, USER, interleaved);
    const result = await caller.importJutsuLoadout(input);
    expect(result.success).toBe(false);
    expect(result.message).toContain("Preview again");
    const after = await snapshot();
    expect(after.loadouts.find((entry) => entry.id === loadoutId)?.jutsuIds).toEqual(["sharing-old", "sharing-a"]);
    expect(after.equipped).toEqual(["sharing-old"]);
  });

  it("does not change saved IDs or equipment after a concurrent active selection", async () => {
    const input = await previewInput();
    const database = await getTestDatabase();
    const interleaved = beforeStatements(database, jutsuLoadout, [() => database.update(userData).set({ jutsuLoadout: "sharing-inactive" }).where(eq(userData.userId, USER))]);
    const caller = callerForDatabase(jutsuRouter, USER, interleaved);
    expect((await caller.importJutsuLoadout(input)).success).toBe(false);
    const after = await snapshot();
    expect(after.loadouts.find((entry) => entry.id === "sharing-active")?.jutsuIds).toEqual(["sharing-old"]);
    expect(after.equipped).toEqual(["sharing-old"]);
  });

  it.each(["sharing-active", "sharing-inactive"])("confirms a matching %s without changing it", async (loadoutId) => {
    const input = await previewInput(loadoutId, exportJutsuLoadout(["sharing-old"]));
    const before = await snapshot();
    const caller = await callerFor(jutsuRouter, USER);
    const result = await caller.importJutsuLoadout(input);
    expect(result).toMatchObject({ success: true, message: "Loadout already matches" });
    expect(result.userPatch?.loadout).toEqual(loadoutId === "sharing-active" ? { jutsuIds: ["sharing-old"] } : undefined);
    expect(await snapshot()).toEqual(before);
  });

  it.each(["destination", "active selection", "missing equipment", "extra equipment", "ownership", "allowance"])("rejects a stale no-op after concurrent %s changes", async (change) => {
    const input = await previewInput("sharing-active", exportJutsuLoadout(["sharing-old"]));
    const database = await getTestDatabase();
    let concurrentState: Awaited<ReturnType<typeof snapshot>> | undefined;
    const interleaved = beforeLoadoutConfirmation(database, async () => {
      if (change === "destination") await database.update(jutsuLoadout).set({ jutsuIds: ["sharing-a"] }).where(eq(jutsuLoadout.id, input.loadoutId));
      if (change === "active selection") await database.update(userData).set({ jutsuLoadout: "sharing-inactive" }).where(eq(userData.userId, USER));
      if (change === "missing equipment") await database.update(userJutsu).set({ equipped: false }).where(eq(userJutsu.id, "owned-sharing-old"));
      if (change === "extra equipment") await database.update(userJutsu).set({ equipped: true }).where(eq(userJutsu.id, "owned-sharing-a"));
      if (change === "ownership") await database.delete(userJutsu).where(eq(userJutsu.id, "owned-sharing-old"));
      if (change === "allowance") await database.update(userData).set({ federalStatus: "NONE" }).where(eq(userData.userId, USER));
      concurrentState = await snapshot();
    });
    const caller = callerForDatabase(jutsuRouter, USER, interleaved);
    const result = await caller.importJutsuLoadout(input);
    if (!concurrentState) throw new Error("No-op confirmation did not read current state");
    expect(result.success).toBe(false);
    expect(result.message).toContain("Preview again");
    expect(await snapshot()).toEqual(concurrentState);
  });
});

/**
 * Interleave an edit at no-op SELECT execution, after all preparation reads.
 * The shared statement helper intercepts writes, so it cannot target this read.
 */
const beforeLoadoutConfirmation = (client: DrizzleClient, action: () => Promise<void>): DrizzleClient => {
  /** Preserve fluent builder chaining while deferring the interleaving until execution. */
  const wrap = (builder: object): object => new Proxy(builder, {
    get(target, property, receiver) {
      if (property === "then") {
        const pending = action().then(() => Promise.resolve(target as PromiseLike<unknown>));
        return pending.then.bind(pending);
      }
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const next = value.apply(target, args);
        return next === target ? receiver : wrap(next);
      };
    },
  });
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property !== "select") return Reflect.get(target, property, receiver);
      return (...args: Parameters<DrizzleClient["select"]>) => {
        const selection = target.select(...args);
        return new Proxy(selection, {
          get(builder, key, proxy) {
            if (key !== "from") return Reflect.get(builder, key, proxy);
            return (table: Parameters<typeof selection.from>[0]) => {
              const query = builder.from(table);
              return table === jutsuLoadout ? wrap(query) : query;
            };
          },
        });
      };
    },
  });
};
