import { describe, expect, it } from "bun:test";
import { BasicElementName, ELEMENTAL_MASTERY_CAP, GeneralTypes, TavernColorPresets } from "@/drizzle/constants";
import type { UserWithRelations } from "@/routers/profile";
import { AllTags } from "@/validators/combat";
import { getSearchValidator } from "@/validators/register";
import { getBloodlineElements } from "@/libs/userElements";
import {
  getPublicUsersSchema,
  createAssignedExperienceSchema,
  tavernColorChangeSchema,
  updateUserPreferencesSchema,
} from "@/validators/user";

describe("createAssignedExperienceSchema", () => {
  it("defaults every element to zero when only stats are assigned", () => {
    const { schema, maxValues } = createAssignedExperienceSchema();
    const values = schema.parse({ offence: 10 });
    for (const element of BasicElementName) {
      expect(values[element]).toBe(0);
      expect(maxValues[element]).toBe(ELEMENTAL_MASTERY_CAP);
    }
  });

  it("limits provided and capped elements while allowing a whole point to finish timed progress", () => {
    const { schema, maxValues } = createAssignedExperienceSchema({
      rank: "GENIN", primaryElement: "Fire", secondaryElement: "Water",
      bloodline: { effects: [AllTags.parse({ type: "increasedamagegiven", elements: ["Wind"], power: 40 })] },
      elementalMastery: { Earth: ELEMENTAL_MASTERY_CAP - 0.5, Lightning: ELEMENTAL_MASTERY_CAP },
    } as NonNullable<UserWithRelations>);
    expect(maxValues).toMatchObject({ Fire: ELEMENTAL_MASTERY_CAP, Water: ELEMENTAL_MASTERY_CAP, Wind: 0, Earth: 1, Lightning: 0 });
    expect(schema.safeParse({ Fire: 1, Water: 1 }).success).toBe(true);
    expect(schema.safeParse({ Earth: 1 }).success).toBe(true);
    expect(schema.safeParse({ Earth: 2 }).success).toBe(false);
    for (const element of ["Wind", "Lightning"] as const) {
      expect(schema.safeParse({ [element]: 1 }).success).toBe(false);
    }
  });
});

describe("getPublicUsersSchema", () => {
  it("accepts farming as a public-user leaderboard order", () => {
    const result = getPublicUsersSchema.parse({
      limit: 30,
      isAi: false,
      orderBy: "Farming",
    });

    expect(result.orderBy).toBe("Farming");
  });
});

describe("getSearchValidator", () => {
  it("preserves the full optimistic post-as identity", () => {
    const user = {
      userId: "ai-user",
      username: "AiUser",
      avatar: null,
      rank: "JONIN" as const,
      level: 42,
      federalStatus: "NONE" as const,
      role: "EVENT" as const,
      isOutlaw: true,
      displayTitle: "Event Host",
      nRecruited: 3,
      tavernMessages: 99,
      tavernUsernameColor: "NAVY" as const,
      tavernTitleColor: "GOLD" as const,
      village: {
        name: "Syndicate",
        hexColor: "#123456",
        kageId: "ai-user",
      },
    };

    expect(
      getSearchValidator({ max: 1 }).parse({ username: "AiUser", users: [user] })
        .users[0],
    ).toEqual(user);
  });
});

describe("tavernColorChangeSchema", () => {
  it.each([...TavernColorPresets])("accepts the %s preset for both targets", (color) => {
    expect(
      tavernColorChangeSchema.parse({
        target: "username",
        color,
        currentColor: "DEFAULT",
      }),
    ).toEqual({ target: "username", color, currentColor: "DEFAULT" });
    expect(
      tavernColorChangeSchema.parse({
        target: "title",
        color,
        currentColor: "DEFAULT",
      }),
    ).toEqual({ target: "title", color, currentColor: "DEFAULT" });
  });

  it.each(["#1e3a8a", "RED", "GREEN", "EMERALD", "PINK", "ORANGE", "SKY", "PURPLE", "ROSE"])(
    "rejects arbitrary or staff-associated value %s",
    (color) => {
      expect(
        tavernColorChangeSchema.safeParse({
          target: "username",
          color,
          currentColor: "DEFAULT",
        }).success,
      ).toBe(false);
    },
  );

  it("rejects unsupported targets", () => {
    expect(
      tavernColorChangeSchema.safeParse({
        target: "post",
        color: "NAVY",
        currentColor: "DEFAULT",
      }).success,
    ).toBe(false);
  });

  it("rejects unsupported current colors", () => {
    expect(
      tavernColorChangeSchema.safeParse({
        target: "username",
        color: "NAVY",
        currentColor: "RED",
      }).success,
    ).toBe(false);
  });
});

describe("bloodline elemental damage tags", () => {
  it("preserves elemental access through parsed beneficial damage tags", () => {
    const effects = [
      AllTags.parse({ type: "increasedamagegiven", elements: ["Fire"], power: 40 }),
      AllTags.parse({ type: "decreasedamagetaken", elements: ["Water"], power: 20 }),
      AllTags.parse({ type: "increasedamagetaken", elements: ["Wind"], power: 20 }),
    ];
    expect(
      getBloodlineElements({
        bloodline: { effects },
      } as NonNullable<UserWithRelations>),
    ).toEqual(["Fire", "Water"]);
  });
});

describe("updateUserPreferencesSchema", () => {
  const [first, second] = GeneralTypes;

  it("rejects the same preferred general twice", () => {
    const result = updateUserPreferencesSchema.safeParse({
      preferredGeneral1: first,
      preferredGeneral2: first,
    });
    expect(result.success).toBe(false);
  });

  it.each([
    [first, second],
    [first, null],
    [null, first],
    [first, undefined],
    [undefined, first],
    [null, null],
    [undefined, undefined],
    [null, undefined],
  ])("accepts %p and %p", (preferredGeneral1, preferredGeneral2) => {
    expect(
      updateUserPreferencesSchema.safeParse({ preferredGeneral1, preferredGeneral2 }).success,
    ).toBe(true);
  });
});
