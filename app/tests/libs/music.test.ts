import { describe, expect, it } from "vitest";
import {
  BLUE_BLADE_EYES_BLOODLINE_ID,
  HEAVENLY_SONATA_BLOODLINE_ID,
  MUSIC_AKASUMI_THEME,
  MUSIC_ANOTHER_DAY_ANOTHER_BATTLEFIELD,
  MUSIC_BLUE_BLADE_THEME,
  MUSIC_HALLOWEEN_THEME,
  MUSIC_HEAVENLY_SONATA_THEME,
  MUSIC_HORIZON_THEME,
  MUSIC_HYORIN_THEME,
  MUSIC_SYNDICATE_THEME,
  MUSIC_WELCOME_TO_SEICHI,
  MUSIC_WINTER_THEME,
} from "@/drizzle/constants";
import { getBackgroundMusicSrc } from "@/libs/music";

describe("getBackgroundMusicSrc", () => {
  it("plays the village theme for non-outlaws outside seasonal events", () => {
    expect(getBackgroundMusicSrc({ villageName: "Hyorin" }, "fall")).toBe(
      MUSIC_HYORIN_THEME,
    );
    expect(getBackgroundMusicSrc({ villageName: "Horizon" }, "spring")).toBe(
      MUSIC_HORIZON_THEME,
    );
    expect(
      getBackgroundMusicSrc({ villageName: "Akasumi", isOutlaw: false }, "summer"),
    ).toBe(MUSIC_AKASUMI_THEME);
  });

  it("falls back to Welcome to Seichi without a themed village or bloodline", () => {
    expect(getBackgroundMusicSrc(undefined, "fall")).toBe(MUSIC_WELCOME_TO_SEICHI);
    expect(getBackgroundMusicSrc(null, "summer")).toBe(MUSIC_WELCOME_TO_SEICHI);
    expect(getBackgroundMusicSrc({ villageName: null }, "fall")).toBe(
      MUSIC_WELCOME_TO_SEICHI,
    );
    expect(getBackgroundMusicSrc({ villageName: "constructor" }, "fall")).toBe(
      MUSIC_WELCOME_TO_SEICHI,
    );
    expect(getBackgroundMusicSrc({ bloodlineId: "other-bloodline" }, "fall")).toBe(
      MUSIC_WELCOME_TO_SEICHI,
    );
  });

  it("plays the outlaw theme for every outlaw, in the Syndicate, a hideout or a town", () => {
    expect(
      getBackgroundMusicSrc({ villageName: "Syndicate", isOutlaw: true }, "fall"),
    ).toBe(MUSIC_SYNDICATE_THEME);
    expect(
      getBackgroundMusicSrc({ villageName: "Some Hideout", isOutlaw: true }, "fall"),
    ).toBe(MUSIC_SYNDICATE_THEME);
    expect(
      getBackgroundMusicSrc({ villageName: "Some Town", isOutlaw: true }, "spring"),
    ).toBe(MUSIC_SYNDICATE_THEME);
  });

  it("plays the bloodline theme over outlaw and village themes", () => {
    expect(
      getBackgroundMusicSrc(
        { villageName: "Hyorin", bloodlineId: HEAVENLY_SONATA_BLOODLINE_ID },
        "fall",
      ),
    ).toBe(MUSIC_HEAVENLY_SONATA_THEME);
    expect(
      getBackgroundMusicSrc(
        {
          villageName: "Syndicate",
          isOutlaw: true,
          bloodlineId: BLUE_BLADE_EYES_BLOODLINE_ID,
        },
        "summer",
      ),
    ).toBe(MUSIC_BLUE_BLADE_THEME);
    expect(
      getBackgroundMusicSrc({ bloodlineId: BLUE_BLADE_EYES_BLOODLINE_ID }, "spring"),
    ).toBe(MUSIC_BLUE_BLADE_THEME);
  });

  it("overrides character themes with the event theme during Halloween and winter", () => {
    expect(getBackgroundMusicSrc({ villageName: "Hyorin" }, "halloween")).toBe(
      MUSIC_HALLOWEEN_THEME,
    );
    expect(getBackgroundMusicSrc({ villageName: "Akikaze" }, "winter")).toBe(
      MUSIC_WINTER_THEME,
    );
    expect(getBackgroundMusicSrc(undefined, "winter")).toBe(MUSIC_WINTER_THEME);
    expect(
      getBackgroundMusicSrc(
        { bloodlineId: HEAVENLY_SONATA_BLOODLINE_ID, isOutlaw: true },
        "halloween",
      ),
    ).toBe(MUSIC_HALLOWEEN_THEME);
    expect(
      getBackgroundMusicSrc({ villageName: "Syndicate", isOutlaw: true }, "winter"),
    ).toBe(MUSIC_WINTER_THEME);
  });

  it("keeps Halloween music off without a loaded user", () => {
    expect(getBackgroundMusicSrc(undefined, "halloween")).toBe(
      MUSIC_WELCOME_TO_SEICHI,
    );
    expect(getBackgroundMusicSrc(null, "halloween")).toBe(
      MUSIC_WELCOME_TO_SEICHI,
    );
    expect(getBackgroundMusicSrc({}, "halloween")).toBe(MUSIC_HALLOWEEN_THEME);
  });

  it("plays Another day, Another battlefield in every battle, over all other themes", () => {
    expect(getBackgroundMusicSrc({ villageName: "Hyorin", inBattle: true }, "fall")).toBe(
      MUSIC_ANOTHER_DAY_ANOTHER_BATTLEFIELD,
    );
    expect(
      getBackgroundMusicSrc({ villageName: "Syndicate", isOutlaw: true, inBattle: true }, "spring"),
    ).toBe(MUSIC_ANOTHER_DAY_ANOTHER_BATTLEFIELD);
    expect(
      getBackgroundMusicSrc(
        { bloodlineId: HEAVENLY_SONATA_BLOODLINE_ID, inBattle: true },
        "summer",
      ),
    ).toBe(MUSIC_ANOTHER_DAY_ANOTHER_BATTLEFIELD);
    expect(getBackgroundMusicSrc({ inBattle: true }, "halloween")).toBe(
      MUSIC_ANOTHER_DAY_ANOTHER_BATTLEFIELD,
    );
    expect(getBackgroundMusicSrc({ inBattle: true }, "winter")).toBe(
      MUSIC_ANOTHER_DAY_ANOTHER_BATTLEFIELD,
    );
  });

  it("returns to the normal theme once the battle is over", () => {
    expect(getBackgroundMusicSrc({ villageName: "Hyorin", inBattle: false }, "fall")).toBe(
      MUSIC_HYORIN_THEME,
    );
    expect(getBackgroundMusicSrc({ villageName: "Hyorin", inBattle: null }, "halloween")).toBe(
      MUSIC_HALLOWEEN_THEME,
    );
  });
});
