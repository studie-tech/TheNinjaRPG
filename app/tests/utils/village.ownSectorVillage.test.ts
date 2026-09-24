import { describe, expect, it } from "vitest";
import type { UserWithRelations } from "@/routers/profile";
import { getOwnSectorVillage } from "@/utils/village";

const makeUser = (
  overrides: { isOutlaw?: boolean; sector?: number } = {},
  village: Record<string, unknown> | null = {},
) =>
  ({
    isOutlaw: false,
    sector: 177,
    village:
      village === null
        ? null
        : {
            id: "v1",
            type: "VILLAGE",
            sector: 177,
            structures: [],
            relationshipA: [],
            relationshipB: [],
            ...village,
          },
    ...overrides,
  }) as unknown as UserWithRelations;

describe("getOwnSectorVillage", () => {
  it("returns the user's village while they stand in its sector", () => {
    const user = makeUser();
    expect(getOwnSectorVillage(user)).toBe(user?.village);
  });

  it("returns undefined outside the village sector", () => {
    expect(getOwnSectorVillage(makeUser({ sector: 12 }))).toBeUndefined();
  });

  it("returns undefined for outlaws, whose sector village is looked up differently", () => {
    expect(getOwnSectorVillage(makeUser({ isOutlaw: true }))).toBeUndefined();
  });

  it("returns undefined when the village is not of type VILLAGE", () => {
    for (const type of ["OUTLAW", "TOWN", "HIDEOUT", "SAFEZONE"]) {
      expect(getOwnSectorVillage(makeUser({}, { type }))).toBeUndefined();
    }
  });

  it("returns undefined without the relations the checks read", () => {
    expect(getOwnSectorVillage(makeUser({}, { structures: undefined }))).toBeUndefined();
    expect(
      getOwnSectorVillage(makeUser({}, { relationshipA: undefined })),
    ).toBeUndefined();
    expect(getOwnSectorVillage(makeUser({}, null))).toBeUndefined();
    expect(getOwnSectorVillage(undefined)).toBeUndefined();
  });
});
