import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { UserWithRelations } from "@/server/api/routers/profile";
import { applyUserDelta, prepareUserDelta } from "@/utils/userDelta";

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

describe("confirmed user deltas", () => {
  it("leaves a pending reconciliation running when preparing a mutation", async () => {
    const test = setup();
    let resolve!: (value: ReturnType<typeof profile>) => void;
    const pending = test.client.fetchQuery({
      queryKey: key,
      queryFn: () => new Promise<ReturnType<typeof profile>>((done) => { resolve = done; }),
    });
    expect(prepareUserDelta(test.client, key)).toBeUndefined();
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
    expect(await prepareUserDelta(client, key)).toBeUndefined();
    expect(client.getQueryState(key)?.fetchStatus).toBe("fetching");
    resolve(profile(100));
    await pending;
    expect(client.getQueryData(key)).toEqual(profile(100));
    client.clear();
  });

  it("applies a confirmed debit without a query and preserves unrelated fields", async () => {
    const test = setup();
    const revision = await prepareUserDelta(test.client, key);
    test.setDatabase(90);
    await applyUserDelta(test.client, key, { money: -10 }, revision);
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
    const revision = prepareUserDelta(client, key);
    expect(revision).toBeUndefined();
    expect(client.getQueryState(key)?.fetchStatus).toBe("fetching");

    await applyUserDelta(client, key, { money: -10 }, revision);
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
    const revision = await prepareUserDelta(test.client, key);
    test.setDatabase(90);
    await test.observer.refetch();
    await applyUserDelta(test.client, key, { money: -10 }, revision);
    expect(test.value()?.userData.money).toBe(90);
    expect(test.reads()).toBe(2);
    test.close();
  });

  it("refreshes after an absolute patch that may already include the debit", async () => {
    const test = setup();
    const revision = await prepareUserDelta(test.client, key);
    test.setDatabase(90);
    test.client.setQueryData(key, profile(90));
    await applyUserDelta(test.client, key, { money: -10 }, revision);
    expect(test.value()?.userData.money).toBe(90);
    expect(test.reads()).toBe(1);
    test.close();
  });

  it("does not let a delayed absolute response overwrite a newer debit", async () => {
    const test = setup();
    const absoluteRevision = prepareUserDelta(test.client, key);
    const deltaRevision = prepareUserDelta(test.client, key);
    test.setDatabase(85);
    await applyUserDelta(test.client, key, { money: -10 }, deltaRevision);
    await applyUserDelta(test.client, key, {}, absoluteRevision, { money: 95 });
    expect(test.value()?.userData.money).toBe(85);
    expect(test.reads()).toBe(1);
    test.close();
  });

  it("refreshes the second overlapping delta instead of using an ambiguous snapshot", async () => {
    const test = setup();
    const first = await prepareUserDelta(test.client, key);
    const second = await prepareUserDelta(test.client, key);
    test.setDatabase(70);
    await applyUserDelta(test.client, key, { money: -10 }, first);
    await applyUserDelta(test.client, key, { money: -20 }, second);
    expect(test.value()?.userData.money).toBe(70);
    expect(test.reads()).toBe(1);
    test.close();
  });

  it("detects intervening writes even when they return to the original balance", async () => {
    const test = setup();
    const revision = await prepareUserDelta(test.client, key);
    test.client.setQueryData(key, profile(90));
    test.client.setQueryData(key, profile(100));
    test.setDatabase(90);
    await applyUserDelta(test.client, key, { money: -10 }, revision);
    expect(test.value()?.userData.money).toBe(90);
    expect(test.reads()).toBe(1);
    test.close();
  });

  it("restarts an unfinished query instead of discarding its reconciliation", async () => {
    const test = setup();
    const revision = await prepareUserDelta(test.client, key);
    let resolve!: (value: ReturnType<typeof profile>) => void;
    const pending = test.client.fetchQuery({
      queryKey: key,
      queryFn: () => new Promise<ReturnType<typeof profile>>((done) => { resolve = done; }),
    }).catch(() => undefined);
    test.observer.setOptions({ queryKey: key, staleTime: Infinity, queryFn: async () => profile(110) });
    await applyUserDelta(test.client, key, { money: -10 }, revision);
    resolve(profile(100));
    await pending;
    expect(test.value()?.userData.money).toBe(110);
    test.close();
  });

  it("honors an invalidation even when its query has not completed", async () => {
    const test = setup();
    const revision = await prepareUserDelta(test.client, key);
    test.client.getQueryCache().find({ queryKey: key })!.invalidate();
    test.setDatabase(110);
    await applyUserDelta(test.client, key, { money: -10 }, revision);
    expect(test.value()?.userData.money).toBe(110);
    expect(test.reads()).toBe(1);
    test.close();
  });

  it("refreshes when an identity-dependent patch cannot be applied", async () => {
    const test = setup();
    const revision = await prepareUserDelta(test.client, key);
    test.setDatabase(90);
    await applyUserDelta(test.client, key, {}, revision, () => undefined);
    expect(test.value()?.userData.money).toBe(90);
    expect(test.reads()).toBe(1);
    test.close();
  });

  it("refreshes when no confirmed delta is available", async () => {
    const test = setup();
    const revision = await prepareUserDelta(test.client, key);
    test.setDatabase(90);
    await applyUserDelta(test.client, key, undefined, revision);
    expect(test.value()?.userData.money).toBe(90);
    expect(test.reads()).toBe(1);
    test.close();
  });
});
