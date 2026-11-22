import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import type { inferProcedureInput } from "@trpc/server";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { z } from "zod";
import { type Battle, type BattleAction, battle, battleAction } from "@/drizzle/schema";
import { availableUserActions } from "@/libs/combat/actions";
import type { CompleteBattle } from "@/libs/combat/types";
import { checkEquipConstraints } from "@/libs/item";
import { extractToolsFromProcedures } from "@/libs/mcp/tools";
import { Pusher } from "@/libs/pusher";
import { combatRouter } from "@/server/api/routers/combat";
import type { DrizzleClient } from "@/server/db";
import { withAfterTasks } from "../../../../setup/after";
import {
  makeBattleUser,
  makeBattleUserItem,
  makeCompleteBattle,
  makeEffect,
  makeTag,
  makeWeapon,
} from "../../../../setup/combat";
import { resolverOf } from "../../../../setup/testDatabase";

type ActionInput = inferProcedureInput<typeof combatRouter.performAction>;

// Direct resolver calls have no HTTP response to defer the completion receipt behind.
const resolver = withAfterTasks(resolverOf(combatRouter.performAction));
const schema = combatRouter.performAction._def.inputs[0] as z.ZodType<ActionInput>;
const manual = {
  battleId: "version-battle",
  actionId: "wait",
  longitude: 0,
  latitude: 0,
};

