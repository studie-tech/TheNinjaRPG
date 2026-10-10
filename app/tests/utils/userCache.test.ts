import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { UserWithRelations } from "@/server/api/routers/profile";
import { userDeltaResponseSchema } from "@/validators/userCache";
import { updateUserCache, prepareUserUpdate } from "@/utils/userCache";

const key = [["profile", "getUser"], { type: "query" }];
const profile = (money: number) => ({
  userData: { money, reputationPoints: 30 } as NonNullable<UserWithRelations>,
  notifications: ["preserved"],
});
const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(key, profile(100));
  let database = 100;
  let reads = 0;
  const observer = new QueryObserver(client, {
    queryKey: key,
    staleTime: Infinity,
    queryFn: async () => {
      reads++;
      return profile(database);
    },
  });
  const unsubscribe = observer.subscribe(() => {});
  return {
    client,
    observer,
    setDatabase: (value: number) => { database = value; },
    reads: () => reads,
    value: () => client.getQueryData<ReturnType<typeof profile>>(key),
    close: () => { unsubscribe(); client.clear(); },
  };
};

describe("user cache updates", () => {
  it("merges an ordinary patch without a mutation snapshot or read", async () => {
    const test = setup();
    await updateUserCache(test.client, key, { money: 120 });
    expect(test.value()).toEqual(profile(120));
    expect(test.reads()).toBe(0);
    test.close();
  });

  it("evaluates ordinary functional patches against the current cache", async () => {
    const test = setup();
    test.client.setQueryData(key, profile(130));
    await updateUserCache(test.client, key, (current) => ({ money: current.money + 5 }));
    expect(test.value()).toEqual(profile(135));
    expect(test.reads()).toBe(0);
    test.close();
  });

  it("restarts required reconciliation after an ordinary patch", async () => {
    const test = setup();
    test.setDatabase(80);
    const pending = test.client.fetchQuery({
      queryKey: key,
      queryFn: () => new Promise<ReturnType<typeof profile>>(() => {}),
    }).catch(() => undefined);
    test.observer.setOptions({ queryKey: key, staleTime: Infinity, queryFn: async () => profile(80) });
    await updateUserCache(test.client, key, { tutorialOn: false });
    await pending;
    expect(test.value()?.userData.money).toBe(80);
    test.close();
  });

  it("preserves an invalidation when applying an ordinary patch", async () => {
    const test = setup();
    test.setDatabase(80);
    await test.client.invalidateQueries({ queryKey: key, refetchType: "none" });
    await updateUserCache(test.client, key, { tutorialOn: false });
    expect(test.value()?.userData.money).toBe(80);
    expect(test.reads()).toBe(1);
    test.close();
  });

  it("rejects a delayed village snapshot after a newer profile refresh", async () => {
    const test = setup();
    type Village = NonNullable<NonNullable<UserWithRelations>["village"]>;
    const village = { id: "village", tokens: 1000 } as Village;
    test.client.setQueryData(key, { userData: { ...profile(100).userData, village } });
    const revision = prepareUserUpdate(test.client, key);
    const latest = { ...profile(100), userData: { ...profile(100).userData, village: { ...village, tokens: 800 } } };
    test.client.setQueryData(key, latest);
    test.observer.setOptions({ queryKey: key, staleTime: Infinity, queryFn: async () => latest });
    await updateUserCache(test.client, key, (current) => ({
      village: { ...current.village!, tokens: 900 },
    }), { revision });
    expect(test.value()?.userData.village?.tokens).toBe(800);
    test.close();
  });

  it("preserves an unrelated village relation when applying a projection", async () => {
    const test = setup();
    const village = { id: "village", tokens: 1000, name: "Hidden Leaf" } as unknown as NonNullable<NonNullable<UserWithRelations>["village"]>;
    test.client.setQueryData(key, { ...profile(100), userData: { ...profile(100).userData, village } });
    await updateUserCache(test.client, key, { village: { id: "village", tokens: 900 } }, {
      revision: prepareUserUpdate(test.client, key),
    });
    expect(test.value()?.userData.village).toEqual({ ...village, tokens: 900 });
    expect(test.value()?.notifications).toEqual(["preserved"]);
    expect(test.reads()).toBe(0);
    test.close();
  });

  it("merges a confirmed shrine boost without dropping other shrine fields or boosts", async () => {
    const test = setup();
    const village = {
      id: "village", tokens: 1000, name: "Hidden Leaf",
      shrineSettings: { activeBoosts: { training: "existing" }, activeAiIds: ["defender"], unlockedAiIds: ["defender"], boostTemplate: [] },
    } as unknown as NonNullable<NonNullable<UserWithRelations>["village"]>;
    test.client.setQueryData(key, { ...profile(100), userData: { ...profile(100).userData, village } });
    await updateUserCache(test.client, key, { village: {
      id: "village", tokens: 900, shrineSettings: { activeBoosts: { regeneration: "new" } },
    } }, { revision: prepareUserUpdate(test.client, key), delta: { reputationPoints: -10 } });
    expect(test.value()?.userData.village).toEqual({ ...village, tokens: 900,
      shrineSettings: { ...village.shrineSettings, activeBoosts: { training: "existing", regeneration: "new" } },
    });
    expect(test.value()?.userData.reputationPoints).toBe(20);
    expect(test.reads()).toBe(0);
    test.close();
  });

  it("refreshes a mismatched village projection before applying its accompanying debit", async () => {
    const test = setup();
    const village = { id: "current", tokens: 1000 } as unknown as NonNullable<NonNullable<UserWithRelations>["village"]>;
    test.client.setQueryData(key, { ...profile(100), userData: { ...profile(100).userData, village } });
    const latest = { ...profile(90), userData: { ...profile(90).userData, village, reputationPoints: 30 } };
    test.observer.setOptions({ queryKey: key, staleTime: Infinity, queryFn: async () => latest });
    await updateUserCache(test.client, key, { village: { id: "other", tokens: 900 } }, {
      revision: prepareUserUpdate(test.client, key), delta: { reputationPoints: -10 },
    });
    expect(test.value()?.userData).toEqual(latest.userData);
    test.close();
  });

  it("preserves clan fields and rejects a projection for a different clan", async () => {
    const test = setup();
    const clan = { id: "current", bank: 1000, name: "Allies", repTreasury: 20 } as NonNullable<NonNullable<UserWithRelations>["clan"]>;
    const latest = { ...profile(100), userData: { ...profile(100).userData, clan } };
    test.client.setQueryData(key, latest);
    await updateUserCache(test.client, key, { clan: { id: "current", bank: 900 } }, {
      revision: prepareUserUpdate(test.client, key),
    });
    expect(test.value()?.userData.clan).toEqual({ ...clan, bank: 900 });
    expect(test.reads()).toBe(0);
    test.observer.setOptions({ queryKey: key, staleTime: Infinity, queryFn: async () => latest });
    await updateUserCache(test.client, key, { clan: { id: "other", bank: 1 } }, {
      revision: prepareUserUpdate(test.client, key), delta: { money: -10 },
    });
    expect(test.value()?.userData).toEqual(latest.userData);
    test.close();
  });

  it("guards an absolute patch without requiring an empty delta", async () => {
    const test = setup();
    const revision = prepareUserUpdate(test.client, key);
    await updateUserCache(test.client, key, { money: 90 }, { revision });
    expect(test.value()).toEqual(profile(90));
    expect(test.reads()).toBe(0);
    test.close();
  });

  it("refreshes an unknown server delta even when a known patch is supplied", async () => {
    const test = setup();
    const revision = prepareUserUpdate(test.client, key);
    test.setDatabase(85);
    await updateUserCache(test.client, key, { money: 90 }, { revision, delta: undefined });
    expect(test.value()).toEqual(profile(85));
    expect(test.reads()).toBe(1);
    test.close();
  });

  it("refreshes a missing absolute response rather than treating it as a local update", async () => {
    const test = setup();
    const revision = prepareUserUpdate(test.client, key);
    test.setDatabase(80);
    await updateUserCache(test.client, key, undefined, { revision });
    expect(test.value()).toEqual(profile(80));
    expect(test.reads()).toBe(1);
    test.close();
  });

  it("leaves a pending reconciliation running when preparing a mutation", async () => {
    const test = setup();
    let resolve!: (value: ReturnType<typeof profile>) => void;
    const pending = test.client.fetchQuery({
      queryKey: key,
      queryFn: () => new Promise<ReturnType<typeof profile>>((done) => { resolve = done; }),
    });
    expect(prepareUserUpdate(test.client, key)).toBeUndefined();
    expect(test.client.getQueryState(key)?.fetchStatus).toBe("fetching");
    resolve(profile(120));
    await pending;
    expect(test.value()?.userData.money).toBe(120);
    test.close();
  });

  it("leaves initial profile loading running when there is no cached user", async () => {
    const client = new QueryClient();
    let resolve!: (value: ReturnType<typeof profile>) => void;
    const pending = client.fetchQuery({
      queryKey: key,
      queryFn: () => new Promise<ReturnType<typeof profile>>((done) => { resolve = done; }),
    });
    expect(await prepareUserUpdate(client, key)).toBeUndefined();
    expect(client.getQueryState(key)?.fetchStatus).toBe("fetching");
    resolve(profile(100));
    await pending;
    expect(client.getQueryData(key)).toEqual(profile(100));
    client.clear();
  });

  it("applies a confirmed debit without a query and preserves unrelated fields", async () => {
    const test = setup();
    const revision = await prepareUserUpdate(test.client, key);
    test.setDatabase(90);
    await updateUserCache(test.client, key, undefined, { delta: { money: -10 }, revision: revision });
    expect(test.value()).toEqual(profile(90));
    expect(test.reads()).toBe(0);
    test.close();
  });

  it("replaces an initial pending snapshot after a mutation succeeds", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let resolveInitial!: (value: ReturnType<typeof profile>) => void;
    let reads = 0;
    const observer = new QueryObserver(client, {
      queryKey: key,
      queryFn: async () => {
        reads++;
        return reads === 1
          ? new Promise<ReturnType<typeof profile>>((resolve) => { resolveInitial = resolve; })
          : profile(90);
      },
    });
    const unsubscribe = observer.subscribe(() => {});
    const revision = prepareUserUpdate(client, key);
    expect(revision).toBeUndefined();
    expect(client.getQueryState(key)?.fetchStatus).toBe("fetching");

    await updateUserCache(client, key, undefined, { delta: { money: -10 }, revision: revision });
    resolveInitial(profile(100));
    await Promise.resolve();
    expect(reads).toBe(2);
    expect(client.getQueryData(key)).toEqual(profile(90));
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    unsubscribe();
    client.clear();
  });

  it("does not debit twice when a refetch already contains the mutation", async () => {
    const test = setup();
    const revision = await prepareUserUpdate(test.client, key);
    test.setDatabase(90);
    await test.observer.refetch();
    await updateUserCache(test.client, key, undefined, { delta: { money: -10 }, revision: revision });
    expect(test.value()?.userData.money).toBe(90);
    expect(test.reads()).toBe(2);
    test.close();
  });

  it("refreshes after an absolute patch that may already include the debit", async () => {
    const test = setup();
    const revision = await prepareUserUpdate(test.client, key);
    test.setDatabase(90);
    test.client.setQueryData(key, profile(90));
    await updateUserCache(test.client, key, undefined, { delta: { money: -10 }, revision: revision });
    expect(test.value()?.userData.money).toBe(90);
    expect(test.reads()).toBe(1);
    test.close();
  });

  it("does not let a delayed absolute response overwrite a newer debit", async () => {
    const test = setup();
    const absoluteRevision = prepareUserUpdate(test.client, key);
    const deltaRevision = prepareUserUpdate(test.client, key);
    test.setDatabase(85);
    await updateUserCache(test.client, key, undefined, { delta: { money: -10 }, revision: deltaRevision });
    await updateUserCache(test.client, key, { money: 95 }, { delta: {}, revision: absoluteRevision });
    expect(test.value()?.userData.money).toBe(85);
    expect(test.reads()).toBe(1);
    test.close();
  });

  it("refreshes the second overlapping delta instead of using an ambiguous snapshot", async () => {
    const test = setup();
    const first = await prepareUserUpdate(test.client, key);
    const second = await prepareUserUpdate(test.client, key);
    test.setDatabase(70);
    await updateUserCache(test.client, key, undefined, { delta: { money: -10 }, revision: first });
    await updateUserCache(test.client, key, undefined, { delta: { money: -20 }, revision: second });
    expect(test.value()?.userData.money).toBe(70);
    expect(test.reads()).toBe(1);
    test.close();
  });

  it("detects intervening writes even when they return to the original balance", async () => {
    const test = setup();
    const revision = await prepareUserUpdate(test.client, key);
    test.client.setQueryData(key, profile(90));
    test.client.setQueryData(key, profile(100));
    test.setDatabase(90);
    await updateUserCache(test.client, key, undefined, { delta: { money: -10 }, revision: revision });
    expect(test.value()?.userData.money).toBe(90);
    expect(test.reads()).toBe(1);
    test.close();
  });

  it("restarts an unfinished query instead of discarding its reconciliation", async () => {
    const test = setup();
    const revision = await prepareUserUpdate(test.client, key);
    let resolve!: (value: ReturnType<typeof profile>) => void;
    const pending = test.client.fetchQuery({
      queryKey: key,
      queryFn: () => new Promise<ReturnType<typeof profile>>((done) => { resolve = done; }),
    }).catch(() => undefined);
    test.observer.setOptions({ queryKey: key, staleTime: Infinity, queryFn: async () => profile(110) });
    await updateUserCache(test.client, key, undefined, { delta: { money: -10 }, revision: revision });
    resolve(profile(100));
    await pending;
    expect(test.value()?.userData.money).toBe(110);
    test.close();
  });

  it("honors an invalidation even when its query has not completed", async () => {
    const test = setup();
    const revision = await prepareUserUpdate(test.client, key);
    test.client.getQueryCache().find({ queryKey: key })!.invalidate();
    test.setDatabase(110);
    await updateUserCache(test.client, key, undefined, { delta: { money: -10 }, revision: revision });
    expect(test.value()?.userData.money).toBe(110);
    expect(test.reads()).toBe(1);
    test.close();
  });

  it("refreshes when an identity-dependent patch cannot be applied", async () => {
    const test = setup();
    const revision = await prepareUserUpdate(test.client, key);
    test.setDatabase(90);
    await updateUserCache(test.client, key, () => undefined, { delta: {}, revision: revision });
    expect(test.value()?.userData.money).toBe(90);
    expect(test.reads()).toBe(1);
    test.close();
  });

  it("refreshes when no confirmed delta is available", async () => {
    const test = setup();
    const revision = await prepareUserUpdate(test.client, key);
    test.setDatabase(90);
    await updateUserCache(test.client, key, undefined, { delta: undefined, revision: revision });
    expect(test.value()?.userData.money).toBe(90);
    expect(test.reads()).toBe(1);
    test.close();
  });
});


