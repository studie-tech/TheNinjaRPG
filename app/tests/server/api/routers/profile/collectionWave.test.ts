import { expect, it, mock } from "bun:test";
import { fetchUpdatedUser } from "@/server/api/routers/profile";
import type { DrizzleClient } from "@/server/db";
import { deferred } from "../../../../setup/deferred";

it("starts collection reads before the initial profile read settles", async () => {
  const { promise: pendingUser, resolve: resolveUser } = deferred<undefined>();
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
  // The catalogue read follows its Runtime Cache lookup; the profile read stays pending.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(findCatalogue).toHaveBeenCalledTimes(1);
  expect(findRolls).toHaveBeenCalledTimes(1);
  resolveUser(undefined);
  expect((await result).user).toBeUndefined();
});
