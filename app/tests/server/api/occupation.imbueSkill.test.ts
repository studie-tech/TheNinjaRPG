// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { CRAFTING_REQUIRED_EXP } from "@/drizzle/constants";
import { occupationRouter } from "@/server/api/routers/occupation";
import { resetServerModuleStubs, stubProfile } from "../../setup/serverModules";

afterEach(() => {
  resetServerModuleStubs();
  vi.restoreAllMocks();
});

describe("imbuement crystal skill requirement", () => {
  it.each([
    { name: "missing skill", requiredSkillId: "skill-s", skills: [], allowed: false },
    {
      name: "inactive skill",
      requiredSkillId: "skill-s",
      skills: [{ skillId: "skill-s", activated: false }],
      allowed: false,
    },
    {
      name: "different active skill",
      requiredSkillId: "skill-s",
      skills: [{ skillId: "skill-other", activated: true }],
      allowed: false,
    },
    {
      name: "required active skill",
      requiredSkillId: "skill-s",
      skills: [{ skillId: "skill-s", activated: true }],
      allowed: true,
    },
    { name: "unrestricted crystal", requiredSkillId: null, skills: [], allowed: true },
  ])("checks $name before any writes", async ({ requiredSkillId, skills, allowed }) => {
    stubProfile("fetchUpdatedUser", async () => ({
      user: {
        userId: "crafter",
        status: "AWAKE",
        sector: null,
        occupation: "CRAFTING",
          craftingExperience: CRAFTING_REQUIRED_EXP.MASTER,
        updatedAt: new Date(),
      },
    }));
    const items = [
      {
        id: "host",
        quantity: 1,
        equipped: "NONE",
        imbuements: [],
        item: {
          id: "host-item",
          itemType: "WEAPON",
          canBeImbued: true,
          maxImbueNumber: 1,
          requiredSkillId: null,
        },
      },
      {
        id: "crystal",
        quantity: 2,
        imbuements: [],
        item: {
          id: "crystal-item",
          itemType: "CRYSTAL",
          rarity: "COMMON",
          requiredSkillId,
        },
      },
    ];
    // Stop authorized requests at the existing CAS boundary; no crystal is consumed.
    const write = vi.fn().mockResolvedValue({ rowsAffected: 0 });
    const drizzle = {
      query: {
        userItem: { findMany: vi.fn().mockResolvedValue(items) },
        userSkill: { findMany: vi.fn().mockResolvedValue(skills) },
        skillTree: {
          findFirst: vi.fn().mockResolvedValue({ name: "Crystal Mastery" }),
        },
      },
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: write })) })),
      insert: vi.fn(),
      delete: vi.fn(),
    };
    const { resolver } = occupationRouter.imbueItem._def as unknown as {
      resolver: (options: {
        ctx: { drizzle: object; userId: string };
        input: { userItemId: string; userCrystalItemId: string };
      }) => Promise<unknown>;
    };
    const result = await resolver({
      ctx: { drizzle, userId: "crafter" },
      input: { userItemId: "host", userCrystalItemId: "crystal" },
    });
    expect(result).toMatchObject({
      success: false,
      message: allowed
        ? "Could not start imbuing — state changed, please try again"
        : "Requires active skill: Crystal Mastery",
    });
    expect(drizzle.update).toHaveBeenCalledTimes(allowed ? 1 : 0);
    expect(drizzle.query.skillTree.findFirst).toHaveBeenCalledTimes(allowed ? 0 : 1);
    expect(drizzle.insert).not.toHaveBeenCalled();
    expect(drizzle.delete).not.toHaveBeenCalled();
  });
});
