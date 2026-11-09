import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { expect, it } from "bun:test";
import type { UserCache } from "@/deltas/profile";
import type { UserWithRelations } from "@/server/api/routers/profile";
import { AUTO_WAKE_MESSAGE } from "@/libs/actionReadiness";
import { actionReadinessResponse } from "@/server/utils/actionReadiness";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import type { UserRecovery } from "@/validators/base";
import { userDeltaResponseSchema } from "@/validators/userCache";
import { afterTasks } from "../setup/after";

const key = [["profile", "getUser"], { type: "query" }];

/** Observe our profile binding with a real cache and count authoritative reconciliation requests. */
const setup = (status: "ASLEEP" | "HOSPITALIZED" = "ASLEEP") => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const initial: UserCache = {
    userData: {
      userId: "actor",
      status,
      battleId: null,
      money: 100,
      pveFights: 2,
      curHealth: 1,
      curChakra: 2,
      curStamina: 3,
      curEnergy: 4,
      rank: "JONIN",
      level: 50,
      earnedExperience: 0,
      isOutlaw: true,
    } as NonNullable<UserWithRelations>,
    notifications: [{ href: "/hospital", name: "In hospital", color: "red" }],
  };
  const canonical: UserCache = {
    ...initial,
    userData: { ...initial.userData!, status: "BATTLE", battleId: "battle", money: 90 },
  };
  client.setQueryData(key, initial);
  let reads = 0;
  const observer = new QueryObserver(client, {
    queryKey: key,
    staleTime: Infinity,
    queryFn: async () => {
      reads++;
      return canonical;
    },
  });
  const unsubscribe = observer.subscribe(() => {});
  return {
    client,
    initial,
    canonical,
    reads: () => reads,
    value: () => client.getQueryData<UserCache>(key),
    close: () => {
      unsubscribe();
      client.clear();
    },
  };
};

const recovery = {
  userId: "actor",
  activity: { status: "AWAKE" as const, battleId: null },
  userPatch: {
    status: "AWAKE" as const,
    curHealth: 100,
    curChakra: 90,
    curStamina: 80,
    curEnergy: 70,
  },
};

it("withholds defeated compensation fields while preserving publication, feedback and the cached battle without a read", async () => {
  const test = setup();
  try {
    test.client.setQueryData(key, test.canonical);
    const before = test.value();
    const tasks: Array<() => unknown> = [];
    const response = afterTasks.run(tasks, () =>
      actionReadinessResponse(
        {
          success: false,
          message: "Queue changed",
          userRecovery: recovery as UserRecovery,
        },
        {
          initial: test.initial.userData!,
          user: { ...test.initial.userData!, status: "AWAKE" },
          userRecovery: recovery,
          notice: AUTO_WAKE_MESSAGE,
        },
        {} as never,
        null,
      ),
    );
    expect(response).toMatchObject({
      actionNotice: AUTO_WAKE_MESSAGE,
      message: `Queue changed ${AUTO_WAKE_MESSAGE}`,
    });
    expect(response.userRecovery).toEqual({
      userId: "actor",
      requiresUserRefresh: true,
    });
    expect(tasks).toHaveLength(1);
    expect(
      await updateUserCache(test.client, key, response, {
        revision: prepareUserUpdate(test.client, key),
      }),
    ).toBe(false);
    expect(test.value()).toBe(before);
    expect(test.reads()).toBe(0);
    expect(test.client.getQueryState(key)?.isInvalidated).toBe(false);
  } finally {
    test.close();
  }
});

it.each(["ASLEEP", "HOSPITALIZED"] as const)(
  "applies %s recovery before the action in one cache write without a profile read",
  async (status) => {
    const test = setup(status);
    try {
      const revision = prepareUserUpdate(test.client, key);
      const response = userDeltaResponseSchema.parse({
        success: true,
        message: "Started",
        userRecovery: recovery,
        userExpected: { status: "AWAKE" },
        userPatch: { status: "BATTLE", battleId: "battle" },
        userDelta: { money: -10, pveFights: 1 },
      });
      expect(await updateUserCache(test.client, key, response, { revision })).toBe(
        true,
      );
      expect(test.reads()).toBe(0);
      expect(test.value()?.userData).toMatchObject({
        status: "BATTLE",
        battleId: "battle",
        money: 90,
        pveFights: 3,
        curHealth: 100,
        curChakra: 90,
        curStamina: 80,
        curEnergy: 70,
      });
      expect(test.client.getQueryState(key)?.dataUpdateCount).toBe(revision! + 1);
      expect(
        test.value()?.notifications?.some((entry) => entry.name === "In hospital"),
      ).toBe(false);
      expect(
        test.value()?.notifications?.some((entry) => entry.name === "In combat"),
      ).toBe(true);
    } finally {
      test.close();
    }
  },
);

