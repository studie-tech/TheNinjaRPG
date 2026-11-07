import { eq } from "drizzle-orm";
import { userData } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
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

/** Observe profile reads on one caller without changing the shared database client. */
export const countUserReads = (database: DrizzleClient) => {
  let reads = 0;
  let userWrites = 0;
  const userQueries = new Proxy(database.query.userData, {
    get(target, property, receiver) {
      if (property === "findFirst") {
        return (...args: Parameters<typeof target.findFirst>) => {
          reads += 1;
          return target.findFirst(...args);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
  const client = new Proxy(database, {
    get(target, property, receiver) {
      if (property === "update") {
        return (table: Parameters<typeof target.update>[0]) => {
          if (table === userData) userWrites += 1;
          return target.update(table);
        };
      }
      if (property === "query") return { ...target.query, userData: userQueries };
      return Reflect.get(target, property, receiver);
    },
  });
  return { client, getReads: () => reads, getUserWrites: () => userWrites };
};
