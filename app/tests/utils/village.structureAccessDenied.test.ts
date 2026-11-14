import { describe, expect, it } from "bun:test";
import type { UserWithRelations } from "@/routers/profile";
import { type SectorVillage, structureAccessDeniedMessage } from "@/utils/village";

type User = NonNullable<UserWithRelations>;

const home = {
  id: "home",
  name: "Akikaze",
  structures: [{ route: "/hospital", name: "Hospital" }],
};
const user = (village: unknown = home) => ({ village }) as unknown as User;

const visited = (structures: { route: string; name: string }[]) =>
  ({ id: "away", name: "Hyorin", structures }) as unknown as SectorVillage;

describe("structureAccessDeniedMessage", () => {
  it("names the home village when the player is in the wilderness", () => {
    expect(structureAccessDeniedMessage(user(), "/hospital", undefined)).toBe(
      "The Hospital is in Akikaze. Travel there first.",
    );
    expect(structureAccessDeniedMessage(user(), undefined, null)).toBe(
      "You are outside Akikaze. Travel there first.",
    );
  });

  it("asks villageless players to find a village", () => {
    expect(structureAccessDeniedMessage(user(null), "/hospital", undefined)).toBe(
      "You need to be in a village to go there. Travel to one first.",
    );
  });

  it("explains a building the visited village lacks", () => {
    expect(structureAccessDeniedMessage(user(), "/hospital", visited([]))).toBe(
      "Hyorin has no Hospital. Travel to Akikaze to use yours.",
    );
  });

  it("explains a building closed to the player's village", () => {
    expect(
      structureAccessDeniedMessage(
        user(),
        "/hospital",
        visited([{ route: "/hospital", name: "Hospital" }]),
      ),
    ).toBe(
      "The Hospital in Hyorin is closed to your village. Travel to Akikaze to use yours.",
    );
  });
});
