import { userData } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/** Observe profile reads on one caller without changing the shared database client. */
export const countUserReads = (database: DrizzleClient) => {
  let reads = 0;
  let userWrites = 0;
  let villageReads = 0;
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
  const villageQueries = new Proxy(database.query.village, {
    get(target, property, receiver) {
      if (property === "findFirst") {
        return (...args: Parameters<typeof target.findFirst>) => {
          villageReads += 1;
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
      if (property === "query") return { ...target.query, userData: userQueries, village: villageQueries };
      return Reflect.get(target, property, receiver);
    },
  });
  return { client, getReads: () => reads, getVillageReads: () => villageReads, getUserWrites: () => userWrites };
};
