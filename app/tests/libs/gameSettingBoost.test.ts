import { afterEach, beforeEach, describe, expect, it, setSystemTime } from "bun:test";
import {
  getGlobalGameSettingNotification,
  getGlobalGameSettingNotifications,
} from "@/libs/gameSettingBoost";

const now = new Date("2026-11-01T12:00:00Z");
const tomorrow = new Date("2026-11-02T12:00:00Z");

beforeEach(() => setSystemTime(now));
afterEach(() => setSystemTime());

describe("global boost notices", () => {
  it.each([
    ["trainingGainMultiplier", "/traininggrounds", "gains"],
    ["regenGainMultiplier", "/profile", "regen"],
    ["battleExpMultiplier", "/battlearena", "battle exp"],
    ["missionExpMultiplier", "/missionhall", "mission exp"],
    ["jutsuExpMultiplier", "/jutsus", "jutsu exp"],
    ["itemExpMultiplier", "/items", "item exp"],
  ] as const)("formats the saved %s boost", (name, href, label) => {
    expect(
      getGlobalGameSettingNotification(name, { name, value: 2, time: tomorrow }),
    ).toEqual({
      href,
      name: `Global: 2X ${label} | 1 days`,
      color: "green",
      group: "Active boosts",
    });
  });

  it("clears missing, disabled and expired settings at the exact expiry boundary", () => {
    const name = "regenGainMultiplier";
    expect(getGlobalGameSettingNotification(name)).toBeNull();
    expect(
      getGlobalGameSettingNotification(name, { name, value: 0, time: tomorrow }),
    ).toBeNull();
    expect(
      getGlobalGameSettingNotification(name, { name, value: 2, time: now }),
    ).toBeNull();
    expect(
      getGlobalGameSettingNotification(name, { name, value: 2, time: new Date(0) }),
    ).toBeNull();
  });

  it("orders active global notices consistently and excludes unrelated timed settings", () => {
    expect(
      getGlobalGameSettingNotifications([
        { id: "items", name: "itemExpMultiplier", value: 3, time: tomorrow },
        { id: "other", name: "war-village-regen", value: 2, time: tomorrow },
        { id: "expired", name: "battleExpMultiplier", value: 2, time: now },
        { id: "disabled", name: "regenGainMultiplier", value: 0, time: tomorrow },
        { id: "training", name: "trainingGainMultiplier", value: 2, time: tomorrow },
      ]).map(({ href, name }) => ({ href, name })),
    ).toEqual([
      { href: "/traininggrounds", name: "Global: 2X gains | 1 days" },
      { href: "/items", name: "Global: 3X item exp | 1 days" },
    ]);
  });
});
