import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it } from "bun:test";
import { getUserCaps, MAX_MASTERY_CAP } from "@/drizzle/constants";
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
  it("replaces faction activity notices while retaining unrelated navigation", async () => {
    const test = setup();
    test.client.setQueryData(key, {
      ...test.value(),
      userData: { ...test.value().userData, villageId: "village", shrineBattles: [{ defenderEntityId: "village", attackerEntityId: "enemy", sector: 4 }] },
      notifications: [
        { href: "/travel", name: "Shrine under attack (Sector 4)", color: "red", alwaysShow: true },
        { id: "unrelated", href: "/mail", name: "Mail", color: "blue" },
      ],
    });
    await updateUserCache(test.client, key, { shrineBattles: [] }, { revision: prepareUserUpdate(test.client, key) });
    expect(test.value().notifications.some((entry) => entry.name === "Shrine under attack (Sector 4)")).toBe(false);
    expect(test.value().notifications.some((entry) => entry.id === "unrelated")).toBe(true);
    test.close();
  });

  it("adds and preserves the canonical deletion notice once alongside unrelated navigation", async () => {
    const test = setup();
    const notice: NavBarDropdownLink = { href: "/profile?tab=edit&settings=deletion&setting=character", name: "Deletion requested", color: "red" };
    await updateUserCache(test.client, key, { deletionAt: new Date() }, { revision: prepareUserUpdate(test.client, key) });
    expect(test.value().notifications.filter((entry) => /delet/i.test(entry.name))).toEqual([notice]);
    await updateUserCache(test.client, key, { gender: "Unknown" }, { revision: prepareUserUpdate(test.client, key) });
    expect(test.value().notifications.filter((entry) => /delet/i.test(entry.name))).toEqual([notice]);
    expect(test.value().notifications.some((entry) => entry.id === "unrelated")).toBe(true);
    test.close();
  });

  it("clears deletion and sanction notices from the same confirmed account update", async () => {
    const test = setup();
    test.client.setQueryData(key, { ...test.value(), userData: { ...test.value().userData, deletionAt: new Date(), isBanned: true, isTradeBanned: true }, notifications: [
      { href: "/profile?tab=edit&settings=deletion&setting=character", name: "Deletion requested", color: "red" },
      { href: "/reports", name: "Banned!", color: "red" },
      { href: "/reports", name: "Trade Banned!", color: "red" },
      { id: "unrelated", href: "/mail", name: "Mail", color: "blue" },
    ] });
    await updateUserCache(test.client, key, { deletionAt: null, isBanned: false, isTradeBanned: false }, { revision: prepareUserUpdate(test.client, key) });
    expect(test.value().notifications.some((entry) => ["Deletion requested", "Banned!", "Trade Banned!"].includes(entry.name))).toBe(false);
    expect(test.value().notifications.some((entry) => entry.id === "unrelated")).toBe(true);
    test.close();
  });

  it("removes spent XP and ended battle notifications while retaining unrelated navigation", async () => {
    const test = setup();
    await updateUserCache(test.client, key, { earnedExperience: 0, status: "AWAKE" }, { revision: prepareUserUpdate(test.client, key) });
    expect(test.value().notifications).toEqual([{ id: "unrelated", href: "/mail", name: "Mail", color: "blue" }]);
    test.close();
  });

  it("removes Assign XP when the remaining points cannot be assigned under rank caps", async () => {
    const test = setup();
    const cap = getUserCaps("GENIN");
    await updateUserCache(test.client, key, { offence: cap.stats_cap, defence: cap.stats_cap, intelligence: cap.gens_cap, speed: cap.gens_cap, strength: cap.gens_cap, willpower: cap.gens_cap, ninjutsuMastery: MAX_MASTERY_CAP, genjutsuMastery: MAX_MASTERY_CAP, taijutsuMastery: MAX_MASTERY_CAP, bukijutsuMastery: MAX_MASTERY_CAP }, { revision: prepareUserUpdate(test.client, key) });
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
    const observer = new QueryObserver(test.client, { queryKey: key, staleTime: Infinity, retry: false, queryFn: async () => ({ ...test.value(), achievementProgress: current }) });
    const unsubscribe = observer.subscribe(() => {});
    await updateUserCache(test.client, key, { earnedExperience: 0 }, { revision, achievementProgress: [] });
    expect(test.value().achievementProgress).toEqual(current);
    expect(test.value().userData.earnedExperience).toBe(100);
    expect(test.client.getQueryState(key)?.isInvalidated).toBe(false);
    unsubscribe();
    test.close();
  });
});
