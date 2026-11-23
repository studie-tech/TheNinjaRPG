import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  bloodline,
  bloodlineRolls,
  questHistory,
  sanctionTombstone,
  storeUserIdAlias,
  userAttribute,
  userData,
  userItem,
  village,
} from "@/drizzle/schema";
import { resolveSpriteAppearance } from "@/libs/lpc/appearance";
import { spriteLayerSheets } from "@/libs/lpc/catalog";
import { CHARACTER_CREATION_PRESETS } from "@/libs/registration";
import { updateSpriteBodyStyle } from "@/queries/lpc";
import { findUserDataForQueryUpdatedUser } from "@/queries/profile";
import { lpcCatalog } from "../setup/lpc";
import { stubRateLimitTransport } from "../setup/rateLimit";
import { insertRegistrationContent, registerCharacter } from "../setup/registration";
import { sanctionIdentity, stubClerkUsers } from "../setup/sanctions";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../setup/testDatabase";

describeWithDatabase("fresh character appearance registration", () => {
  beforeEach(async () => {
    await resetTables(
      userItem,
      userAttribute,
      bloodlineRolls,
      questHistory,
      userData,
      village,
      bloodline,
      sanctionTombstone,
      storeUserIdAlias,
    );
    await insertRegistrationContent("lpc-register");
    stubRateLimitTransport();
    stubClerkUsers((id) => sanctionIdentity(`${id}@example.com`));
  });
  afterEach(() => vi.restoreAllMocks());

  it("persists curated looks with the gender default and starts the guided tutorial", async () => {
    const database = await getTestDatabase();
    for (const [index, preset] of CHARACTER_CREATION_PRESETS.entries()) {
      const userId = `freshlpc${index}`;
      const result = await registerCharacter(
        userId,
        {
          username: userId,
          bloodlineId: "lpc-register-bloodline",
          gender: "Female",
          attribute_1: preset.traits[0],
          attribute_2: preset.traits[1],
          attribute_3: preset.traits[2],
        },
        { database },
      );
      expect(result.success, result.message).toBe(true);
      const user = await findUserDataForQueryUpdatedUser(database, userId);
      expect(user).toMatchObject({
        gender: "Female",
        spriteBodyStyle: null,
        tutorialOn: true,
        tutorialStep: 0,
        rank: "STUDENT",
      });
      const appearance = resolveSpriteAppearance(user!);
      expect(appearance.body).toBe("female");
      for (const layer of appearance.layers)
        expect(
          spriteLayerSheets(lpcCatalog, appearance, layer, "travel").length,
        ).toBeGreaterThan(0);
      const saved = await database.query.userAttribute.findMany({
        where: eq(userAttribute.userId, userId),
      });
      for (const trait of preset.traits)
        expect(saved.some((row) => row.attribute === trait)).toBe(true);
    }
  });

  it("retains an explicit build and can restore the gender default without changing traits", async () => {
    const database = await getTestDatabase();
    const result = await registerCharacter(
      "freshbuild",
      {
        username: "freshbuild",
        bloodlineId: "lpc-register-bloodline",
        gender: "Female",
        spriteBodyStyle: "male",
        attribute_3: "Ponytail",
      },
      { database },
    );
    expect(result.success, result.message).toBe(true);
    const before = await findUserDataForQueryUpdatedUser(database, "freshbuild");
    expect(resolveSpriteAppearance(before!).body).toBe("male");
    expect(
      (await updateSpriteBodyStyle(database, "freshbuild", null)).rowsAffected,
    ).toBe(1);
    const after = await findUserDataForQueryUpdatedUser(database, "freshbuild");
    expect(resolveSpriteAppearance(after!).body).toBe("female");
    expect(after?.attributes).toEqual(before?.attributes);
    expect(after?.tutorialStep).toBe(0);
  });
});
