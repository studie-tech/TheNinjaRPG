import { describe, expect, it } from "vitest";
import {
  COST_TAVERN_COLOR_CHANGE,
  getTavernColorChangeCost,
  TavernColorPresets,
} from "@/drizzle/constants";
import {
  resolveTavernColorClasses,
  TAVERN_COLOR_STYLES,
} from "@/libs/tavernColors";
import { contrastRatio, parseHexColor, relativeLuminance } from "@/utils/color";

const isStrongUsernameColor = (className: string) =>
  className.includes("font-bold") &&
  (className.includes("text-") || className.includes("dark:text-"));

const LIGHT_TAVERN_SURFACE = parseHexColor("#ffffff")!;
const DARK_TAVERN_SURFACE = parseHexColor("#334155")!;

describe("tavern color styling", () => {
  it.each(TavernColorPresets)("charges the configured cost for %s", (preset) => {
    expect(getTavernColorChangeCost(preset)).toBe(COST_TAVERN_COLOR_CHANGE);
  });

  it.each(TavernColorPresets.filter((preset) => preset !== "DEFAULT"))(
    "styles %s usernames with bold light/dark text colors",
    (preset) => {
      expect(isStrongUsernameColor(TAVERN_COLOR_STYLES[preset].usernameClass)).toBe(
        true,
      );
    },
  );

  it.each(TavernColorPresets.filter((preset) => preset !== "DEFAULT"))(
    "gives %s usernames WCAG contrast in light and dark mode",
    (preset) => {
      const style = TAVERN_COLOR_STYLES[preset];
      const lightForeground = parseHexColor(style.usernameLightHex)!;
      const darkForeground = parseHexColor(style.usernameDarkHex)!;

      expect(
        contrastRatio(
          relativeLuminance(lightForeground),
          relativeLuminance(LIGHT_TAVERN_SURFACE),
        ),
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(
          relativeLuminance(darkForeground),
          relativeLuminance(DARK_TAVERN_SURFACE),
        ),
      ).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(TavernColorPresets)("gives %s title text WCAG contrast", (preset) => {
    const style = TAVERN_COLOR_STYLES[preset];
    const background = parseHexColor(style.titleHex);
    const foreground = parseHexColor(style.titleForeground);
    expect(background).not.toBeNull();
    expect(foreground).not.toBeNull();
    expect(
      contrastRatio(
        relativeLuminance(background!),
        relativeLuminance(foreground!),
      ),
    ).toBeGreaterThanOrEqual(4.5);
    expect(style.titleClass).toContain(
      style.titleForeground === "#000000" ? "text-black" : "text-white",
    );
  });

  it("keeps username and title presets independent", () => {
    const classes = resolveTavernColorClasses({
      tavernStyling: true,
      role: "USER",
      usernamePreset: "NAVY",
      titlePreset: "YELLOW",
      baseUsernameClass: "federal-style",
      baseTitleClass: "default-title",
    });
    expect(classes.usernameClass).toContain("text-blue-700");
    expect(classes.titleClass).toContain("bg-yellow-400");
  });

  it("gives each blue preset a unique username color", () => {
    const classes = (["MIDNIGHT", "NAVY", "COBALT"] as const).map(
      (preset) => TAVERN_COLOR_STYLES[preset].usernameClass,
    );
    expect(new Set(classes).size).toBe(3);
  });

  it("gives each neutral preset a unique username color", () => {
    const classes = (["SLATE", "CHARCOAL"] as const).map(
      (preset) => TAVERN_COLOR_STYLES[preset].usernameClass,
    );
    expect(new Set(classes).size).toBe(2);
  });

  it("gives each accent preset a unique username color", () => {
    const classes = (["CRIMSON", "FUCHSIA", "MINT", "LIME"] as const).map(
      (preset) => TAVERN_COLOR_STYLES[preset].usernameClass,
    );
    expect(new Set(classes).size).toBe(4);
  });

  it("gives Yellow and Gold different username colors", () => {
    expect(TAVERN_COLOR_STYLES.YELLOW.usernameClass).toContain("yellow");
    expect(TAVERN_COLOR_STYLES.GOLD.usernameClass).toContain("amber");
    expect(TAVERN_COLOR_STYLES.YELLOW.usernameClass).not.toBe(
      TAVERN_COLOR_STYLES.GOLD.usernameClass,
    );
  });

  it("preserves staff username styling", () => {
    const classes = resolveTavernColorClasses({
      tavernStyling: true,
      role: "MODERATOR",
      usernamePreset: "COBALT",
      titlePreset: "DEFAULT",
      baseUsernameClass: "staff-green",
      baseTitleClass: "default-title",
    });
    expect(classes.usernameClass).toBe("staff-green");
  });

  it("preserves federal/default styling when DEFAULT is selected", () => {
    const classes = resolveTavernColorClasses({
      tavernStyling: true,
      role: "USER",
      usernamePreset: "DEFAULT",
      titlePreset: "DEFAULT",
      baseUsernameClass: "federal-style",
      baseTitleClass: "default-title",
    });
    expect(classes).toEqual({
      usernameClass: "federal-style",
      titleClass: "default-title",
    });
  });

  it("does not apply either preset outside tavern conversations", () => {
    const classes = resolveTavernColorClasses({
      tavernStyling: false,
      role: "USER",
      usernamePreset: "SLATE",
      titlePreset: "COBALT",
      baseUsernameClass: "federal-style",
      baseTitleClass: "default-title",
    });
    expect(classes).toEqual({
      usernameClass: "federal-style",
      titleClass: "default-title",
    });
  });
});