describe("shared mutation user response", () => {
  it("applies a village debit while preserving unrelated boosts and the settings just saved", async () => {
    const test = setup();
    type Village = NonNullable<NonNullable<UserWithRelations>["village"]>;
    const village = {
      id: "village", tokens: 1007, name: "Hidden Leaf",
      shrineSettings: { activeBoosts: { PVP: "existing" }, unlockedAiIds: [], activeAiIds: [] },
    } as unknown as Village;
    test.client.setQueryData(key, { ...profile(100), userData: { ...profile(100).userData, village } });
    const response = userDeltaResponseSchema.parse({
      success: true, message: "Saved",
      userDelta: { village: { id: "village", tokens: -100 } },
      userPatch: { village: { id: "village", shrineSettings: { activeBoosts: { Training: "saved" } } } },
    });
    await updateUserCache(test.client, key, response.userPatch, {
      revision: prepareUserUpdate(test.client, key), delta: response.userDelta,
    });
    expect(test.value()?.userData.village).toEqual({
      ...village, tokens: 907,
      shrineSettings: { ...village.shrineSettings, activeBoosts: { PVP: "existing", Training: "saved" } },
    });
    expect(test.reads()).toBe(0);
    test.close();
  });

  for (const relation of ["clan", "village"] as const) {
    for (const unavailable of [true, false]) {
      it(`refreshes all fields when ${relation} delta refers to a ${unavailable ? "missing" : "different"} relation`, async () => {
        const test = setup();
        const cached = { ...profile(100), userData: { ...profile(100).userData,
          [relation]: unavailable ? null : { id: "current", bank: 100, repTreasury: 10, tokens: 100 },
        } };
        test.client.setQueryData(key, cached);
        const latest = { ...cached, userData: { ...cached.userData, money: 90 } };
        let reads = 0;
        test.observer.setOptions({ queryKey: key, staleTime: Infinity, queryFn: async () => { reads++; return latest; } });
        const delta = userDeltaResponseSchema.parse({
          success: true, message: "Saved", userDelta: { money: -10,
            [relation]: relation === "clan" ? { id: "other", bank: 10 } : { id: "other", tokens: -10 },
          },
        }).userDelta;
        await updateUserCache(test.client, key, undefined, {
          revision: prepareUserUpdate(test.client, key), delta,
        });
        expect(test.value()?.userData).toEqual(latest.userData);
        expect(reads).toBe(1);
        test.close();
      });
    }
  }

  it("refreshes a delayed village debit after a newer profile already includes it", async () => {
    const test = setup();
    type Village = NonNullable<NonNullable<UserWithRelations>["village"]>;
    const village = { id: "village", tokens: 1000 } as Village;
    test.client.setQueryData(key, { ...profile(100), userData: { ...profile(100).userData, village } });
    const revision = prepareUserUpdate(test.client, key);
    const latest = { ...profile(100), userData: { ...profile(100).userData, village: { ...village, tokens: 900 } } };
    test.client.setQueryData(key, latest);
    let reads = 0;
    test.observer.setOptions({ queryKey: key, staleTime: Infinity, queryFn: async () => { reads++; return latest; } });
    await updateUserCache(test.client, key, undefined, { revision, delta: { village: { id: "village", tokens: -100 } } });
    expect(test.value()?.userData.village?.tokens).toBe(900);
    expect(reads).toBe(1);
    test.close();
  });

  it.each([
    { name: "bank deposit", userDelta: { money: -10, clan: { id: "current", bank: 10 } }, money: 90, reputationPoints: 30, bank: 1010, repTreasury: 20 },
    { name: "reputation donation", userDelta: { reputationPoints: -10, clan: { id: "current", repTreasury: 10 } }, money: 100, reputationPoints: 20, bank: 1000, repTreasury: 30 },
  ])("applies a confirmed $name without a clan readback or profile fetch", async (update) => {
    const test = setup();
    const clan = { id: "current", bank: 1000, name: "Allies", repTreasury: 20 } as NonNullable<NonNullable<UserWithRelations>["clan"]>;
    test.client.setQueryData(key, { ...profile(100), userData: { ...profile(100).userData, clan } });
    const revision = prepareUserUpdate(test.client, key);
    const latest = {
      ...profile(update.money),
      userData: { ...profile(update.money).userData, reputationPoints: update.reputationPoints,
        clan: { ...clan, bank: update.bank, repTreasury: update.repTreasury } },
    };
    let reads = 0;
    test.observer.setOptions({ queryKey: key, staleTime: Infinity, queryFn: async () => { reads++; return latest; } });
    const response = userDeltaResponseSchema.parse({
      success: true, message: "Committed", userDelta: update.userDelta, userPatch: {},
    });
    await updateUserCache(test.client, key,
      response.userPatch,
      { revision, delta: response.userDelta },
    );
    expect(test.value()?.userData).toEqual(latest.userData);
    expect(reads).toBe(0);
    test.close();
  });

  it("preserves nullable saved fields and applies numeric deltas once without a profile read", async () => {
    const test = setup();
    const response = userDeltaResponseSchema.parse({
      success: true,
      message: "Updated",
      userDelta: { reputationPoints: -10 },
      userPatch: { primaryElement: "Fire", secondaryElement: null },
    });
    const revision = prepareUserUpdate(test.client, key);
    await updateUserCache(test.client, key, response.userPatch, {
      revision, delta: response.userDelta,
    });
    expect(test.value()?.userData).toMatchObject({
      money: 100, reputationPoints: 20, primaryElement: "Fire", secondaryElement: null,
    });
    expect(test.value()?.notifications).toEqual(["preserved"]);
    expect(test.reads()).toBe(0);
    test.close();
  });

  it("replaces refunded tiers and spent totals without treating absolute values as deltas", async () => {
    const test = setup();
    const response = userDeltaResponseSchema.parse({
      success: true,
      message: "Updated",
      userDelta: { seichiSilver: 40 },
      userPatch: { bloodright: [], bloodrightSpent: 0, monthlySkillResets: { month: "2026-10", count: 1 } },
    });
    test.client.setQueryData(key, {
      ...test.value(), userData: { ...test.value()?.userData, seichiSilver: 10, bloodrightSpent: 40, bloodright: [{skillId: "tier", cost: 40}] },
    });
    await updateUserCache(test.client, key, response.userPatch, {
      revision: prepareUserUpdate(test.client, key), delta: response.userDelta,
    });
    expect(test.value()?.userData).toMatchObject({
      seichiSilver: 50, bloodrightSpent: 0, bloodright: [], monthlySkillResets: { month: "2026-10", count: 1 },
    });
    expect(test.reads()).toBe(0);
    test.close();
  });
});


