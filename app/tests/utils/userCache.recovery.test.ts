import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { expect, it } from "bun:test";
import type { UserCache } from "@/deltas/profile";
import type { UserWithRelations } from "@/server/api/routers/profile";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { userDeltaResponseSchema } from "@/validators/userCache";

const key = [["profile", "getUser"], { type: "query" }];

/** Observe our profile binding with a real cache and count authoritative reconciliation requests. */
const setup = (status: "ASLEEP" | "HOSPITALIZED" = "ASLEEP") => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const initial: UserCache = { userData: {
    userId: "actor", status, battleId: null, money: 100, pveFights: 2,
    curHealth: 1, curChakra: 2, curStamina: 3, curEnergy: 4,
    rank: "JONIN", level: 50, earnedExperience: 0, isOutlaw: true,
  } as NonNullable<UserWithRelations>, notifications: [{ href: "/hospital", name: "In hospital", color: "red" }] };
  const canonical: UserCache = { ...initial, userData: { ...initial.userData!, status: "BATTLE", battleId: "battle", money: 90 } };
  client.setQueryData(key, initial);
  let reads = 0;
  const observer = new QueryObserver(client, { queryKey: key, staleTime: Infinity,
    queryFn: async () => { reads++; return canonical; } });
  const unsubscribe = observer.subscribe(() => {});
  return { client, initial, canonical, reads: () => reads,
    value: () => client.getQueryData<UserCache>(key),
    close: () => { unsubscribe(); client.clear(); } };
};

const recovery = { userId: "actor", userPatch: {
  status: "AWAKE" as const, curHealth: 100, curChakra: 90, curStamina: 80, curEnergy: 70,
} };

it.each(["ASLEEP", "HOSPITALIZED"] as const)("applies %s recovery before the action in one cache write without a profile read", async (status) => {
  const test = setup(status);
  try {
    const revision = prepareUserUpdate(test.client, key);
    const response = userDeltaResponseSchema.parse({ success: true, message: "Started", userRecovery: recovery,
      userExpected: { status: "AWAKE" }, userPatch: { status: "BATTLE", battleId: "battle" },
      userDelta: { money: -10, pveFights: 1 } });
    expect(await updateUserCache(test.client, key, response, { revision })).toBe(true);
    expect(test.reads()).toBe(0);
    expect(test.value()?.userData).toMatchObject({ status: "BATTLE", battleId: "battle", money: 90,
      pveFights: 3, curHealth: 100, curChakra: 90, curStamina: 80, curEnergy: 70 });
    expect(test.client.getQueryState(key)?.dataUpdateCount).toBe(revision! + 1);
    expect(test.value()?.notifications?.some((entry) => entry.name === "In hospital")).toBe(false);
    expect(test.value()?.notifications?.some((entry) => entry.name === "In combat")).toBe(true);
  } finally { test.close(); }
});

it("retains nested hospital payment/pool results and committed recovery on failed actions", async () => {
  const test = setup("HOSPITALIZED");
  try {
    const revision = prepareUserUpdate(test.client, key);
    await updateUserCache(test.client, key, { curChakra: 65, medicalExperience: 5 }, { revision, userRecovery: recovery });
    expect(test.reads()).toBe(0);
    expect(test.value()?.userData).toMatchObject({ status: "AWAKE", curHealth: 100, curChakra: 65, medicalExperience: 5 });
    await updateUserCache(test.client, key, { success: false, userPatch: {}, userDelta: {}, userRecovery: recovery },
      { revision: prepareUserUpdate(test.client, key) });
    expect(test.reads()).toBe(0);
    expect(test.value()?.userData?.status).toBe("AWAKE");
  } finally { test.close(); }
});

it.each(["feature", "recovery", "revision", "identity"] as const)("reconciles genuinely unknown %s state instead of publishing an unsafe partial patch", async (reason) => {
  const test = setup();
  try {
    const revision = prepareUserUpdate(test.client, key);
    if (reason === "revision") test.client.setQueryData(key, { ...test.initial, notifications: [] });
    await updateUserCache(test.client, key, {
      success: true,
      userPatch: reason === "feature" ? undefined : { status: "BATTLE", battleId: "battle" },
      userDelta: reason === "feature" ? undefined : {},
      userRecovery: reason === "recovery" ? { ...recovery, requiresUserRefresh: true }
        : reason === "identity" ? { ...recovery, userId: "another-user" } : recovery,
    }, { revision });
    expect(test.reads()).toBe(1);
    expect(test.value()).toEqual(test.canonical);
  } finally { test.close(); }
});
