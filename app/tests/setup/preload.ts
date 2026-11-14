/**
 * Registered via bunfig.toml: brings the shared test database up once per `bun test` run.
 * No-ops when TEST_MYSQL_URL is unset.
 *
 * Direct serial runs retain the schema for reconciliation on the next run. The sharded runner
 * removes its invocation-owned schemas after every worker closes its pool. Setup truncates all
 * tables and removes triggers so neither rows nor fault injections leak between serial runs.
 */
import { afterAll, beforeAll, beforeEach } from "bun:test";
import { useAbVariant } from "@/hooks/useAbVariant";
import ContentBox from "@/layout/ContentBox";
import Image from "@/layout/Image";
import Link from "@/layout/Link";
// Bun preserves loaded exports when a suite supplies a partial module mock.
// Load the toast module before any suite can hide exports needed by another suite.
import * as toast from "@/libs/toast";
import { invalidateInstanceCaches } from "@/server/utils/instanceCache";
import { invalidateLpcCatalog } from "@/server/utils/lpcCatalog";
import { resetPvpExperienceAverageCache } from "@/server/utils/pvpExperience";
import * as userContext from "@/utils/UserContext";
import {
  closeTestDatabase,
  hasTestDatabase,
  prepareTestDatabase,
} from "./testDatabase";

// UI suites can restore real components and feedback after another suite mocks their module.
export const actualLink = Link;
export const actualContentBox = ContentBox;
export const actualImage = Image;
export const actualShowMutationToast = toast.showMutationToast;
export const actualUserContext = { ...userContext };
export const actualUseAbVariant = useAbVariant;

// Suites seed their own players and content, so none may read another suite's cache.
beforeEach(() => {
  resetPvpExperienceAverageCache();
  invalidateInstanceCaches();
  invalidateLpcCatalog();
});

if (hasTestDatabase) {
  // Reconciling the schema is slower than a unit test's default budget.
  beforeAll(async () => {
    await prepareTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await closeTestDatabase();
  }, 60_000);
}