describe("progression cache reconciliation", () => {
  const progression = (earnedExperience: number, status: "AWAKE" | "BATTLE" | "HOSPITALIZED" = "AWAKE") => ({
    ...profile(100).userData,
    rank: "GENIN" as const, earnedExperience, status,
    offence: 10, defence: 10, strength: 10, speed: 10, intelligence: 10, willpower: 10,
    ninjutsuMastery: 10, genjutsuMastery: 10, taijutsuMastery: 10, bukijutsuMastery: 10,
  });
  it("reconciles achievement progress and Assign XP without touching unrelated notifications", async () => {
    const client = new QueryClient();
    client.setQueryData(key, { userData: progression(10), notifications: [
      { id: "tutorial-unassigned-stats", href: "/profile/experience", name: "Assign XP", color: "blue" },
      { href: "/inbox", name: "2 messages", color: "hidden" },
    ], achievementProgress: [{ id: "old" }] });
    await updateUserCache(client, key, { earnedExperience: 0 }, { revision: prepareUserUpdate(client, key), achievementProgress: [] });
    expect(client.getQueryData(key)).toMatchObject({ achievementProgress: [], notifications: [{ href: "/inbox", name: "2 messages" }] });
    client.clear();
  });
  it("adds Assign XP for a confirmed reward and caps capped profession balances", async () => {
    const client = new QueryClient();
    client.setQueryData(key, { userData: { ...progression(0), medicalExperience: 3_999_999 }, notifications: [] });
    await updateUserCache(client, key, undefined, { revision: prepareUserUpdate(client, key), delta: { earnedExperience: 10, medicalExperience: 100 } });
    expect(client.getQueryData(key)).toMatchObject({ userData: { earnedExperience: 10, medicalExperience: 4_000_000 }, notifications: [{ name: "Assign XP" }] });
    client.clear();
  });
  it("replaces battle navigation with hospitalization in the same confirmed update", async () => {
    const client = new QueryClient();
    client.setQueryData(key, { userData: progression(0, "BATTLE"), notifications: [{ href: "/combat", name: "In combat", color: "red" }] });
    await updateUserCache(client, key, { status: "HOSPITALIZED", battleId: null }, { revision: prepareUserUpdate(client, key) });
    expect(client.getQueryData(key)).toMatchObject({ notifications: [{ href: "/hospital", name: "In hospital", color: "red" }] });
    client.clear();
  });
});


