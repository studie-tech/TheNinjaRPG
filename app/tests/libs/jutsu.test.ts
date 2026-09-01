import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  JUTSU_MAX_BARRIER_EQUIPPED,
  JUTSU_MAX_EVENT_EQUIPPED,
  JUTSU_MAX_FORBIDDEN_EQUIPPED,
  JUTSU_MAX_HEAL_EQUIPPED,
  JUTSU_MAX_SHIELD_EQUIPPED,
} from "@/drizzle/constants";
import type { UserJutsuWithRelations } from "@/drizzle/schema";

// Stub the dependency decisions so these tests target the validator's own logic
// (ownership, hidden gate, equip caps, ordering) rather than canUseJutsu's
// requirement rules or the federal-tier equip-limit maths. The hidden-jutsu
// gate uses the real canChangeContent, since module mocks leak across test
// files under bun's test runner and would corrupt the permissions tests.
vi.mock("@/libs/train", () => ({
  canUseJutsu: vi.fn((jutsu: { usable?: boolean }) => jutsu?.usable !== false),
  calcJutsuEquipLimit: vi.fn(() => 100),
}));

import {
  computeJutsuLoadoutAssignments,
  computeJutsuLoadoutCapAssignments,
} from "@/libs/jutsu";
import type { UserWithRelations } from "@/routers/profile";
import { calcJutsuEquipLimit } from "@/libs/train";
import { getActivatedSkillIds, meetsRequiredSkill } from "@/libs/skillTree";

const calcJutsuEquipLimitMock = calcJutsuEquipLimit as unknown as {
  mockReturnValue: (value: number) => void;
  mockReturnValueOnce: (value: number) => void;
};

// Minimal user-jutsu factory; only the fields the validator reads are set. The
// extra `usable` flag is consumed by the canUseJutsu mock above.
const uj = (over: {
  jutsuId: string;
  name?: string;
  hidden?: boolean;
  usable?: boolean;
  jutsuType?: string;
  effectTypes?: string[];
  residual?: boolean;
  requiredSkillId?: string | null;
}): UserJutsuWithRelations =>
  ({
    jutsuId: over.jutsuId,
    jutsu: {
      name: over.name ?? over.jutsuId,
      hidden: over.hidden ?? false,
      usable: over.usable ?? true,
      jutsuType: over.jutsuType ?? "NORMAL",
      requiredSkillId: over.requiredSkillId ?? null,
      effects: [
        ...(over.effectTypes ?? []).map((type) => ({ type })),
        ...(over.residual ? [{ residualModifier: 1 }] : []),
      ],
    },
  }) as unknown as UserJutsuWithRelations;

const USER = { role: "USER" } as unknown as NonNullable<UserWithRelations>;

describe("required skill eligibility", () => {
  it("uses only activated skills and lets AI bypass the requirement", () => {
    const active = getActivatedSkillIds([
      { skillId: "active", activated: true },
      { skillId: "inactive", activated: false },
    ]);
    expect(meetsRequiredSkill(null, active)).toBe(true);
    expect(meetsRequiredSkill("active", active)).toBe(true);
    expect(meetsRequiredSkill("inactive", active)).toBe(false);
    expect(meetsRequiredSkill("inactive", active, true)).toBe(true);
  });
});

