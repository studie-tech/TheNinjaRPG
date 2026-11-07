import { describe, expect, it } from "bun:test";
import type { VillageAlliance } from "@/drizzle/schema";
import type { UserWithRelations } from "@/routers/profile";
import { canAccessStructure, type SectorVillage } from "@/utils/village";

type User = NonNullable<UserWithRelations>;

const user = (villageId: string | null, sector: number | null) =>
  ({ villageId, village: sector === null ? null : { sector } }) as unknown as User;

const sectorVillage = (patch: {
  type?: string;
  allyAccess?: number;
  route?: string;
  status?: VillageAlliance["status"];
}) =>
  ({
    id: "host",
    sector: 10,
    type: patch.type ?? "VILLAGE",
    structures: [{ route: patch.route ?? "/bank", allyAccess: patch.allyAccess ?? 1 }],
    relationshipA: patch.status
      ? [{ villageIdA: "guest", villageIdB: "host", status: patch.status }]
      : [],
    relationshipB: [],
  }) as unknown as SectorVillage;

describe("canAccessStructure", () => {
  it("needs no village when no structure is requested", () => {
    expect(canAccessStructure(user("guest", 20))).toBe(true);
    expect(canAccessStructure(user("guest", 20), undefined, null)).toBe(true);
  });

  it("refuses a structure outside any village", () => {
    expect(canAccessStructure(user("guest", 20), "/bank")).toBe(false);
    expect(canAccessStructure(user("guest", 20), "/bank", null)).toBe(false);
  });

  it("refuses a structure the village does not have, even at home", () => {
    const village = sectorVillage({ route: "/hospital" });
    expect(canAccessStructure(user("host", 10), "/bank", village)).toBe(false);
  });

  it("opens every structure in the user's own village", () => {
    const village = sectorVillage({ allyAccess: 0, status: "ENEMY" });
    expect(canAccessStructure(user("host", 10), "/bank", village)).toBe(true);
  });

  it("opens safe zones to everyone, including users without a village", () => {
    const village = sectorVillage({ type: "SAFEZONE", allyAccess: 0 });
    expect(canAccessStructure(user("guest", 20), "/bank", village)).toBe(true);
    expect(canAccessStructure(user(null, null), "/bank", village)).toBe(true);
  });

  it("opens ally-accessible structures to allies only", () => {
    const allied = sectorVillage({ status: "ALLY" });
    expect(canAccessStructure(user("guest", 20), "/bank", allied)).toBe(true);
    const closed = sectorVillage({ status: "ALLY", allyAccess: 0 });
    expect(canAccessStructure(user("guest", 20), "/bank", closed)).toBe(false);
    for (const status of ["ENEMY", "NEUTRAL"] as const) {
      const village = sectorVillage({ status });
      expect(canAccessStructure(user("guest", 20), "/bank", village)).toBe(false);
    }
  });

  it("treats a user without a village as unrelated", () => {
    const village = sectorVillage({ status: "ALLY" });
    expect(canAccessStructure(user(null, null), "/bank", village)).toBe(false);
  });
});