describe("notification effects during cache updates", () => {
  it("adds and removes shrine notifications from confirmed settings without fetching", async () => {
    const test = setup();
    type Village = NonNullable<NonNullable<UserWithRelations>["village"]>;
    const village = { id: "village", sectors: [{}], shrineSettings: { activeBoosts: {} } } as Village;
    test.client.setQueryData(key, { userData: { ...profile(100).userData, village }, notifications: [] });
    await updateUserCache(test.client, key, { village: { id: village.id, shrineSettings: { activeBoosts: { Training: new Date(Date.now() + 60000).toISOString() } } } }, { revision: prepareUserUpdate(test.client, key), delta: {} });
    const boosted = test.client.getQueryData<{ notifications: { name: string }[] }>(key)?.notifications;
    expect(boosted?.map((entry) => entry.name)).toEqual(["Shrine: +10% Training gains"]);
    await updateUserCache(test.client, key, { village: { id: village.id, shrineSettings: { activeBoosts: { Training: new Date(Date.now() - 60000).toISOString() } } } }, { revision: prepareUserUpdate(test.client, key), delta: {} });
    expect(test.client.getQueryData<{ notifications: unknown[] }>(key)?.notifications).toEqual([]);
    expect(test.reads()).toBe(0);
    test.close();
  });
  it("preserves existing boost links without duplicates or replaying toasts", async () => {
    const client = new QueryClient();
    type Village = NonNullable<NonNullable<UserWithRelations>["village"]>;
    const expires = new Date(Date.now() + 60000).toISOString();
    const village = { id: "village", sectors: [{}], shrineSettings: { activeBoosts: { PVP: expires } } } as unknown as Village;
    const existing = { href: "/shrine", name: "Shrine: +10% PVP gains", color: "green", group: "Active boosts" };
    const unrelated = { href: "/shrine", name: "Shrine: +other announcement", color: "blue" };
    const mail = { href: "/inbox", name: "Mail", color: "blue" };
    client.setQueryData(key, { userData: { ...profile(100).userData, village }, notifications: [
      existing, unrelated, mail, { href: "/news", name: "Reward received", color: "toast" },
    ] });
    await updateUserCache(client, key, { village: { id: "village", shrineSettings: { activeBoosts: { Training: expires } } } }, {
      revision: prepareUserUpdate(client, key), delta: {},
    });
    type Notifications = { notifications: typeof existing[] };
    const updated = client.getQueryData<Notifications>(key)!.notifications;
    expect(updated.map(entry => entry.name)).toEqual([
      existing.name, unrelated.name, mail.name, "Shrine: +10% Training gains",
    ]);
    expect(updated[0]).toBe(existing);
    expect(updated[1]).toBe(unrelated);
    expect(updated[2]).toBe(mail);
    await updateUserCache(client, key, { money: 150 });
    expect(client.getQueryData<Notifications>(key)?.notifications).toBe(updated);
    client.clear();
  });
  it("preserves notification identity for unrelated balance changes", async () => {
    const client = new QueryClient();
    const notifications = [{ href: "/news", name: "Reward received", color: "toast" as const }];
    client.setQueryData(key, { ...profile(100), notifications });
    await updateUserCache(client, key, { money: 150 });
    expect(client.getQueryData<{ notifications: unknown }>(key)?.notifications).toBe(notifications);
    client.clear();
  });
  it("does not replay an already-displayed toast when a battle notification changes", async () => {
    const client = new QueryClient();
    client.setQueryData(key, { userData: { ...profile(100).userData, status: "BATTLE" }, notifications: [
      { href: "/news", name: "Reward received", color: "toast" },
      { href: "/combat", name: "In combat", color: "red" },
      { href: "/inbox", name: "Mail", color: "blue" },
    ] });
    await updateUserCache(client, key, { status: "AWAKE" }, { revision: prepareUserUpdate(client, key) });
    expect(client.getQueryData(key)).toMatchObject({ notifications: [{ name: "Mail" }] });
    client.clear();
  });
});
