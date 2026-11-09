import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { jutsuLoadout, userJutsu } from "@/drizzle/schema";
import { FED_JUTSU_LOADOUTS_BASE } from "@/drizzle/constants";
import { exportJutsuLoadout } from "@/libs/loadout";
import * as jutsuRequirements from "@/libs/jutsuRequirements";
import { jutsuRouter } from "@/server/api/routers/jutsu";
import { resetServerModuleStubs, stubProfile } from "../../../../setup/serverModules";
import { callerForDatabase } from "../../../../setup/testDatabase";

/** Exercise resolver guards with deterministic fixture reads and observable attempted writes. */
const setup = () => {
  const user = {
    userId: "recipient",
    role: "USER",
    federalStatus: "GOLD",
    staffAccount: false,
    jutsuLoadout: "active",
    items: [],
    titles: [],
    userSkills: [],
  };
  const loadouts = [
    {
      id: "active",
      userId: user.userId,
      name: "Keep this name",
      jutsuIds: ["old"],
      createdAt: new Date(0),
    },
    {
      id: "inactive",
      userId: user.userId,
      name: "Other",
      jutsuIds: ["old"],
      createdAt: new Date(1),
    },
  ];
  const owned = ["a", "b", "old"].map((id) => ({
    UserJutsu: {
      id: `inventory-${id}`,
      userId: user.userId,
      jutsuId: id,
      level: 10,
      equipped: id === "old",
      reskinId: null,
    },
    Jutsu: {
      id,
      name: id,
      hidden: false,
      effects: [],
      jutsuType: "NORMAL",
      parentJutsuId: null,
    },
    Bloodline: null,
    JutsuReskin: null,
    parentJutsu: null,
  }));
  stubProfile("fetchUpdatedUser", (async () => ({ user })) as never);
  const execute = vi.fn(async (_query: unknown) => ({ rowsAffected: 1 }));
  const confirm = vi.fn(
    async (): Promise<Array<{ id: string; jutsuId: string | null }>> =>
      owned
        .filter((entry) => entry.UserJutsu.equipped)
        .map((entry) => ({ id: "active", jutsuId: entry.UserJutsu.jutsuId })),
  );
  const database = {
    query: {
      jutsuLoadout: { findMany: async () => loadouts },
      jutsu: { findMany: async () => owned.map((entry) => entry.Jutsu) },
    },
    select: () => {
      let source: unknown;
      const builder = {
        from: (table: unknown) => {
          source = table;
          return builder;
        },
        innerJoin: (..._args: unknown[]) => builder,
        leftJoin: (..._args: unknown[]) => builder,
        where: (..._args: unknown[]) => builder,
        orderBy: (..._args: unknown[]) => builder,
        limit: (..._args: unknown[]) => builder,
        then: (resolve: (rows: unknown[]) => unknown) =>
          (source === jutsuLoadout
            ? confirm()
            : Promise.resolve(source === userJutsu ? owned : [])
          ).then(resolve),
      };
      return builder;
    },
    execute,
  };
  type Result = {
    success: boolean;
    message: string;
    preview?: { token: string; jutsuIds: string[] };
  };
  /** Invoke the actual procedure with this fixture's user and database. */
  const call = (
    name: "previewJutsuLoadout" | "importJutsuLoadout",
    input: { loadoutId: string; text: string; previewToken?: string },
  ) => {
    return callerForDatabase(jutsuRouter, user.userId, database as never)[name](
      input as never,
    ) as Promise<Result>;
  };
  const input = { loadoutId: "active", text: exportJutsuLoadout(["b", "a"]) };
  /** Obtain the actual resolver's fingerprint rather than constructing one in the test. */
  const preview = async (request = input) => {
    const result = await call("previewJutsuLoadout", request);
    expect(result.success).toBe(true);
    if (!result.preview) throw new Error("Preview missing");
    return { ...request, previewToken: result.preview.token };
  };
  return { user, loadouts, owned, execute, confirm, call, input, preview };
};

beforeEach(() => {
  vi.spyOn(jutsuRequirements, "calcJutsuEquipLimit").mockReturnValue(10);
  vi.spyOn(jutsuRequirements, "canUseJutsu").mockReturnValue(true);
});
afterEach(() => {
  resetServerModuleStubs();
  vi.restoreAllMocks();
});

