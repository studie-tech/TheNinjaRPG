import { beforeEach, expect, it } from "bun:test";
import type { AnyProcedure, inferProcedureInput } from "@trpc/server";
import { IMG_AVATAR_DEFAULT, type UserRole } from "@/drizzle/constants";
import { bloodline, item, jutsu, quest, userData } from "@/drizzle/schema";
import { fetchCanListHiddenContent } from "@/queries/profile";
import { bloodlineRouter } from "@/server/api/routers/bloodline";
import { dataRouter } from "@/server/api/routers/data";
import { itemRouter } from "@/server/api/routers/item";
import { jutsuRouter } from "@/server/api/routers/jutsu";
import { questsRouter } from "@/server/api/routers/quests";
import {
  insertItems,
  insertJutsus,
  insertQuests,
  insertUsers,
} from "../../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
  resolverOf,
} from "../../../setup/testDatabase";

const contentId = "catalogue-content";
const moderatorId = "catalogue-moderator";
const playerId = "catalogue-player";

/** Viewer id; null is a signed-out visitor. */
type Viewer = string | null;

/**
 * Run a public procedure's resolver as `userId`. Middleware (rate limits, bot checks) is
 * outside this visibility policy.
 */
const run = async <Procedure extends AnyProcedure>(
  procedure: Procedure,
  userId: Viewer,
  input: inferProcedureInput<Procedure>,
) =>
  resolverOf(procedure)({ ctx: { drizzle: await getTestDatabase(), userId }, input });

const ids = (rows: { id: string }[]) => rows.map((row) => row.id).sort();

/** Balance statistics only match on the tag type, so a minimal tag is enough. */
const effect = [{ type: "heal", rounds: 1, power: 1 }] as never[];

/** Every hidden-aware public catalogue, asked for hidden entries, as `userId`. */
const listHidden = async (userId: Viewer) => ({
  items: ids((await run(itemRouter.getAll, userId, { limit: 50, hidden: true })).data),
  jutsu: ids((await run(jutsuRouter.getAll, userId, { limit: 50, hidden: true })).data),
  bloodlines: ids(
    (await run(bloodlineRouter.getAll, userId, { limit: 50, hidden: true })).data,
  ),
  quests: ids(
    (await run(questsRouter.getAll, userId, { limit: 50, hidden: true })).data,
  ),
  itemStats: ids(
    await run(dataRouter.getItemEffectsBalanceStatistics, userId, {
      effect: ["heal"],
      hidden: true,
    }),
  ),
  jutsuStats: ids(
    await run(dataRouter.getJutsuEffectsBalanceStatistics, userId, {
      effect: ["heal"],
      hidden: true,
    }),
  ),
  bloodlineStats: ids(
    await run(dataRouter.getBloodlineEffectsBalanceStatistics, userId, {
      effect: ["heal"],
      hidden: true,
    }),
  ),
});

/** Every public name list (content pickers, name lookups), as `userId`. */
const listNames = async (userId: Viewer) => ({
  items: ids(await run(itemRouter.getAllNames, userId, undefined)),
  jutsu: ids(await run(jutsuRouter.getAllNames, userId, undefined)),
  bloodlines: ids(await run(bloodlineRouter.getAllNames, userId, undefined)),
  quests: ids(await run(questsRouter.getAllNames, userId, undefined)),
});

/**
 * Public catalogues list hidden (unreleased) entries only for signed-in content staff. A
 * signed-out visitor, a player or a non-content staff member asking for `hidden: true` gets
 * released entries only.
 */
