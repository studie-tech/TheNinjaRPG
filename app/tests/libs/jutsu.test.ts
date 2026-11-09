import { unrankedCaps as caps } from "../setup/jutsuEquipLimits";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";

import type { UserJutsuWithRelations } from "@/drizzle/schema";

import {
  canEquipUnderCaps,
  computeJutsuLoadoutAssignments,
  computeJutsuLoadoutCapAssignments,
  computeJutsuLoadoutPreview,
  countEquippedByCap,
  findExceededJutsuEquipCap,
  getJutsuCapFlags,
} from "@/libs/jutsu";
import type { UserWithRelations } from "@/routers/profile";
import * as jutsuRequirements from "@/libs/jutsuRequirements";

let calcJutsuEquipLimitMock: {
  mockReturnValue: (value: number) => void;
  mockReturnValueOnce: (value: number) => void;
};

// Restore dependency spies between tests: Bun shares modules with requirement suites.
beforeEach(() => {
  vi.spyOn(jutsuRequirements, "canUseJutsu").mockImplementation(
    (jutsu) => (jutsu as typeof jutsu & { usable?: boolean })?.usable !== false,
  );
  calcJutsuEquipLimitMock = vi
    .spyOn(jutsuRequirements, "calcJutsuEquipLimit")
    .mockReturnValue(100);
});
afterEach(() => vi.restoreAllMocks());

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

describe("jutsu loadout sharing preview", () => {
  it("returns ordered accepted entries and every exclusion category without revealing hidden names", () => {
    calcJutsuEquipLimitMock.mockReturnValue(1);
    const owned = [
      uj({ jutsuId: "hidden", name: "Secret", hidden: true }),
      uj({ jutsuId: "gated", usable: false }),
      uj({ jutsuId: "b" }),
      uj({ jutsuId: "a" }),
    ];
    const result = computeJutsuLoadoutPreview({
      caps,
      jutsuIds: ["deleted", "hidden", "not-owned", "gated", "b", "a", "b"],
      userjutsus: owned,
      user: USER,
      content: [
        ...owned.map((entry) => ({
          id: entry.jutsuId,
          name: entry.jutsu.name,
          hidden: entry.jutsu.hidden,
        })),
        { id: "not-owned", name: "Unlearned", hidden: false },
      ],
    });
    expect(result.jutsuIds).toEqual(["b"]);
    expect(
      result.entries.map((entry) => [entry.jutsuId, entry.accepted, entry.reason]),
    ).toEqual([
      ["deleted", false, "unavailable"],
      ["hidden", false, "unavailable"],
      ["not-owned", false, "not-owned"],
      ["gated", false, "requirements"],
      ["b", true, null],
      ["a", false, "equip-limit"],
    ]);
    expect(result.entries[1]?.name).toBe("Unavailable jutsu");
    expect(JSON.stringify(result)).not.toContain("Secret");
    expect(result.entries[2]?.name).toBe("Unlearned");
  });

  it("reports category caps and keeps later eligible entries", () => {
    const heals = Array.from({ length: 3 + 1 }, (_, index) =>
      uj({ jutsuId: `heal-${index}`, effectTypes: ["heal"] }),
    );
    const owned = [...heals, uj({ jutsuId: "normal" })];
    const result = computeJutsuLoadoutPreview({
      caps,
      jutsuIds: owned.map((entry) => entry.jutsuId),
      userjutsus: owned,
      user: USER,
      content: owned.map((entry) => ({
        id: entry.jutsuId,
        name: entry.jutsu.name,
        hidden: false,
      })),
    });
    expect(result.jutsuIds).toEqual([
      ...heals.slice(0, 3).map((entry) => entry.jutsuId),
      "normal",
    ]);
    expect(result.entries[3]).toMatchObject({ accepted: false, reason: "equip-limit" });
  });
});

