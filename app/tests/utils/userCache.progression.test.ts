import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "bun:test";
import { getUserCaps } from "@/drizzle/constants";
import type { NavBarDropdownLink } from "@/libs/menus";
import type { AchievementProgress, UserWithRelations } from "@/server/api/routers/profile";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";

const key = [["profile", "getUser"], { type: "query" }];
type Cache = { userData: NonNullable<UserWithRelations>; notifications: NavBarDropdownLink[]; achievementProgress: AchievementProgress[] };
const setup = () => {
  const client = new QueryClient();
  const cache = {
    userData: { masteryRanks: {}, bloodlineMastery: 0, sageMastery: 0, rank: "GENIN", status: "AWAKE", earnedExperience: 100, offence: 10, defence: 10, speed: 10, intelligence: 10, strength: 10, willpower: 10, ninjutsuMastery: 10, genjutsuMastery: 10, taijutsuMastery: 10, bukijutsuMastery: 10 } as NonNullable<UserWithRelations>,
    notifications: [{ id: "unrelated", href: "/mail", name: "Mail", color: "blue" }, { href: "/profile/experience", name: "Assign XP", color: "blue" }, { href: "/combat", name: "In combat", color: "red" }, { href: "/hospital", name: "In hospital", color: "red" }],
    achievementProgress: [{ questId: "old-progress" } as AchievementProgress],
  } satisfies Cache;
  client.setQueryData(key, cache);
  return { client, value: () => client.getQueryData<Cache>(key)!, close: () => client.clear() };
};

describe("progression-derived profile navigation", () => {
  it("removes spent XP and ended battle notifications while retaining unrelated navigation", async () => {
    const test = setup();
    await updateUserCache(test.client, key, { earnedExperience: 0, status: "AWAKE" }, { revision: prepareUserUpdate(test.client, key) });
    expect(test.value().notifications).toEqual([{ id: "unrelated", href: "/mail", name: "Mail", color: "blue" }]);
    test.close();
  });

  it("removes Assign XP when the remaining points cannot be assigned under rank caps", async () => {
    const test = setup();
    const cap = getUserCaps("GENIN");
    await updateUserCache(test.client, key, { offence: cap.stats_cap, defence: cap.stats_cap, intelligence: cap.gens_cap, speed: cap.gens_cap, strength: cap.gens_cap, willpower: cap.gens_cap, ninjutsuMastery: cap.mastery_cap, genjutsuMastery: cap.mastery_cap, taijutsuMastery: cap.mastery_cap, bukijutsuMastery: cap.mastery_cap }, { revision: prepareUserUpdate(test.client, key) });
    expect(test.value().userData.earnedExperience).toBe(100);
    expect(test.value().notifications.some(entry => entry.name === "Assign XP")).toBe(false);
    test.close();
  });

  it("introduces Assign XP and hospitalization from one accepted cache revision", async () => {
    const test = setup();
    await updateUserCache(test.client, key, { status: "HOSPITALIZED", earnedExperience: 200 }, { revision: prepareUserUpdate(test.client, key), achievementProgress: [] });
    expect(test.value().achievementProgress).toEqual([]);
    expect(test.value().notifications.filter(entry => entry.name === "Assign XP")).toHaveLength(1);
    expect(test.value().notifications.filter(entry => entry.name === "In hospital")).toHaveLength(1);
    expect(test.value().notifications.some(entry => entry.name === "In combat")).toBe(false);
    test.close();
  });

  it("does not overwrite achievement progress when a concurrent cache update won", async () => {
    const test = setup();
    const revision = prepareUserUpdate(test.client, key);
    const current = [{ questId: "concurrent-progress" } as AchievementProgress];
    test.client.setQueryData(key, { ...test.value(), achievementProgress: current });
    await updateUserCache(test.client, key, { earnedExperience: 0 }, { revision, achievementProgress: [] });
    expect(test.value().achievementProgress).toEqual(current);
    expect(test.value().userData.earnedExperience).toBe(100);
    expect(test.client.getQueryState(key)?.isInvalidated).toBe(true);
    test.close();
  });
});