describeWithDatabase("hidden catalogue entries", () => {
  beforeEach(async () => {
    await resetTables(userData, item, jutsu, bloodline, quest);
    const users: { userId: string; role: UserRole }[] = [
      { userId: contentId, role: "CONTENT" },
      { userId: moderatorId, role: "MODERATOR" },
      { userId: playerId, role: "USER" },
    ];
    await insertUsers(users.map((user) => ({ ...user, username: user.userId })));
    await insertItems([
      { id: "item-open", name: "Open Item", effects: effect },
      { id: "item-secret", name: "Secret Item", hidden: true, effects: effect },
    ]);
    await insertJutsus([
      { id: "jutsu-open", name: "Open Jutsu", effects: effect },
      { id: "jutsu-secret", name: "Secret Jutsu", hidden: true, effects: effect },
    ]);
    const db = await getTestDatabase();
    await db.insert(bloodline).values(
      [
        { id: "line-open", name: "Open Line", hidden: false },
        { id: "line-secret", name: "Secret Line", hidden: true },
      ].map((entry) => ({
        ...entry,
        rank: "D" as const,
        image: IMG_AVATAR_DEFAULT,
        description: entry.name,
        effects: effect,
      })),
    );
    await insertQuests([
      { id: "quest-open", name: "Open Quest" },
      { id: "quest-secret", name: "Secret Quest", hidden: true },
    ]);
  });

  it("lets only signed-in content staff list hidden content", async () => {
    const db = await getTestDatabase();
    expect(await fetchCanListHiddenContent(db, contentId)).toBe(true);
    expect(await fetchCanListHiddenContent(db, moderatorId)).toBe(false);
    expect(await fetchCanListHiddenContent(db, playerId)).toBe(false);
    expect(await fetchCanListHiddenContent(db, "missing-user")).toBe(false);
    expect(await fetchCanListHiddenContent(db, null)).toBe(false);
  });

  const outsiders: [string, Viewer][] = [
    ["a signed-out visitor", null],
    ["a player", playerId],
    ["a moderator", moderatorId],
  ];
  for (const [who, userId] of outsiders) {
    it(`lists only released entries for ${who} asking for hidden ones`, async () => {
      expect(await listHidden(userId)).toEqual({
        items: ["item-open"],
        jutsu: ["jutsu-open"],
        bloodlines: ["line-open"],
        quests: ["quest-open"],
        itemStats: ["item-open"],
        jutsuStats: ["jutsu-open"],
        bloodlineStats: ["line-open"],
      });
    });

    it(`names only released entries for ${who}`, async () => {
      // getAllNames used to return hidden names and images to any caller.
      expect(await listNames(userId)).toEqual({
        items: ["item-open"],
        jutsu: ["jutsu-open"],
        bloodlines: ["line-open"],
        quests: ["quest-open"],
      });
    });

    it(`lists only released quests for ${who} without a hidden filter`, async () => {
      // An unset filter used to list every quest, hidden ones included.
      const quests = await run(questsRouter.getAll, userId, { limit: 50 });
      expect(ids(quests.data)).toEqual(["quest-open"]);
    });
  }

  it("names hidden entries for content staff pickers", async () => {
    expect(await listNames(contentId)).toEqual({
      items: ["item-open", "item-secret"],
      jutsu: ["jutsu-open", "jutsu-secret"],
      bloodlines: ["line-open", "line-secret"],
      quests: ["quest-open", "quest-secret"],
    });
  });

  it("keeps the hidden filter working for content staff", async () => {
    expect(await listHidden(contentId)).toEqual({
      items: ["item-secret"],
      jutsu: ["jutsu-secret"],
      bloodlines: ["line-secret"],
      quests: ["quest-secret"],
      itemStats: ["item-secret"],
      jutsuStats: ["jutsu-secret"],
      bloodlineStats: ["line-secret"],
    });
    // Released-only and unset filters keep their previous meaning for staff.
    const visible = { limit: 50, hidden: false };
    expect(ids((await run(itemRouter.getAll, contentId, visible)).data)).toEqual([
      "item-open",
    ]);
    expect(ids((await run(itemRouter.getAll, contentId, { limit: 50 })).data)).toEqual([
      "item-open",
    ]);
    expect(ids((await run(jutsuRouter.getAll, contentId, { limit: 50 })).data)).toEqual(
      ["jutsu-open"],
    );
    expect(
      ids((await run(bloodlineRouter.getAll, contentId, { limit: 50 })).data),
    ).toEqual(["line-open"]);
    // Quest editors keep "All Visibility" (unset).
    expect(
      ids((await run(questsRouter.getAll, contentId, { limit: 50 })).data),
    ).toEqual(["quest-open", "quest-secret"]);
    expect(ids((await run(questsRouter.getAll, contentId, visible)).data)).toEqual([
      "quest-open",
    ]);
  });
});