describe("computeJutsuLoadoutAssignments", () => {
  beforeEach(() => {
    calcJutsuEquipLimitMock.mockReturnValue(100);
  });

  it("equips all valid jutsu, preserving loadout order", () => {
    const userjutsus = [
      uj({ jutsuId: "a" }),
      uj({ jutsuId: "b" }),
      uj({ jutsuId: "c" }),
    ];
    const out = computeJutsuLoadoutAssignments({
      jutsuIds: ["c", "a", "b"],
      userjutsus,
      user: USER,
    });
    expect(out.equipIds).toEqual(["c", "a", "b"]);
    expect(out.invalidJutsus).toEqual([]);
  });

  it("reports a jutsu the user does not own and keeps the rest", () => {
    const userjutsus = [uj({ jutsuId: "a" })];
    const out = computeJutsuLoadoutAssignments({
      jutsuIds: ["a", "missing"],
      userjutsus,
      user: USER,
    });
    expect(out.equipIds).toEqual(["a"]);
    expect(out.invalidJutsus).toEqual(["Jutsu not found"]);
  });

  it("skips a hidden jutsu for a non-content user", () => {
    const userjutsus = [uj({ jutsuId: "h", name: "Hidden", hidden: true })];
    const out = computeJutsuLoadoutAssignments({
      jutsuIds: ["h"],
      userjutsus,
      user: USER,
    });
    expect(out.equipIds).toEqual([]);
    expect(out.invalidJutsus[0]).toMatch(/hidden/);
  });

  it("equips a hidden jutsu for a content admin", () => {
    const userjutsus = [uj({ jutsuId: "h", name: "Hidden", hidden: true })];
    const out = computeJutsuLoadoutAssignments({
      jutsuIds: ["h"],
      userjutsus,
      user: { role: "CONTENT-ADMIN" } as unknown as NonNullable<UserWithRelations>,
    });
    expect(out.equipIds).toEqual(["h"]);
    expect(out.invalidJutsus).toEqual([]);
  });

  it("skips a jutsu the user cannot use", () => {
    const userjutsus = [uj({ jutsuId: "x", name: "Locked", usable: false })];
    const out = computeJutsuLoadoutAssignments({
      jutsuIds: ["x"],
      userjutsus,
      user: USER,
    });
    expect(out.equipIds).toEqual([]);
    expect(out.invalidJutsus[0]).toMatch(/requirements/);
  });

  it("keeps only jutsus whose required skill is active", () => {
    const userjutsus = [
      uj({ jutsuId: "active", requiredSkillId: "skill-a" }),
      uj({ jutsuId: "inactive", requiredSkillId: "skill-b" }),
      uj({ jutsuId: "open" }),
    ];
    const out = computeJutsuLoadoutAssignments({
      jutsuIds: ["active", "inactive", "open"],
      userjutsus,
      user: USER,
      activatedSkillIds: new Set(["skill-a"]),
    });
    expect(out.equipIds).toEqual(["active", "open"]);
    expect(out.invalidJutsus).toEqual([
      "inactive: required skill is not active",
    ]);
  });

  it("enforces the total equip limit", () => {
    calcJutsuEquipLimitMock.mockReturnValueOnce(2);
    const userjutsus = [
      uj({ jutsuId: "a" }),
      uj({ jutsuId: "b" }),
      uj({ jutsuId: "c" }),
    ];
    const out = computeJutsuLoadoutAssignments({
      jutsuIds: ["a", "b", "c"],
      userjutsus,
      user: USER,
    });
    expect(out.equipIds).toEqual(["a", "b"]);
    expect(out.invalidJutsus[0]).toMatch(/equip limit/);
  });

  it("enforces the event-jutsu cap", () => {
    const count = JUTSU_MAX_EVENT_EQUIPPED + 1;
    const userjutsus = Array.from({ length: count }, (_, i) =>
      uj({ jutsuId: `e${i}`, name: `Event ${i}`, jutsuType: "EVENT" }),
    );
    const out = computeJutsuLoadoutAssignments({
      jutsuIds: userjutsus.map((j) => j.jutsuId),
      userjutsus,
      user: USER,
    });
    expect(out.equipIds).toHaveLength(JUTSU_MAX_EVENT_EQUIPPED);
    expect(out.invalidJutsus[0]).toMatch(/event/);
  });

  it("enforces the forbidden-jutsu cap", () => {
    const count = JUTSU_MAX_FORBIDDEN_EQUIPPED + 1;
    const userjutsus = Array.from({ length: count }, (_, i) =>
      uj({ jutsuId: `f${i}`, name: `Forbidden ${i}`, jutsuType: "FORBIDDEN" }),
    );
    const out = computeJutsuLoadoutAssignments({
      jutsuIds: userjutsus.map((j) => j.jutsuId),
      userjutsus,
      user: USER,
    });
    expect(out.equipIds).toHaveLength(JUTSU_MAX_FORBIDDEN_EQUIPPED);
    expect(out.invalidJutsus[0]).toMatch(/forbidden/);
  });

  it("deduplicates repeated jutsuIds so they do not double-count toward caps", () => {
    calcJutsuEquipLimitMock.mockReturnValueOnce(2);
    const userjutsus = [uj({ jutsuId: "a" }), uj({ jutsuId: "b" })];
    const out = computeJutsuLoadoutAssignments({
      jutsuIds: ["a", "a", "b"],
      userjutsus,
      user: USER,
    });
    // Without dedup the second "a" would consume the second slot and falsely
    // reject "b" with an equip-limit warning.
    expect(out.equipIds).toEqual(["a", "b"]);
    expect(out.invalidJutsus).toEqual([]);
  });

  it("enforces the barrier-jutsu cap", () => {
    const count = JUTSU_MAX_BARRIER_EQUIPPED + 1;
    const userjutsus = Array.from({ length: count }, (_, i) =>
      uj({ jutsuId: `b${i}`, name: `Barrier ${i}`, effectTypes: ["barrier"] }),
    );
    const out = computeJutsuLoadoutAssignments({
      jutsuIds: userjutsus.map((j) => j.jutsuId),
      userjutsus,
      user: USER,
    });
    expect(out.equipIds).toHaveLength(JUTSU_MAX_BARRIER_EQUIPPED);
    expect(out.invalidJutsus[0]).toMatch(/barrier/);
  });

  it("enforces the shield-jutsu cap", () => {
    const count = JUTSU_MAX_SHIELD_EQUIPPED + 1;
    const userjutsus = Array.from({ length: count }, (_, i) =>
      uj({ jutsuId: `s${i}`, name: `Shield ${i}`, effectTypes: ["shield"] }),
    );
    const out = computeJutsuLoadoutAssignments({
      jutsuIds: userjutsus.map((j) => j.jutsuId),
      userjutsus,
      user: USER,
    });
    expect(out.equipIds).toHaveLength(JUTSU_MAX_SHIELD_EQUIPPED);
    expect(out.invalidJutsus[0]).toMatch(/shield/);
  });

  it("enforces the heal-jutsu cap", () => {
    const count = JUTSU_MAX_HEAL_EQUIPPED + 1;
    const userjutsus = Array.from({ length: count }, (_, i) =>
      uj({ jutsuId: `h${i}`, name: `Heal ${i}`, effectTypes: ["heal"] }),
    );
    const out = computeJutsuLoadoutAssignments({
      jutsuIds: userjutsus.map((j) => j.jutsuId),
      userjutsus,
      user: USER,
    });
    expect(out.equipIds).toHaveLength(JUTSU_MAX_HEAL_EQUIPPED);
    expect(out.invalidJutsus[0]).toMatch(/heal/);
  });
});

