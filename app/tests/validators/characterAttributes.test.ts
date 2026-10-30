import { describe, expect, it } from "bun:test";
import { getAttributeGroup, getCharacterAttributes, registrationSchema } from "@/validators/register";

const registration = {
  username: "NewNinja", gender: "Other", hair_color: "Black", eye_color: "Brown", skin_color: "Light",
  attribute_1: "Soft features", attribute_2: "Glasses", attribute_3: "Short Hair",
  read_tos: true, read_privacy: true, read_earlyaccess: true, bloodlineId: "starter",
} as const;

describe("character attribute choices", () => {
  it("separates saved colors from effective traits and resolves legacy conflicts", () => {
    expect(getCharacterAttributes(["Gray hair", "Brown eyes", "Dark skin", "Long Hair", "Bald", "Hard features"]))
      .toEqual({ traits: ["Bald", "Hard features"], Hair: "Gray", Eyes: "Brown", Skin: "Dark" });
    expect(getCharacterAttributes(["soft features", "sharp features", "stubble", "full beard", "long beard"]).traits)
      .toEqual(["Sharp features", "Long Beard"]);
  });

  it("keeps styles out of color categories and supports saved legacy palettes", () => {
    expect(getCharacterAttributes(["Long Hair", "SHORT HAIR", "green eyes", "yellow HAIR", "Albino skin"]))
      .toEqual({ traits: ["Long Hair"], Hair: "Yellow", Eyes: "Green", Skin: "Albino" });
    expect(getAttributeGroup("BLUE hair")).toContain("Gray Hair");
    expect(getAttributeGroup("Blue Hair")).not.toContain("Long Hair");
    expect(getCharacterAttributes([])).toEqual({ traits: [], Hair: "Black", Eyes: "Blue", Skin: "Light" });
  });

  it("uses the same deterministic palette for duplicates regardless of row order", () => {
    const choices = ["Red Hair", "Black hair", "Brown Eyes", "Blue eyes", "Light Skin", "Dark skin"];
    expect(getCharacterAttributes(choices)).toEqual(getCharacterAttributes([...choices].reverse()));
    expect(getCharacterAttributes(choices)).toMatchObject({ Hair: "Black", Eyes: "Blue", Skin: "Dark" });
  });

  it.each([
    ["Bald", "Long Hair"], ["Long Hair", "Short Hair"], ["Soft features", "Hard features"],
    ["Sharp features", "Hard features"], ["Long Beard", "Stubble"], ["Full Beard", "Long Beard"],
    ["Glasses", "Glasses"],
  ])("rejects incompatible registration traits %s and %s", (first, second) => {
    const parsed = registrationSchema.safeParse({ ...registration, attribute_1: first, attribute_2: second, attribute_3: "Scar" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues.map((issue) => issue.path[0])).toEqual(["attribute_1", "attribute_2"]);
  });

  it("accepts independent face, hair and beard choices at registration", () => {
    expect(registrationSchema.safeParse({ ...registration, attribute_1: "Hard features", attribute_2: "Long Hair", attribute_3: "Full Beard" }).success).toBe(true);
  });
});
