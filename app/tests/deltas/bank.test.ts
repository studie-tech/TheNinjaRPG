import { expect, it } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { getBankTransferUserUpdate, getTransferRyoUserUpdate } from "@/deltas/bank";
import type { UserCache } from "@/deltas/profile";
import type { UserWithRelations } from "@/server/api/routers/profile";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { userDeltaResponseSchema } from "@/validators/userCache";

const key = [["profile", "getUser"], { type: "query" }];

/** Observe bank responses through the shared profile cache binding, counting profile reads. */
const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const initial: UserCache = {
    userData: {
      userId: "banker",
      money: 1000,
      bank: 2000,
    } as NonNullable<UserWithRelations>,
    notifications: [],
  };
  client.setQueryData(key, initial);
  let reads = 0;
  const observer = new QueryObserver(client, {
    queryKey: key,
    staleTime: Infinity,
    queryFn: async () => {
      reads++;
      return initial;
    },
  });
  const unsubscribe = observer.subscribe(() => {});
  return {
    client,
    reads: () => reads,
    value: () => client.getQueryData<UserCache>(key)?.userData,
    close: () => {
      unsubscribe();
      client.clear();
    },
  };
};

it("moves the confirmed amount in the direction of the transfer", () => {
  expect(getTransferRyoUserUpdate({ fromPocket: true, value: 25 })).toEqual({
    userDelta: { money: -25, bank: 25 },
  });
  expect(getTransferRyoUserUpdate({ fromPocket: false, value: 25 })).toEqual({
    userDelta: { money: 25, bank: -25 },
  });
  expect(getBankTransferUserUpdate({ value: 40 })).toEqual({
    userDelta: { bank: -40 },
  });
});

it.each([
  ["deposit", getTransferRyoUserUpdate({ fromPocket: true, value: 300 }), 700, 2300],
  [
    "withdrawal",
    getTransferRyoUserUpdate({ fromPocket: false, value: 300 }),
    1300,
    1700,
  ],
  ["transfer", getBankTransferUserUpdate({ value: 300 }), 1000, 1700],
] as const)(
  "applies a %s to the profile cache without a profile read",
  async (_name, update, money, bank) => {
    const test = setup();
    try {
      const response = userDeltaResponseSchema.parse({
        success: true,
        message: "ok",
        ...update,
      });
      await updateUserCache(test.client, key, response, {
        revision: prepareUserUpdate(test.client, key),
      });
      expect(test.reads()).toBe(0);
      expect(test.value()).toMatchObject({ money, bank });
    } finally {
      test.close();
    }
  },
);

it("reconciles through one profile read when the cache changed after the mutation started", async () => {
  const test = setup();
  try {
    const revision = prepareUserUpdate(test.client, key);
    await updateUserCache(test.client, key, { money: 1500 });
    const response = userDeltaResponseSchema.parse({
      success: true,
      message: "ok",
      ...getTransferRyoUserUpdate({ fromPocket: true, value: 300 }),
    });
    await updateUserCache(test.client, key, response, { revision });
    expect(test.reads()).toBe(1);
  } finally {
    test.close();
  }
});