describe("manual combat snapshot versions", () => {
  beforeEach(() => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([undefined, 2, 4])(
    "rejects manual version %s before processing the battle",
    async (version) => {
      const read = vi.fn(async () => ({
        version: 3,
        get usersState() {
          throw new Error("Rejected actions must not process battle state");
        },
      }));
      const write = vi.fn();
      const client = {
        query: { battle: { findFirst: read } },
        update: write,
        insert: write,
      } as unknown as DrizzleClient;
      const response = await act(client, { ...manual, version });
      expect(response).toEqual({
        updateClient: true,
        notification:
          version === undefined
            ? "Reload the page before choosing a battle action."
            : "Battle state changed. Choose your action again.",
      });
      expect(read).toHaveBeenCalledTimes(1);
      expect(write).not.toHaveBeenCalled();
      expect(Pusher.prototype.trigger).not.toHaveBeenCalled();
    },
  );

  it("commits a manual action against its displayed version with one battle read", async () => {
    const fixture = makeFight();
    const response = await act(fixture.client, { ...manual, version: 3 });
    expect(response, JSON.stringify(response)).toMatchObject({
      battleUpdate: { version: 4 },
    });
    expect(response.notification).toBeUndefined();
    expect(fixture.saved.activeUserId).toBe("opponent");
    expect(fixture.read).toHaveBeenCalledTimes(1);
    expect(fixture.write).toHaveBeenCalledTimes(1);
    expect(fixture.logs).toHaveLength(1);
  });

  it("executes the selected owned copy's Fortify and imbuement effects", async () => {
    const fixture = makeItemFight();
    const equipment = {
      itemId: "weapon-1",
      bloodlineId: null,
      itemType: "WEAPON",
      slot: "HAND",
      maxEquips: 2,
    };
    expect(
      checkEquipConstraints(equipment, [{ slot: "HAND_1", info: equipment }]),
    ).toBeNull();
    const actions = availableUserActions(fixture.saved, "player").filter(
      (action) => action.type === "item",
    );
    expect(actions.map((action) => action.userItemId)).toEqual(["first", "second"]);
    expect(actions.map((action) => action.effects[0]?.power)).toEqual([21, 25]);
    const selected = actions[1]!;
    const response = await act(fixture.client, {
      ...manual,
      version: fixture.saved.version,
      actionId: selected.id,
      userItemId: selected.userItemId,
    });
    expect(response.notification).toBeUndefined();
    const user = fixture.saved.usersState[0]!;
    expect(user.curHealth).toBe(1250);
    expect(user.curChakra).toBe(1070);
    expect(user.items.map((owned) => owned.quantity)).toEqual([2, 1]);
    expect(user.items.map((owned) => owned.durability)).toEqual([100, 97]);
    // Template cooldowns and usage tracking remain shared across owned copies.
    expect(user.items.map((owned) => owned.lastUsedRound)).toEqual([1, 1]);
    expect(user.usedActions).toContainEqual({ id: selected.id, type: "item" });
    expect(fixture.logs[0]?.actionId).toBe(selected.id);
    expect(fixture.read).toHaveBeenCalledTimes(1);
    expect(fixture.write).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, "missing", "other-player", "second"])(
    "rejects a missing or unavailable owned copy %s without using the first copy",
    async (userItemId) => {
      const fixture = makeItemFight();
      if (userItemId === "second")
        fixture.saved.usersState[0]!.items[1]!.equipped = "NONE";
      fixture.saved.usersState[1]!.items = [makeBattleUserItem({ id: "other-player" })];
      const response = await act(fixture.client, {
        ...manual,
        version: fixture.saved.version,
        actionId: "weapon-1",
        userItemId,
      });
      expect(response.notification).toBe(
        "Action not valid anymore. Try something else",
      );
      expect(fixture.saved.usersState[0]!.curHealth).toBe(1000);
      expect(fixture.read).toHaveBeenCalledTimes(1);
      expect(fixture.write).not.toHaveBeenCalled();
      expect(fixture.logs).toHaveLength(0);
    },
  );

  it("does not replay a manual action after another request wins its version claim", async () => {
    const fixture = makeFight();
    const responses = await Promise.all([
      act(fixture.client, { ...manual, version: 3 }),
      act(fixture.client, { ...manual, version: 3 }),
    ]);
    expect(responses.filter((response) => response.battleUpdate)).toHaveLength(1);
    expect(responses.filter((response) => response.notification)).toEqual([
      {
        updateClient: true,
        notification: "Battle state changed. Choose your action again.",
      },
    ]);
    expect(fixture.read).toHaveBeenCalledTimes(2);
    expect(fixture.write).toHaveBeenCalledTimes(2);
    expect(fixture.saved.version).toBe(4);
    expect(fixture.logs).toHaveLength(1);
  });

  it.each([undefined, 1])(
    "keeps actionless polling independent of client version %s",
    async (version) => {
      const fixture = makeFight();
      const response = await act(fixture.client, {
        battleId: manual.battleId,
        version,
      });
      expect(response).toMatchObject({
        updateClient: true,
        battleUpdate: { id: manual.battleId, version: 3, activeUserId: "player" },
        result: null,
        logEntries: [],
        updatedQuestIds: [],
      });
      expect(response.notification).toBeUndefined();
      expect(fixture.read).toHaveBeenCalledTimes(1);
      expect(fixture.write).not.toHaveBeenCalled();
      expect(fixture.logs).toHaveLength(0);
    },
  );

  it("reconciles an automatic tick that reaches the server after auto combat is disabled", async () => {
    const fixture = makeFight(true);
    let finishRead!: () => void;
    const reading = new Promise<void>((resolve) => {
      finishRead = resolve;
    });
    fixture.read.mockImplementationOnce(async () => {
      await reading;
      return structuredClone(fixture.saved);
    });
    const pending = act(fixture.client, { battleId: manual.battleId });
    // The toggle commits while the automatic tick is still in flight.
    fixture.saved.usersState[0]!.isAutoCombat = false;
    fixture.saved.version += 1;
    finishRead();
    const response = await pending;
    expect(response.notification).toBeUndefined();
    expect(response).toMatchObject({
      updateClient: true,
      battleUpdate: { version: 4, activeUserId: "player" },
      result: null,
      logEntries: [],
    });
    expect(
      response.battleUpdate?.usersState.find((user) => user.userId === "player")
        ?.isAutoCombat,
    ).toBe(false);
    expect(fixture.saved.version).toBe(4);
    expect(fixture.read).toHaveBeenCalledTimes(1);
    expect(fixture.write).not.toHaveBeenCalled();
    expect(fixture.logs).toHaveLength(0);
    expect(Pusher.prototype.trigger).not.toHaveBeenCalled();
  });

  it("advances autonomous combat without a client version", async () => {
    const fixture = makeFight(true);
    const response = await act(fixture.client, { battleId: manual.battleId });
    expect(response, JSON.stringify(response)).toMatchObject({
      battleUpdate: { version: 4 },
    });
    expect(response.notification).toBeUndefined();
    expect(fixture.read).toHaveBeenCalledTimes(1);
    expect(fixture.write).toHaveBeenCalledTimes(1);
    expect(fixture.logs).toHaveLength(1);
  });

  it("exposes the manual version requirement through MCP while allowing polling inputs", () => {
    const tool = extractToolsFromProcedures(combatRouter).find(
      (entry) => entry.pathInRouter.join(".") === "performAction",
    );
    expect(tool?.inputSchema.required).toEqual(["battleId"]);
    expect(tool?.inputSchema.properties?.version).toMatchObject({
      type: "integer",
      description: "Battle version from getBattle; required when actionId is provided",
    });
    expect(schema.parse({ battleId: manual.battleId })).toEqual({
      battleId: manual.battleId,
    });
  });
});

/** Run the actual action resolver and its input validator with an injected battle store. */
const act = (client: DrizzleClient, input: ActionInput) =>
  resolver({
    ctx: { drizzle: client, userId: "player", waitForRateLimit: async () => {} },
    input: schema.parse(input) as ActionInput,
    type: "mutation",
    path: "combat.performAction",
  });

/** Model independent battle snapshots and the guarded claim without mocking combat processing. */
const makeFight = (auto = false) => {
  const saved = makeCompleteBattle({
    id: manual.battleId,
    version: 3,
    activeUserId: "player",
    width: 13,
    height: 9,
    createdAt: new Date(),
    updatedAt: new Date(),
    roundStartAt: new Date(),
    usersState: [
      makeBattleUser("player", {
        controllerId: "player",
        initiative: 30,
        direction: "left",
        longitude: 0,
        isAutoCombat: auto,
        aiProfileId: "player-ai",
      }),
      makeBattleUser("opponent", {
        controllerId: "opponent",
        initiative: 10,
        direction: "right",
        longitude: 1,
      }),
    ],
    extraState: {
      settings: [],
      jutsus: {},
      items: {},
      bloodlines: {},
      villages: {},
      aiProfiles: {
        "player-ai": {
          id: "player-ai",
          userId: "player",
          jutsuLoadoutId: null,
          includeDefaultRules: false,
          rules: [],
        },
      },
    },
  });
  const logs: BattleAction[] = [];
  const read = vi.fn(async () => structuredClone(saved));
  const write = vi.fn(async (values: Partial<Battle>, where: SQL) => {
    const { params } = new MySqlDialect().sqlToQuery(where);
    expect(params).toEqual([manual.battleId, 3]);
    if (saved.version !== params[1]) return { rowsAffected: 0 };
    const { extraState, ...columns } = values;
    Object.assign(saved, structuredClone(columns));
    if (extraState) {
      const { params: changes } = new MySqlDialect().sqlToQuery(
        extraState as unknown as SQL,
      );
      for (let index = 0; index < changes.length; index += 2) {
        const key = String(changes[index]).slice(2);
        Object.assign(saved.extraState, {
          [key]: JSON.parse(String(changes[index + 1])),
        });
      }
    }
    return { rowsAffected: 1 };
  });
  const client = {
    query: { battle: { findFirst: read } },
    update: (table: unknown) => {
      expect(table).toBe(battle);
      return {
        set: (values: Partial<Battle>) => ({
          where: (where: SQL) => write(values, where),
        }),
      };
    },
    insert: (table: unknown) => {
      expect(table).toBe(battleAction);
      return {
        values: (values: BattleAction[]) => ({
          onDuplicateKeyUpdate: async () => {
            logs.push(...values);
          },
        }),
      };
    },
  } as unknown as DrizzleClient;
  return { saved: saved as CompleteBattle, logs, read, write, client };
};

/** Two legal hand-slot copies retain independent upgrades in the loaded battle state. */
const makeItemFight = () => {
  const fixture = makeFight();
  const player = fixture.saved.usersState[0]!;
  player.curHealth = 1000;
  player.curChakra = 1000;
  player.items = [1, 5].map((level, index) =>
    makeBattleUserItem({
      id: index === 0 ? "first" : "second",
      equipped: index === 0 ? "HAND_1" : "HAND_2",
      quantity: 2,
      originalCooldown: 2,
      fortification: { heal: { type: "heal", level, failures: 0 } },
      imbuementEffects: [
        makeEffect("heal", {
          power: index === 0 ? 2 : 7,
          calculation: "static",
          poolsAffected: ["Chakra"],
        }),
      ],
    }),
  );
  fixture.saved.extraState.items = {
    "weapon-1": makeWeapon({
      target: "SELF",
      maxEquips: 2,
      battleUsageType: "BOTH",
      actionCostPerc: 100,
      cooldown: 2,
      destroyOnUse: true,
      effects: [
        makeTag("heal", {
          power: 20,
          calculation: "static",
          fortifyId: "heal",
          fortifyEnabled: true,
        }),
      ],
    }),
  };
  return fixture;
};