describe("ordinary jutsu loadout sharing endpoints", () => {
  it("previews without writing and keeps order", async () => {
    const test = setup();
    const result = await test.call("previewJutsuLoadout", test.input);
    expect(result.preview?.jutsuIds).toEqual(["b", "a"]);
    expect(test.execute).not.toHaveBeenCalled();
  });

  it("rejects malformed text as a recoverable outcome", async () => {
    const test = setup();
    expect(
      (await test.call("previewJutsuLoadout", { ...test.input, text: "invalid" }))
        .success,
    ).toBe(false);
    expect(test.execute).not.toHaveBeenCalled();
  });

  it("rejects a foreign or no longer allowed destination", async () => {
    const test = setup();
    expect(
      (
        await test.call("previewJutsuLoadout", {
          ...test.input,
          loadoutId: "someone-else",
        })
      ).success,
    ).toBe(false);
    test.user.federalStatus = "NONE";
    while (test.loadouts.length <= FED_JUTSU_LOADOUTS_BASE) {
      test.loadouts.push({ ...test.loadouts[0]!, id: `extra-${test.loadouts.length}` });
    }
    expect(
      (
        await test.call("previewJutsuLoadout", {
          ...test.input,
          loadoutId: test.loadouts[FED_JUTSU_LOADOUTS_BASE]!.id,
        })
      ).success,
    ).toBe(false);
    expect(test.execute).not.toHaveBeenCalled();
  });

  it("allows importing when only one destination exists", async () => {
    const test = setup();
    test.user.federalStatus = "NONE";
    test.loadouts.splice(1);
    expect((await test.call("importJutsuLoadout", await test.preview())).success).toBe(
      true,
    );
    expect(test.execute).toHaveBeenCalledTimes(1);
  });

  it.each(["active", "inactive"])(
    "submits one atomic replacement for %s",
    async (loadoutId) => {
      const test = setup();
      const original = structuredClone(test.owned);
      const input = await test.preview({ ...test.input, loadoutId });
      expect((await test.call("importJutsuLoadout", input)).success).toBe(true);
      expect(test.execute).toHaveBeenCalledTimes(1);
      expect(test.loadouts.find((entry) => entry.id === loadoutId)?.name).toBe(
        loadoutId === "active" ? "Keep this name" : "Other",
      );
      expect(test.owned).toEqual(original);
    },
  );

  it("leaves the destination unchanged when nothing is usable", async () => {
    const test = setup();
    const input = await test.preview({
      ...test.input,
      text: exportJutsuLoadout(["unknown"]),
    });
    const result = await test.call("importJutsuLoadout", input);
    expect(result.success).toBe(false);
    expect(result.message).toContain("No usable");
    expect(test.execute).not.toHaveBeenCalled();
  });

  it.each(["eligibility", "destination", "active selection"])(
    "requires a new preview after changed %s",
    async (change) => {
      const test = setup();
      const input = await test.preview();
      if (change === "eligibility")
        vi.spyOn(jutsuRequirements, "canUseJutsu").mockReturnValue(false);
      if (change === "destination") test.loadouts[0]!.jutsuIds = ["concurrent-edit"];
      if (change === "active selection") test.user.jutsuLoadout = "inactive";
      const result = await test.call("importJutsuLoadout", input);
      expect(result.success).toBe(false);
      expect(result.message).toContain("Preview again");
      expect(test.execute).not.toHaveBeenCalled();
    },
  );

  it("reports a lost write guard without claiming success", async () => {
    const test = setup();
    const input = await test.preview();
    test.execute.mockResolvedValue({ rowsAffected: 0 });
    const result = await test.call("importJutsuLoadout", input);
    expect(result.success).toBe(false);
    expect(result.message).toContain("Preview again");
  });

  it.each(["active", "inactive"])(
    "confirms an unchanged %s loadout without writing",
    async (loadoutId) => {
      const test = setup();
      const input = await test.preview({
        loadoutId,
        text: exportJutsuLoadout(["old"]),
      });
      const result = await test.call("importJutsuLoadout", input);
      expect(result).toEqual({ success: true, message: "Loadout already matches" });
      expect(test.confirm).toHaveBeenCalledTimes(1);
      expect(test.execute).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["changed snapshot", []],
    ["missing equipment", [{ id: "active", jutsuId: null }]],
    ["replaced equipment", [{ id: "active", jutsuId: "a" }]],
    [
      "extra equipment",
      [
        { id: "active", jutsuId: "old" },
        { id: "active", jutsuId: "a" },
      ],
    ],
  ])("requires a new preview for a no-op with %s", async (_change, current) => {
    const test = setup();
    const input = await test.preview({
      ...test.input,
      text: exportJutsuLoadout(["old"]),
    });
    test.confirm.mockResolvedValue(current);
    const result = await test.call("importJutsuLoadout", input);
    expect(result.success).toBe(false);
    expect(result.message).toContain("Preview again");
    expect(test.confirm).toHaveBeenCalledTimes(1);
    expect(test.execute).not.toHaveBeenCalled();
  });
});
