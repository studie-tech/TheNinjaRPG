import { expect, it, mock } from "bun:test";
import { fetchUpdatedUser } from "@/server/api/routers/profile";
import type { DrizzleClient } from "@/server/db";

it("starts collection reads before the initial profile read settles", async () => {
  const { promise: pendingUser, resolve: resolveUser } = Promise.withResolvers<undefined>();
  const findCatalogue = mock(async () => []);
  const findRolls = mock(async () => []);
  // The other opening-wave catalogue queries return no content in this fixture.
  const emptySelect = {
    from: () => emptySelect,
    where: () => emptySelect,
    leftJoin: () => emptySelect,
    innerJoin: () => emptySelect,
    limit: () => emptySelect,
    then: (resolve: (rows: never[]) => void) => resolve([]),
  };
  const client = {
    select: () => emptySelect,
    query: {
      userData: { findFirst: () => pendingUser },
      bloodline: { findMany: findCatalogue },
      bloodlineRolls: { findMany: findRolls },
      war: { findMany: async () => [] },
      mpvpBattleQueue: { findMany: async () => [] },
      quest: { findMany: async () => [] },
    },
  } as unknown as DrizzleClient;
  const result = fetchUpdatedUser({ client, userId: "collection-wave" });
  // Promise.all assimilates Drizzle's lazy thenables in microtasks.
  await Promise.resolve();
  expect(findCatalogue).toHaveBeenCalledTimes(1);
  expect(findRolls).toHaveBeenCalledTimes(1);
  resolveUser(undefined);
  expect((await result).user).toBeUndefined();
});
