import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { UserWithRelations } from "@/server/api/routers/profile";
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
    await updateUserCache(test.client, key, { tutorialEnabled: false });
    await pending;
    expect(test.value()?.userData.money).toBe(80);
    test.close();
  });

  it("preserves an invalidation when applying an ordinary patch", async () => {
    const test = setup();
    test.setDatabase(80);
    await test.client.invalidateQueries({ queryKey: key, refetchType: "none" });
    await updateUserCache(test.client, key, { tutorialEnabled: false });
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
