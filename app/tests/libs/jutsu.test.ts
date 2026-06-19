import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  JUTSU_MAX_BARRIER_EQUIPPED,
  JUTSU_MAX_EVENT_EQUIPPED,
} from "@/drizzle/constants";
import type { UserJutsuWithRelations } from "@/drizzle/schema";

// Stub the dependency decisions so these tests target the validator's own logic
// (ownership, hidden gate, equip caps, ordering) rather than canUseJutsu's
// requirement rules or the federal-tier equip-limit maths.
vi.mock("@/libs/train", () => ({
  canUseJutsu: vi.fn((jutsu: { usable?: boolean }) => jutsu?.usable !== false),
  calcJutsuEquipLimit: vi.fn(() => 100),
}));
vi.mock("@/utils/permissions", () => ({
  canChangeContent: vi.fn((role: string) => role === "CONTENT-ADMIN"),
}));

import { computeJutsuLoadoutAssignments } from "@/libs/jutsu";
import type { UserWithRelations } from "@/routers/profile";
import { canChangeContent } from "@/utils/permissions";
import { calcJutsuEquipLimit } from "@/libs/train";

const calcJutsuEquipLimitMock = calcJutsuEquipLimit as unknown as {
  mockReturnValue: (value: number) => void;
  mockReturnValueOnce: (value: number) => void;
};
const canChangeContentMock = canChangeContent as unknown as {
  mockImplementation: (fn: (role: string) => boolean) => void;
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
}): UserJutsuWithRelations =>
  ({
    jutsuId: over.jutsuId,
    jutsu: {
      name: over.name ?? over.jutsuId,
      hidden: over.hidden ?? false,
      usable: over.usable ?? true,
      jutsuType: over.jutsuType ?? "NORMAL",
      effects: [
        ...(over.effectTypes ?? []).map((type) => ({ type })),
        ...(over.residual ? [{ residualModifier: 1 }] : []),
      ],
    },
  }) as unknown as UserJutsuWithRelations;

const USER = { role: "USER" } as unknown as NonNullable<UserWithRelations>;

describe("computeJutsuLoadoutAssignments", () => {
  beforeEach(() => {
    calcJutsuEquipLimitMock.mockReturnValue(100);
    canChangeContentMock.mockImplementation((role) => role === "CONTENT-ADMIN");
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
});
