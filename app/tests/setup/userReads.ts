import { eq } from "drizzle-orm";
import { userData } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { overrideQuery } from "./statements";
import { getTestDatabase } from "./testDatabase";

/** The stored row for `userId`, through `client` when a test holds an observed connection. */
export const readUser = async (userId: string, client?: DrizzleClient) =>
  (client ?? (await getTestDatabase())).query.userData.findFirst({
    where: eq(userData.userId, userId),
  });

/** Like `readUser`, for a row the test expects to exist. */
export const requireUser = async (userId: string, client?: DrizzleClient) => {
  const user = await readUser(userId, client);
  if (!user) throw new Error(`Missing user ${userId}`);
  return user;
};

type UserRead = Parameters<DrizzleClient["query"]["userData"]["findFirst"]>[0];

/**
 * Observe profile reads on one caller without changing the shared database client.
 * `counts` limits the tally to the reads it accepts.
 */
export const countUserReads = (
  database: DrizzleClient,
  counts: (options: UserRead) => boolean = () => true,
) => {
  let reads = 0;
  let userWrites = 0;
  const counted = overrideQuery(database, "userData", {
    findFirst: (read, ...args) => {
      if (counts(args[0])) reads += 1;
      return read(...args);
    },
  });
  const client = new Proxy(counted, {
    get(target, property, receiver) {
      if (property === "update") {
        return (table: Parameters<typeof target.update>[0]) => {
          if (table === userData) userWrites += 1;
          return target.update(table);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
  return { client, getReads: () => reads, getUserWrites: () => userWrites };
};
