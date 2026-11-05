/**
 * Registered via bunfig.toml: brings the shared test database up once per `bun test` run.
 * No-ops when TEST_MYSQL_URL is unset.
 *
 * The schema is left in place afterwards. `prepareTestDatabase` reconciles it on the next run
 * and truncates every table, so a leftover database makes the next run cheaper without letting
 * its rows leak into it.
 */
import { afterAll, beforeAll, beforeEach } from "bun:test";
import Link from "@/layout/Link";
import RichInput from "@/layout/RichInput";
import ContentImageSelector from "@/layout/ContentImageSelector";
import ContentBox from "@/layout/ContentBox";
import ItemWithEffects from "@/layout/ItemWithEffects";
import * as gamesettings from "@/libs/gamesettings";
import { resetPvpExperienceAverageCache } from "@/server/utils/pvpExperience";
import {
  closeTestDatabase,
  hasTestDatabase,
  prepareTestDatabase,
} from "./testDatabase";
// Bun preserves loaded exports when a suite supplies a partial module mock.
// Load the toast module before any suite can hide exports needed by another suite.
import * as toast from "@/libs/toast";
import * as userContext from "@/utils/UserContext";

// UI suites can restore real components and feedback after another suite mocks their module.
export const actualLink = Link;
export const actualRichInput = RichInput;
export const actualItemWithEffects = ItemWithEffects;
export const actualContentImageSelector = ContentImageSelector;
export const actualContentBox = ContentBox;
export const actualShowMutationToast = toast.showMutationToast;
export const actualUserContext = { ...userContext };

// Cron SQL suites restore real timers after unit suites replace the module exports.
export const actualGameSettings = { ...gamesettings };

// Suites seed their own player populations, so none may read another suite's cached average.
beforeEach(() => {
  resetPvpExperienceAverageCache();
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
