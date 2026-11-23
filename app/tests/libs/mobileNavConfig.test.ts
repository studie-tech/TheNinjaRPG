import { describe, expect, it } from "bun:test";
import {
  Banknote,
  Bed,
  Briefcase,
  CircleUserRound,
  Cog,
  Compass,
  Dumbbell,
  GraduationCap,
  HeartPulse,
  Inbox,
  Landmark,
  MessagesSquare,
  Package,
  ScrollText,
  Shield,
  ShoppingBag,
  Store,
  Swords,
  Users,
  UtensilsCrossed,
  Warehouse,
} from "lucide-react";
import {
  DEFAULT_MOBILE_NAV_CONFIG,
  MOBILE_NAV_OPTIONS,
  normalizeMobileNavConfig,
} from "@/libs/mobileNavConfig";

describe("mobile navigation options", () => {
  it("gives every option its own icon", () => {
    expect(
      Object.fromEntries(MOBILE_NAV_OPTIONS.map((option) => [option.id, option.icon])),
    ).toEqual({
      academy: GraduationCap,
      traininggrounds: Dumbbell,
      townhall: Landmark,
      ramenshop: UtensilsCrossed,
      missionhall: ScrollText,
      itemshop: ShoppingBag,
      hospital: HeartPulse,
      home: Bed,
      clanhall: Users,
      blackmarket: Store,
      battlearena: Swords,
      bank: Banknote,
      anbu: Shield,
      occupation: Briefcase,
      warehouse: Warehouse,
      profile: CircleUserRound,
      inbox: Inbox,
      travel: Compass,
      tavern: MessagesSquare,
      settings: Cog,
      items: Package,
    });
  });
});

describe("normalizeMobileNavConfig", () => {
  it.each([[undefined], [null], ["profile"], [3]])("defaults %p", (config) => {
    expect(normalizeMobileNavConfig(config)).toBe(DEFAULT_MOBILE_NAV_CONFIG);
  });

  it("keeps a complete valid layout", () => {
    const config = { left: ["home"], right: ["items", "tavern", "anbu"] };
    expect(normalizeMobileNavConfig(config)).toEqual(config);
  });

  it("falls back per side for a malformed side", () => {
    expect(
      normalizeMobileNavConfig({
        left: [],
        right: ["bank", "anbu", "travel"],
      }),
    ).toEqual({
      left: DEFAULT_MOBILE_NAV_CONFIG.left,
      right: ["bank", "anbu", "travel"],
    });
    expect(
      normalizeMobileNavConfig({
        left: ["home", "bank"],
        right: ["anbu", "anbu", "travel"],
      }),
    ).toEqual({ left: ["home"], right: DEFAULT_MOBILE_NAV_CONFIG.right });
  });

  it("moves saved default Inbox to the right when Activity takes its fixed slot", () => {
    expect(
      normalizeMobileNavConfig({
        left: ["profile", "inbox"],
        right: ["items", "tavern", "settings"],
      }),
    ).toBe(DEFAULT_MOBILE_NAV_CONFIG);
  });

  it("retains the outer shortcut and right side of customized five-slot bars", () => {
    expect(
      normalizeMobileNavConfig({
        left: ["home", "bank"],
        right: ["anbu", "items", "travel"],
      }),
    ).toEqual({ left: ["home"], right: ["anbu", "items", "travel"] });
  });

  it("rejects an id used on both sides", () => {
    expect(
      normalizeMobileNavConfig({
        left: ["home", "bank"],
        right: ["home", "tavern", "anbu"],
      }),
    ).toBe(DEFAULT_MOBILE_NAV_CONFIG);
  });
});
