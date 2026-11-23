import { seedPublishedBuildings } from "../drizzle/seeds/structures";
import type { DrizzleClient } from "../src/server/db";
import { isLocalDevDatabase } from "./dev-database";

/** Managed servers use published building artwork without connecting to production. */
export const prepareDevBuildings = async ({
  databaseUrl,
  client,
}: {
  databaseUrl: string | undefined;
  client?: DrizzleClient;
}) => {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL ||
    process.env.VERCEL_ENV ||
    !isLocalDevDatabase(databaseUrl)
  )
    return { status: "skipped" as const };
  const database = client ?? (await import("../src/server/db")).drizzleDB;
  return {
    status: "ready" as const,
    ...(await seedPublishedBuildings(database)),
  };
};

if (import.meta.main) {
  try {
    console.log(
      `dev-buildings: ${JSON.stringify(await prepareDevBuildings({ databaseUrl: process.env.DATABASE_URL }))}`,
    );
  } catch {
    // Driver errors can contain SQL and credentials; startup reports recovery without those details.
    console.error(
      "dev-buildings: Could not prepare buildings. Check the local database and apply its schema migrations, then run make dev-prepare.",
    );
    process.exitCode = 1;
  }
}