describe("computeJutsuLoadoutAssignments", () => {
  it("equips all valid jutsu, preserving loadout order", () => {
    const userjutsus = [
      uj({ jutsuId: "a" }),
      uj({ jutsuId: "b" }),
      uj({ jutsuId: "c" }),
    ];
    const out = computeJutsuLoadoutAssignments({
      caps,
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
      caps,
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
      caps,
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
      caps,
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
      caps,
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
      caps,
      jutsuIds: ["a", "b", "c"],
      userjutsus,
      user: USER,
    });
    expect(out.equipIds).toEqual(["a", "b"]);
    expect(out.invalidJutsus[0]).toMatch(/equip limit/);
  });

  it.each<
    [
      kind: string,
      cap: number,
      prefix: string,
      marker: { jutsuType?: string; effectTypes?: string[] },
    ]
  >([
    ["event", 2, "e", { jutsuType: "EVENT" }],
    ["forbidden", 1, "f", { jutsuType: "FORBIDDEN" }],
    ["barrier", 1, "b", { effectTypes: ["barrier"] }],
    ["shield", 2, "s", { effectTypes: ["shield"] }],
    ["heal", 3, "h", { effectTypes: ["heal"] }],
  ])("enforces the %s-jutsu cap", (kind, cap, prefix, marker) => {
    const name = `${kind[0]!.toUpperCase()}${kind.slice(1)}`;
    const userjutsus = Array.from({ length: cap + 1 }, (_, i) =>
      uj({ jutsuId: `${prefix}${i}`, name: `${name} ${i}`, ...marker }),
    );
    const out = computeJutsuLoadoutAssignments({
      caps,
      jutsuIds: userjutsus.map((j) => j.jutsuId),
      userjutsus,
      user: USER,
    });
    expect(out.equipIds).toHaveLength(cap);
    expect(out.invalidJutsus[0]).toMatch(new RegExp(kind));
  });

  it("deduplicates repeated jutsuIds so they do not double-count toward caps", () => {
    calcJutsuEquipLimitMock.mockReturnValueOnce(2);
    const userjutsus = [uj({ jutsuId: "a" }), uj({ jutsuId: "b" })];
    const out = computeJutsuLoadoutAssignments({
      caps,
      jutsuIds: ["a", "a", "b"],
      userjutsus,
      user: USER,
    });
    // Without dedup the second "a" would consume the second slot and falsely
    // reject "b" with an equip-limit warning.
    expect(out.equipIds).toEqual(["a", "b"]);
    expect(out.invalidJutsus).toEqual([]);
  });
});

describe("computeJutsuLoadoutCapAssignments", () => {
  it("keeps only the first Parry jutsu while preserving other selections", () => {
    const userjutsus = [
      uj({ jutsuId: "first", effectTypes: ["parry"] }),
      uj({ jutsuId: "second", effectTypes: ["parry"] }),
      uj({ jutsuId: "normal" }),
    ];
    const args = {
      jutsuIds: ["second", "second", "first", "normal"],
      userjutsus,
    };
    const expected = {
      equipIds: ["second", "normal"],
      invalidJutsus: ["first: parry jutsu limit reached"],
    };

    expect(computeJutsuLoadoutCapAssignments({ caps, ...args, maxEquip: 100 })).toEqual(
      expected,
    );
    expect(computeJutsuLoadoutAssignments({ caps, ...args, user: USER })).toEqual(
      expected,
    );
    const preview = computeJutsuLoadoutPreview({
      caps,
      ...args,
      user: USER,
      content: userjutsus.map((entry) => ({
        id: entry.jutsuId,
        name: entry.jutsu.name,
        hidden: false,
      })),
    });
    expect(preview.jutsuIds).toEqual(expected.equipIds);
    expect(preview.entries[1]).toMatchObject({
      jutsuId: "first",
      accepted: false,
      reason: "equip-limit",
      message: "parry jutsu limit reached",
    });
  });

  it("blocks equipping another Parry jutsu until the equipped one is removed", () => {
    const first = uj({ jutsuId: "first", effectTypes: ["parry"] });
    const flags = getJutsuCapFlags(
      uj({ jutsuId: "second", effectTypes: ["parry"] }).jutsu,
    );
    const counts = countEquippedByCap([first], caps);

    expect(canEquipUnderCaps(flags, counts, caps)).toBe(false);
    expect(findExceededJutsuEquipCap(flags, counts, caps)).toMatchObject({
      key: "parry",
      label: "parry",
      max: 1,
    });
    expect(canEquipUnderCaps(flags, countEquippedByCap([], caps), caps)).toBe(true);
    expect(
      canEquipUnderCaps(
        getJutsuCapFlags(uj({ jutsuId: "normal" }).jutsu),
        counts,
        caps,
      ),
    ).toBe(true);
  });

  it("enforces heal caps for callers without a full profile user", () => {
    const count = 3 + 1;
    const userjutsus = Array.from({ length: count }, (_, i) =>
      uj({ jutsuId: `combat-heal-${i}`, effectTypes: ["heal"] }),
    );

    const out = computeJutsuLoadoutCapAssignments({
      caps,
      jutsuIds: userjutsus.map((entry) => entry.jutsuId),
      userjutsus,
      maxEquip: 100,
    });

    expect(out.equipIds).toHaveLength(3);
    expect(out.invalidJutsus).toHaveLength(1);
    expect(out.invalidJutsus[0]).toMatch(/heal/);
  });

  it("applies caller eligibility before consuming equip capacity", () => {
    const userjutsus = [uj({ jutsuId: "blocked" }), uj({ jutsuId: "allowed" })];

    const out = computeJutsuLoadoutCapAssignments({
      caps,
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
