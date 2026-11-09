import { describe, expect, it } from "bun:test";
import { PET_GENDER_EDIT_UNTIL } from "@/drizzle/constants";
import { getPetAppearancePrompt } from "@/libs/pets/appearance";
import {
  getPetGenderUpdateError,
  getPetSexClause,
  isPetGenderEditable,
  PET_GENDER_EDIT_UNTIL_LABEL,
} from "@/libs/pets/gender";
import { acquirePetSchema, updatePetSchema } from "@/validators/pets";
import { initialPetSpecies } from "./helpers/species";

const beforeCutoff = new Date(PET_GENDER_EDIT_UNTIL.getTime() - 1);
const atCutoff = new Date(PET_GENDER_EDIT_UNTIL.getTime());
const pet = {
  userId: "owner",
  speciesId: "pet-species-0",
  species: initialPetSpecies[0]!,
  paletteIndex: 0,
  characteristicIndex: 0,
  auraIndex: 0,
  rank: 1,
  artRank: 0,
  avatar: null,
};
const adoption = {
  currency: "REPUTATION",
  name: "Aslan",
  dayKey: "2026-10-26",
  speciesId: "pet-species-0",
  paletteIndex: 0,
  characteristicIndex: 0,
  auraIndex: 0,
};

describe("companion gender edit cutoff", () => {
  it("allows edits strictly before 26 Nov 2026 UTC", () => {
    expect(PET_GENDER_EDIT_UNTIL.toISOString()).toBe("2026-11-26T00:00:00.000Z");
    expect(PET_GENDER_EDIT_UNTIL_LABEL).toBe("26 Nov");
    expect(isPetGenderEditable(beforeCutoff)).toBe(true);
    expect(isPetGenderEditable(atCutoff)).toBe(false);
  });

  it("lets owners set an unset gender or change it before the cutoff", () => {
    expect(
      getPetGenderUpdateError(
        { gender: null, generationStatus: "READY" },
        "MALE",
        beforeCutoff,
      ),
    ).toBeNull();
    expect(
      getPetGenderUpdateError(
        { gender: "FEMALE", generationStatus: "READY" },
        "MALE",
        beforeCutoff,
      ),
    ).toBeNull();
  });

  it("rejects gender changes after the cutoff, including setting an unset gender", () => {
    expect(
      getPetGenderUpdateError(
        { gender: null, generationStatus: "READY" },
        "MALE",
        atCutoff,
      ),
    ).toContain("no longer");
    expect(
      getPetGenderUpdateError(
        { gender: "FEMALE", generationStatus: "READY" },
        "MALE",
        atCutoff,
      ),
    ).toContain("no longer");
  });

  it("ignores requests without a gender change and blocks changes during image generation", () => {
    expect(
      getPetGenderUpdateError(
        { gender: "MALE", generationStatus: "READY" },
        undefined,
        atCutoff,
      ),
    ).toBeNull();
    expect(
      getPetGenderUpdateError(
        { gender: "MALE", generationStatus: "READY" },
        "MALE",
        atCutoff,
      ),
    ).toBeNull();
    expect(
      getPetGenderUpdateError(
        { gender: null, generationStatus: "GENERATING" },
        "FEMALE",
        beforeCutoff,
      ),
    ).toContain("Wait");
  });
});

describe("companion gender validation", () => {
  it("requires a male or female choice on adoption", () => {
    expect(acquirePetSchema.safeParse(adoption).success).toBe(false);
    expect(acquirePetSchema.safeParse({ ...adoption, gender: "OTHER" }).success).toBe(
      false,
    );
    expect(acquirePetSchema.parse({ ...adoption, gender: "FEMALE" }).gender).toBe(
      "FEMALE",
    );
  });

  it("accepts a gender-only settings update", () => {
    expect(updatePetSchema.parse({ petId: "pet", gender: "MALE" })).toEqual({
      petId: "pet",
      gender: "MALE",
    });
    expect(updatePetSchema.safeParse({ petId: "pet", gender: "NONE" }).success).toBe(
      false,
    );
  });
});

describe("companion sex in the appearance prompt", () => {
  it("keeps the previous unsexed prompt for companions without a saved gender", () => {
    expect(getPetSexClause(null, 1)).toBe("");
    expect(getPetSexClause(undefined, 1)).toBe("");
    const legacy = getPetAppearancePrompt(pet, "GPT");
    expect(legacy).toBe(getPetAppearancePrompt({ ...pet, gender: null }, "GPT"));
    expect(legacy).not.toContain("Sex:");
  });

  it("asks for visible male features from rank 1 that grow with rank", () => {
    const prompt = getPetAppearancePrompt({ ...pet, gender: "MALE" }, "GPT");
    expect(prompt).toContain("Sex: MALE");
    expect(prompt).toContain("a lion has a mane");
    expect(prompt).toContain("unmistakable");
    expect(getPetSexClause("MALE", 3)).toContain("about half their final size");
    expect(getPetSexClause("MALE", 5)).toContain("full and well defined");
    expect(getPetSexClause("MALE", 10)).toContain("most majestic");
  });

  it("asks for the female form without male-only features", () => {
    const prompt = getPetAppearancePrompt(
      {
        ...pet,
        gender: "FEMALE",
        rank: 7,
        artRank: 6,
        avatar: "https://example.com/pet.webp",
      },
      "GPT",
    );
    expect(prompt).toContain("Sex: FEMALE");
    expect(prompt).toContain("a lioness has no mane");
    expect(prompt).not.toContain("Sex: MALE");
  });
});
