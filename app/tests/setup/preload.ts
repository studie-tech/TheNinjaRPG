/**
 * Registered via bunfig.toml: brings the shared test database up once per `bun test` run.
 * No-ops when TEST_MYSQL_URL is unset.
 *
 * The schema is left in place afterwards. `prepareTestDatabase` reconciles it on the next run
 * and truncates every table, so a leftover database makes the next run cheaper without letting
 * its rows leak into it.
 */
import { afterAll, beforeAll } from "vitest";
import { closeTestDatabase, hasTestDatabase, prepareTestDatabase } from "./testDatabase";

if (hasTestDatabase) {
  // Reconciling the schema is slower than a unit test's default budget.
  beforeAll(async () => {
    await prepareTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await closeTestDatabase();
  }, 60_000);
}