describe("computeJutsuLoadoutCapAssignments", () => {
  it("enforces heal caps for callers without a full profile user", () => {
    const count = JUTSU_MAX_HEAL_EQUIPPED + 1;
    const userjutsus = Array.from({ length: count }, (_, i) =>
      uj({ jutsuId: `combat-heal-${i}`, effectTypes: ["heal"] }),
    );

    const out = computeJutsuLoadoutCapAssignments({
      jutsuIds: userjutsus.map((entry) => entry.jutsuId),
      userjutsus,
      maxEquip: 100,
    });

    expect(out.equipIds).toHaveLength(JUTSU_MAX_HEAL_EQUIPPED);
    expect(out.invalidJutsus).toHaveLength(1);
    expect(out.invalidJutsus[0]).toMatch(/heal/);
  });

  it("applies caller eligibility before consuming equip capacity", () => {
    const userjutsus = [uj({ jutsuId: "blocked" }), uj({ jutsuId: "allowed" })];

    const out = computeJutsuLoadoutCapAssignments({
      jutsuIds: userjutsus.map((entry) => entry.jutsuId),
      userjutsus,
      maxEquip: 1,
      validateJutsu: (entry) =>
        entry.jutsuId === "blocked" ? "required item missing" : undefined,
    });

    expect(out.equipIds).toEqual(["allowed"]);
    expect(out.invalidJutsus).toEqual(["required item missing"]);
  });
});
