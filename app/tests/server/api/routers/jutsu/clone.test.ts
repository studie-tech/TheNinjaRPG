import { describe, expect, it, vi } from "bun:test";
import { actionLog, jutsu } from "@/drizzle/schema";
import { jutsuRouter } from "@/server/api/routers/jutsu";
import { resolverOf } from "../../../../setup/testDatabase";

const source = {
  id: "source",
  name: "Fireball",
  description: "A fire technique",
  battleDescription: "%user uses %jutsu",
  image: "/fireball.webp",
  effects: [{ type: "damage", power: 12 }],
  chakraCost: 0.2,
  requiredLevel: 10,
  requiredSkillId: "skill",
  bloodlineId: "bloodline",
  parentJutsuId: "parent",
  reskinParentJutsuId: null,
  bloodlineReskinId: null,
  hidden: false,
  createdAt: new Date("2020-01-01"),
  updatedAt: new Date("2020-01-01"),
};

const setup = (
  row: object | null = source,
  user = { role: "CONTENT", isBanned: false },
) => {
  const values = vi.fn(async (_row: Record<string, unknown>) => ({ rowsAffected: 1 }));
  const logValues = vi.fn(async (_row: Record<string, unknown>) => ({ rowsAffected: 1 }));
  const insert = vi.fn((table: object) => ({
    values: table === actionLog ? logValues : values,
  }));
  const resolver = resolverOf(jutsuRouter.clone);
  const clone = () =>
    resolver({
      ctx: {
        userId: "staff",
        drizzle: {
          query: {
            userData: { findFirst: async () => user },
            jutsu: { findFirst: async () => row },
          },
          insert,
          transaction: async (callback: (tx: object) => Promise<unknown>) =>
            callback({ insert }),
        },
      },
      input: { id: source.id },
    });
  return { clone, insert, values, logValues };
};

describe("jutsu.clone", () => {
  it("copies content into a hidden independent jutsu without changing the source", async () => {
    const original = structuredClone(source);
    const { clone, insert, values } = setup();
    const result = await clone();
    expect(result.success).toBe(true);
    expect(result.message).not.toBe(source.id);
    expect(insert).toHaveBeenCalledWith(jutsu);
    expect(values).toHaveBeenCalledWith({
      ...source,
      id: result.message,
      name: `Fireball - copy ${result.message}`,
      hidden: true,
      parentJutsuId: null,
      reskinParentJutsuId: null,
      bloodlineReskinId: null,
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
    expect(values.mock.calls[0]?.[0].createdAt).not.toEqual(source.createdAt);
    expect(source).toEqual(original);
  });

  it("clears linked reskin membership while preserving its copied mechanics", async () => {
    const { clone, values } = setup({
      ...source,
      parentJutsuId: null,
      reskinParentJutsuId: "mechanics-parent",
      bloodlineReskinId: "reskin-group",
      jutsuRank: "H",
    });
    expect((await clone()).success).toBe(true);
    expect(values.mock.calls[0]?.[0]).toMatchObject({
      reskinParentJutsuId: null,
      bloodlineReskinId: null,
      jutsuRank: "H",
      effects: source.effects,
    });
  });

  it("records the actor, source and new jutsu in the audit log", async () => {
    const { clone, logValues } = setup();
    const result = await clone();
    expect(logValues).toHaveBeenCalledTimes(1);
    expect(logValues).toHaveBeenCalledWith({
      id: expect.any(String),
      userId: "staff",
      tableName: "jutsu",
      relatedId: result.message,
      changes: ["Cloned from Fireball"],
      relatedMsg: `Clone: Fireball - copy ${result.message}`,
      relatedImage: source.image,
    });
  });

  it("does not log a clone whose insert failed", async () => {
    const { clone, values, logValues } = setup();
    values.mockRejectedValueOnce(new Error("Insert failed"));
    await expect(clone()).rejects.toThrow("Insert failed");
    expect(logValues).not.toHaveBeenCalled();
  });

  it("supports repeated clones of a maximum-length name", async () => {
    const { clone, values } = setup({ ...source, name: "a".repeat(191) });
    const first = await clone();
    const second = await clone();
    expect(first.message).not.toBe(second.message);
    const names = values.mock.calls.map(([row]) => row.name as string);
    expect(names[0]).not.toBe(names[1]);
    expect(names.every((name) => name.length <= 191 && name.includes(" - copy "))).toBe(true);
  });

  it.each([
    { role: "USER", isBanned: false },
    { role: "MODERATOR", isBanned: false },
    { role: "CONTENT", isBanned: true },
  ])("rejects unauthorized staff or banned accounts: %j", async (user) => {
    const { clone, insert } = setup(source, user);
    expect((await clone()).success).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it("returns a recoverable rejection when the source was deleted", async () => {
    const { clone, insert } = setup(null);
    expect(await clone()).toEqual({ success: false, message: "Jutsu not found" });
    expect(insert).not.toHaveBeenCalled();
  });
});