it("retains nested hospital payment/pool results and committed recovery on failed actions", async () => {
  const test = setup("HOSPITALIZED");
  try {
    const revision = prepareUserUpdate(test.client, key);
    await updateUserCache(
      test.client,
      key,
      { curChakra: 65, medicalExperience: 5 },
      { revision, userRecovery: recovery },
    );
    expect(test.reads()).toBe(0);
    expect(test.value()?.userData).toMatchObject({
      status: "AWAKE",
      curHealth: 100,
      curChakra: 65,
      medicalExperience: 5,
    });
    await updateUserCache(
      test.client,
      key,
      { success: false, userPatch: {}, userDelta: {}, userRecovery: recovery },
      { revision: prepareUserUpdate(test.client, key) },
    );
    expect(test.reads()).toBe(0);
    expect(test.value()?.userData?.status).toBe("AWAKE");
  } finally {
    test.close();
  }
});

it.each(["revision", "identity"] as const)(
  "preserves unknown %s state without an extra read or unsafe partial patch",
  async (reason) => {
    const test = setup();
    try {
      const revision = prepareUserUpdate(test.client, key);
      if (reason === "revision")
        test.client.setQueryData(key, { ...test.initial, notifications: [] });
      const before = test.value();
      await updateUserCache(
        test.client,
        key,
        {
          success: true,
          userPatch: { status: "BATTLE", battleId: "battle" },
          userDelta: {},
          userRecovery:
            reason === "identity" ? { ...recovery, userId: "another-user" } : recovery,
        },
        { revision },
      );
      expect(test.reads()).toBe(0);
      expect(test.value()).toBe(before);
      expect(test.client.getQueryState(key)?.isInvalidated).toBe(false);
    } finally {
      test.close();
    }
  },
);

it("applies known recovery and final action fields while leaving unmodelled balances intact", async () => {
  const test = setup();
  try {
    const applied = await updateUserCache(
      test.client,
      key,
      {
        success: true,
        userPatch: { status: "BATTLE", battleId: "battle" },
        userDelta: {},
        userRecovery: { ...recovery, requiresUserRefresh: true },
      },
      { revision: prepareUserUpdate(test.client, key) },
    );
    expect(applied).toBe(false);
    expect(test.reads()).toBe(0);
    expect(test.value()?.userData).toMatchObject({
      status: "BATTLE",
      battleId: "battle",
      curHealth: 100,
      curChakra: 90,
      curStamina: 80,
      curEnergy: 70,
      money: 100,
      pveFights: 2,
    });
    expect(test.client.getQueryState(key)?.isInvalidated).toBe(false);
  } finally {
    test.close();
  }
});

it.each(["AWAKE", "BATTLE", "TRAVEL", "QUEUED"] as const)(
  "applies confirmed %s activity when feature fields are withheld",
  async (status) => {
    const test = setup();
    try {
      const activity = { status, battleId: status === "BATTLE" ? "battle" : null };
      expect(
        await updateUserCache(
          test.client,
          key,
          {
            success: true,
            userPatch: undefined,
            userDelta: undefined,
            userRecovery: { ...recovery, activity },
          },
          { revision: prepareUserUpdate(test.client, key) },
        ),
      ).toBe(false);
      expect(test.value()?.userData).toMatchObject({
        ...activity,
        money: 100,
        pveFights: 2,
        curEnergy: 4,
      });
      expect(test.reads()).toBe(0);
      expect(test.client.getQueryState(key)?.isInvalidated).toBe(false);
    } finally {
      test.close();
    }
  },
);

it("applies committed waking independently of a rejected action cache guard", async () => {
  const test = setup();
  try {
    expect(
      await updateUserCache(
        test.client,
        key,
        {
          success: false,
          userPatch: {},
          userDelta: {},
          userExpected: { status: "TRAVEL" },
          userRecovery: recovery,
        },
        { revision: prepareUserUpdate(test.client, key) },
      ),
    ).toBe(false);
    expect(test.value()?.userData).toMatchObject({
      status: "AWAKE",
      battleId: null,
      money: 100,
      curEnergy: 4,
    });
    expect(test.reads()).toBe(0);
  } finally {
    test.close();
  }
});
