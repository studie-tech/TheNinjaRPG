import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { GET as expireMatches } from "@/app/api/kessen-match-expiry/route";
import {
  KESSEN_ACADEMY_GRADUATION_PACK_ID,
  KESSEN_ACADEMY_LESSON_RYO,
  KESSEN_DAILY_REWARDED_MATCHES,
  KESSEN_LACQUER_RARE_SLOT_WEIGHTS,
  KESSEN_MATCH_LOSS_RYO,
  KESSEN_MATCH_WIN_RYO,
  KESSEN_PACK_RARE_SLOT_WEIGHTS,
  KESSEN_PACK_SLOT_WEIGHTS,
} from "@/drizzle/constants";
import {
  gameSetting,
  item,
  kessenDeck,
  kessenMatch,
  kessenNpcProgress,
  kessenProgress,
  quest,
  questHistory,
  userData,
  userItem,
} from "@/drizzle/schema";
import {
  academyAdvice,
  KESSEN_ACADEMY_LESSON_KEYS,
  type KessenAcademyLessonKey,
} from "@/libs/kessen/academy";
import { aiRng, decide } from "@/libs/kessen/ai";
import { kessenCardToCardData, snapshotCatalog } from "@/libs/kessen/catalog";
import { KESSEN_DECK_RULES, starterDeck } from "@/libs/kessen/deck";
import { createMatch } from "@/libs/kessen/engine";
import { KESSEN_PACK_IDS } from "@/libs/kessen/packs";
import { CARD_ENGINE_VERSION } from "@/libs/kessen/rules";
import type { KessenAction } from "@/libs/kessen/types";
import { kessenRouter } from "@/server/api/routers/kessen";
import { kessenCollectionRouter } from "@/server/api/routers/kessenCollection";
import { buildKessenPackEffects, KESSEN_PACKS } from "@/server/utils/kessenPacks";
import { getUtcDayKey, periodStart } from "@/utils/time";
import { CARD_ITEM_DEFAULTS } from "@/validators/itemCard";
import type { KessenMatchPayload, KessenStoredMatch } from "@/validators/kessen";
import {
  type QuestTrackerType,
  QuestValidatorRawSchema,
  WinKessenChallenge,
} from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { KESSEN_SEED_CATALOG } from "../../../libs/kessen/fixtures/catalog";
import { restoreEnvAfterEach } from "../../../setup/env";
import {
  insertItems,
  insertQuestHistory,
  insertQuests,
  insertUserItems,
  insertUsers,
} from "../../../setup/factories";
import { aroundStatements } from "../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
  resolverOf,
} from "../../../setup/testDatabase";

const PLAYER = "kessen-player";
const START_MONEY = 1_000;
const POOL = snapshotCatalog(KESSEN_SEED_CATALOG);
const PACKS = [
  KESSEN_PACK_IDS.paper,
  KESSEN_PACK_IDS.first,
  KESSEN_PACK_IDS.lacquer,
  KESSEN_PACK_IDS.village("AKASUMI"),
  KESSEN_PACK_IDS.village("AKIKAZE"),
];
/** Seeds tried, in order, until the test player wins against Lemu. */
const SEEDS = ["seed-a", "seed-b", "seed-c", "seed-d", "seed-e", "seed-f", "seed-g"];

const api = () => callerFor(kessenRouter, PLAYER);
const db = () => getTestDatabase();

const money = async () =>
  (await (await db()).select().from(userData).where(eq(userData.userId, PLAYER)))[0]
    ?.money;
const progress = async () => (await (await db()).select().from(kessenProgress))[0];
const matchRow = async (id: string) =>
  (await (await db()).select().from(kessenMatch).where(eq(kessenMatch.id, id)))[0];
const owned = async (itemId: string) =>
  (await (await db()).select().from(userItem))
    .filter((row) => row.itemId === itemId)
    .reduce((sum, row) => sum + row.quantity, 0);

/** Progress whose first Academy lesson is done, which opens the Circuit. */
const FIRST_LESSON_DONE = { "first-blood": "earlier-match" };

/** The week key of the current UTC week (its Monday). */
const thisWeek = () => getUtcDayKey(periodStart("weekly", new Date()));

/** Sets progress fields, creating the row when needed. */
const setProgress = async (patch: Partial<typeof kessenProgress.$inferInsert>) => {
  const database = await db();
  await database
    .insert(kessenProgress)
    .values({
      userId: PLAYER,
      academy: {},
      seenKeywords: [],
      npcWinsToday: {},
      ...patch,
    })
    .onDuplicateKeyUpdate({ set: patch });
};

/** The human's policy in tests: the Chunin AI on a fixed stream, deterministic per match. */
const humanAction = (payload: KessenMatchPayload): KessenAction =>
  decide(
    payload.view,
    0,
    { tier: "CHUNIN" },
    aiRng("test-human", 0, payload.view.step),
    {
      pool: POOL,
    },
  );

/** Replaces a fresh match's shuffle with a known seed, keeping both deck lists. */
const reseed = async (matchId: string, seed: string) => {
  const row = await matchRow(matchId);
  const stored = row?.state as unknown as KessenStoredMatch;
  const engine = stored.engine;
  const deckOf = (seat: 0 | 1) =>
    Object.entries(engine.inst)
      .filter(([id]) => id.startsWith(`s${seat}-`))
      .map(([, cardId]) => cardId)
      .sort();
  const next = createMatch({
    seed,
    seats: [
      { leaderId: engine.seats[0].leader, deck: deckOf(0) },
      { leaderId: engine.seats[1].leader, deck: deckOf(1) },
    ],
    rules: engine.rules,
    cards: stored.pool,
  });
  await (await db())
    .update(kessenMatch)
    .set({ state: { ...stored, engine: next } as never })
    .where(eq(kessenMatch.id, matchId));
};

/** Ryo the match's auto-sold surplus drops paid. */
const soldRyo = (result: KessenMatchPayload["result"] | undefined) =>
  (result?.drops ?? []).reduce((sum, drop) => sum + (drop.soldFor ?? 0), 0);

/** Moves the match start back so the duration guard passes. */
const backdate = async (matchId: string, minutes = 10) =>
  (await db())
    .update(kessenMatch)
    .set({ startedAt: new Date(Date.now() - minutes * 60_000) })
    .where(eq(kessenMatch.id, matchId));

/** Plays the match to its end with the test policy; returns every response. */
const playOut = async (
  matchId: string,
  options: {
    doubleSubmit?: boolean;
    caller?: Awaited<ReturnType<typeof api>>;
  } = {},
) => {
  const caller = options.caller ?? (await api());
  const responses: Awaited<ReturnType<typeof caller.playTurn>>[] = [];
  for (let turn = 0; turn < 200; turn++) {
    const { match } = await caller.getMatch({ matchId });
    if (match?.status !== "ACTIVE") return { match, responses };
    const request = {
      matchId,
      version: match.version,
      action: humanAction(match),
    };
    if (options.doubleSubmit) {
      const both = await Promise.all([
        caller.playTurn(request),
        caller.playTurn(request),
      ]);
      expect(both.filter((response) => response.success)).toHaveLength(1);
      responses.push(...both);
    } else {
      const response = await caller.playTurn(request);
      expect(response.success, response.message).toBe(true);
      responses.push(response);
    }
  }
  throw new Error("The match did not end");
};

/** Starts loaner matches against Lemu with fixed seeds until the player wins one. */
const winAgainstLemu = async (
  options: { backdate?: boolean; caller?: Awaited<ReturnType<typeof api>> } = {},
) => {
  const caller = options.caller ?? (await api());
  for (const [attempt, seed] of SEEDS.entries()) {
    const started = await caller.startMatch({
      npcKey: "lemu",
      mode: "standard",
      deck: { source: "loaner", faction: "AKASUMI" },
      replaceActive: true,
    });
    if (!started.success || !("match" in started) || !started.match)
      throw new Error(started.message);
    await reseed(started.match.id, seed);
    if (options.backdate !== false) await backdate(started.match.id);
    const before = await money();
    const { match, responses } = await playOut(started.match.id, { caller });
    if (match?.result?.winner === 0)
      return { match, responses, before, attempts: attempt + 1 };
  }
  throw new Error("No seed produced a win");
};

/** Where the quest challenge objective sits; the player starts elsewhere. */
const TABLE_SPOT = { sector: 12, longitude: 4, latitude: 6 };
const TABLE_REQUEST = { questId: "table-quest", objectiveId: "table-goal" };

const moveTo = async (location: {
  sector: number;
  longitude: number;
  latitude: number;
}) => (await db()).update(userData).set(location).where(eq(userData.userId, PLAYER));

/** An active mission whose one objective is a Duel at the Table at `TABLE_SPOT`. */
const assignTableChallenge = async (rules: object) => {
  await insertQuests([
    {
      id: TABLE_REQUEST.questId,
      questType: "mission",
      content: {
        objectives: [
          WinKessenChallenge.parse({
            id: TABLE_REQUEST.objectiveId,
            task: "win_kessen_challenge",
            ...TABLE_SPOT,
            ...rules,
          }),
        ],
        reward: ObjectiveReward.parse({}),
        sceneBackground: "",
        sceneCharacters: [],
      },
    },
  ]);
  await insertQuestHistory([
    { userId: PLAYER, questId: TABLE_REQUEST.questId, questType: "mission" },
  ]);
};

/** The stored tracker goal of the challenge objective. */
const tableGoal = async () => {
  const [row] = await (await db())
    .select({ questData: userData.questData })
    .from(userData)
    .where(eq(userData.userId, PLAYER));
  return (row?.questData as QuestTrackerType[] | null)
    ?.find((tracker) => tracker.id === TABLE_REQUEST.questId)
    ?.goals.find((entry) => entry.id === TABLE_REQUEST.objectiveId);
};

/** Plays a lesson match to its end along the coach's advice. */
const playTaughtLine = async (
  matchId: string,
  options: { doubleSubmit?: boolean } = {},
) => {
  const caller = await api();
  for (let turn = 0; turn < 60; turn++) {
    const { match } = await caller.getMatch({ matchId });
    if (match?.status !== "ACTIVE") return match;
    const advice = academyAdvice(match.lesson as KessenAcademyLessonKey, match.view);
    if (advice?.kind !== "move") throw new Error("The coach has no move");
    const request = { matchId, version: match.version, action: advice.action };
    if (options.doubleSubmit) {
      const both = await Promise.all([
        caller.playTurn(request),
        caller.playTurn(request),
      ]);
      expect(both.filter((response) => response.success)).toHaveLength(1);
    } else {
      const response = await caller.playTurn(request);
      expect(response.success, response.message).toBe(true);
    }
  }
  throw new Error("The lesson did not end");
};

/** Starts a lesson (replacing an active match) and plays its taught line. */
const playLesson = async (lessonKey: KessenAcademyLessonKey) => {
  const started = await (await api()).startLesson({ lessonKey, replaceActive: true });
  if (!started.success) throw new Error(started.message);
  return playTaughtLine(started.match.id);
};

describeWithDatabase("kessen router", () => {
  restoreEnvAfterEach("CRON_SECRET");

  beforeEach(async () => {
    process.env.CRON_SECRET = "kessen-cron";
    await resetTables(
      kessenMatch,
      kessenProgress,
      kessenNpcProgress,
      kessenDeck,
      questHistory,
      quest,
      userItem,
      item,
      gameSetting,
      userData,
    );
    await insertUsers([
      { userId: PLAYER, username: "CardPlayer", money: START_MONEY, status: "AWAKE" },
    ]);
    await insertItems([
      ...KESSEN_SEED_CATALOG.map((card) => ({
        ...CARD_ITEM_DEFAULTS,
        id: card.id,
        // Item names are unique; variants sharing a name are told apart by id.
        name: card.variant === "FORBIDDEN" ? card.id : card.name,
        rarity: card.rarity,
        itemType: "CARD" as const,
        cardData: kessenCardToCardData(card),
      })),
      ...PACKS.map((id) => ({
        id,
        name: id,
        itemType: "CONSUMABLE" as const,
        stackSize: 99,
        canStack: true,
        effects: buildKessenPackEffects(
          KESSEN_PACKS.find((pack) => pack.id === id) as (typeof KESSEN_PACKS)[number],
          KESSEN_SEED_CATALOG,
        ),
      })),
    ]);
  });

  it("serves the catalog with every card, numbered collectibles and pack odds", async () => {
    const titled = KESSEN_SEED_CATALOG.find((card) => card.kind === "LEADER")?.id ?? "";
    await (await db())
      .update(item)
      .set({ description: "Sunflare: Empower 3 each unit in one of your rows" })
      .where(eq(item.id, titled));
    const unit = KESSEN_SEED_CATALOG.find((card) => card.kind === "UNIT")?.id ?? "";
    await (await db())
      .update(item)
      .set({ description: "Strike: a unit's description is not a title" })
      .where(eq(item.id, unit));
    const catalog = await resolverOf(kessenRouter.getCatalog)({
      ctx: { drizzle: await db(), userId: null },
      input: undefined,
    });
    expect(catalog.cards).toHaveLength(KESSEN_SEED_CATALOG.length);
    expect(catalog.packs.map((pack) => pack.id).sort()).toEqual([...PACKS].sort());
    // The served odds are the stored caches': the First Bundle's fifth card is EPIC+.
    const first = catalog.packs.find((pack) => pack.id === KESSEN_PACK_IDS.first);
    expect(first?.odds.rareSlot).toEqual({ ...KESSEN_LACQUER_RARE_SLOT_WEIGHTS });
    const paper = catalog.packs.find((pack) => pack.id === KESSEN_PACK_IDS.paper);
    expect(paper?.odds).toEqual({
      normal: { ...KESSEN_PACK_SLOT_WEIGHTS },
      rareSlot: { ...KESSEN_PACK_RARE_SLOT_WEIGHTS },
    });
    const numbers = catalog.cards.flatMap((card) => (card.number ? [card.number] : []));
    expect(new Set(numbers).size).toBe(numbers.length);
    // Leader titles come from "<title>: <text>" descriptions; other cards have none.
    expect(
      catalog.cards.filter((card) => card.abilityName !== null).map((card) => card.id),
    ).toEqual([titled]);
    expect(catalog.cards.find((card) => card.id === titled)?.abilityName).toBe(
      "Sunflare",
    );
  });

  it("reads the hub without creating progress rows", async () => {
    const hub = await (await api()).getHub();
    expect(hub).toMatchObject({
      needsLesson: true,
      needsStarter: false,
      activeMatch: null,
      pendingPicks: [],
      today: {
        rewarded: 0,
        rewardedCap: KESSEN_DAILY_REWARDED_MATCHES,
      },
      week: { firstWinPack: true },
    });
    expect(hub.circuit.find((npc) => npc.key === "lemu")?.lockReason).toBe(
      "Finish Lemu's first Academy lesson first.",
    );
    expect(await progress()).toBeUndefined();
  });

  it("rejects locked opponents and modes", async () => {
    const caller = await api();
    const loaner = { source: "loaner", faction: "AKASUMI" } as const;
    expect(
      await caller.startMatch({ npcKey: "lemu", mode: "standard", deck: loaner }),
    ).toEqual({ success: false, message: "Finish Lemu's first Academy lesson first." });
    await setProgress({ academy: FIRST_LESSON_DONE });
    expect(
      await caller.startMatch({ npcKey: "kazehiko", mode: "standard", deck: loaner }),
    ).toEqual({ success: false, message: "Beat Lemu." });
    expect(
      await caller.startMatch({ npcKey: "hisame", mode: "ascended", deck: loaner }),
    ).toEqual({ success: false, message: "Beat all six village champions." });
    expect((await (await db()).select().from(kessenMatch)).length).toBe(0);
  });

  it("allows one active match and replaces it only on request", async () => {
    const caller = await api();
    const lesson = { lessonKey: "first-blood" } as const;
    const first = await caller.startLesson(lesson);
    expect(first).toMatchObject({ success: true });
    const firstId = "match" in first ? first.match?.id : undefined;
    expect(await caller.startLesson(lesson)).toEqual({
      success: false,
      message: "Finish or concede your current Kessen match first.",
      activeMatchId: firstId,
    });
    await setProgress({ academy: FIRST_LESSON_DONE });
    expect(
      await caller.startMatch({
        npcKey: "lemu",
        mode: "standard",
        deck: { source: "loaner", faction: "AKASUMI" },
      }),
    ).toMatchObject({ success: false, activeMatchId: firstId });
    const second = await caller.startLesson({ ...lesson, replaceActive: true });
    expect(second).toMatchObject({ success: true });
    expect((await matchRow(firstId as string))?.status).toBe("CONCEDED");
    expect((await caller.getHub()).activeMatch?.id).toBe(
      "match" in second ? second.match?.id : undefined,
    );
  });

  it("keeps one active match when a second start lands before the first one's insert", async () => {
    await setProgress({ academy: FIRST_LESSON_DONE });
    const input = {
      npcKey: "lemu",
      mode: "standard",
      deck: { source: "loaner", faction: "AKASUMI" },
    } as const;
    const race: {
      second?: Awaited<ReturnType<Awaited<ReturnType<typeof api>>["startMatch"]>>;
    } = {};
    const racing = aroundStatements(
      await db(),
      kessenMatch,
      async (run) => {
        // The second start reads, inserts and re-checks before this insert runs.
        race.second ??= await (await api()).startMatch(input);
        return run();
      },
      { operations: ["insert"] },
    );
    const first = await callerForDatabase(kessenRouter, PLAYER, racing).startMatch(
      input,
    );
    const raced = race.second;
    expect(raced).toMatchObject({ success: true });
    expect(first).toEqual({
      success: false,
      message: "Another match is starting; try again in a moment.",
    });
    const active = await (await db())
      .select()
      .from(kessenMatch)
      .where(eq(kessenMatch.status, "ACTIVE"));
    expect(active.map((row) => row.id)).toEqual([
      raced && "match" in raced ? (raced.match?.id as string) : "",
    ]);
  });

  it("rejects saved decks the player does not own or that no longer exist", async () => {
    await setProgress({ academy: FIRST_LESSON_DONE });
    const starter = starterDeck("AKASUMI");
    await (await db()).insert(kessenDeck).values({
      id: "deck-1",
      userId: PLAYER,
      name: "Unowned",
      leaderItemId: starter.leaderId,
      cards: starter.cards,
    });
    const caller = await api();
    const saved = await caller.startMatch({
      npcKey: "lemu",
      mode: "standard",
      deck: { source: "saved", deckId: "deck-1" },
    });
    expect(saved.success).toBe(false);
    expect(
      await caller.startMatch({
        npcKey: "lemu",
        mode: "standard",
        deck: { source: "saved", deckId: "missing" },
      }),
    ).toEqual({ success: false, message: "That deck no longer exists." });
  });

  it("starts a short saved deck with its owned cards and borrowed copies for the rest", async () => {
    await setProgress({ academy: FIRST_LESSON_DONE });
    const starter = starterDeck("AKASUMI");
    const kept = starter.cards.slice(0, 4);
    await insertUserItems(
      [...kept, { itemId: starter.leaderId, count: 1 }].map((entry, index) => ({
        id: `short-${index}`,
        userId: PLAYER,
        itemId: entry.itemId,
        quantity: entry.count,
      })),
    );
    const saved = await (await callerFor(kessenCollectionRouter, PLAYER)).saveDeck({
      name: "Short",
      leaderItemId: starter.leaderId,
      cards: kept,
    });
    expect(saved).toMatchObject({ success: true, needsFill: true });
    if (!saved.success) throw new Error(saved.message);
    const caller = await api();
    // The saved source needs every copy owned; fill lends the missing ones.
    expect(
      await caller.startMatch({
        npcKey: "lemu",
        mode: "standard",
        deck: { source: "saved", deckId: saved.deck.id },
      }),
    ).toMatchObject({ success: false });
    const started = await caller.startMatch({
      npcKey: "lemu",
      mode: "standard",
      deck: { source: "fill", deckId: saved.deck.id },
    });
    expect(started).toMatchObject({ success: true });
    const match = "match" in started ? started.match : undefined;
    const row = await matchRow(match?.id ?? "");
    if (!row) throw new Error("The started match was not stored");
    const engine = (row.state as unknown as KessenStoredMatch).engine;
    const deck = Object.entries(engine.inst)
      .filter(([id]) => id.startsWith("s0-"))
      .map(([, cardId]) => cardId);
    expect(deck.length).toBeGreaterThanOrEqual(KESSEN_DECK_RULES.minCards);
    for (const entry of kept)
      expect(
        deck.filter((cardId) => cardId === entry.itemId).length,
      ).toBeGreaterThanOrEqual(entry.count);
    expect(match?.borrowed.length).toBeGreaterThan(0);
    expect(match?.borrowed.every((cardId) => deck.includes(cardId))).toBe(true);
  });

  it("starts a loaner match with the lent cards listed", async () => {
    await setProgress({ academy: FIRST_LESSON_DONE });
    const started = await (await api()).startMatch({
      npcKey: "lemu",
      mode: "standard",
      deck: { source: "loaner", faction: "HYORIN" },
    });
    expect(started).toMatchObject({ success: true });
    const match = "match" in started ? started.match : undefined;
    expect(match?.borrowed.length).toBeGreaterThan(0);
    expect(match?.view.seats[1].hand).toBeNull();
    expect(match?.view.seats[0].hand).toHaveLength(10);
    const row = await matchRow(match?.id as string);
    expect(row?.engineVersion).toBe(CARD_ENGINE_VERSION);
  });

  it("returns the whole play log, redacted for the player, with the match", async () => {
    await setProgress({ academy: FIRST_LESSON_DONE });
    const caller = await api();
    const started = await caller.startMatch({
      npcKey: "lemu",
      mode: "standard",
      deck: { source: "loaner", faction: "AKASUMI" },
    });
    if (!started.success || !("match" in started) || !started.match)
      throw new Error(started.message);
    const matchId = started.match.id;
    expect(started.log?.version).toBe(started.match.version);
    const sent = [...(started.log?.events ?? [])];
    for (let turn = 0; turn < 6; turn++) {
      const { match } = await caller.getMatch({ matchId });
      if (match?.status !== "ACTIVE") break;
      const response = await caller.playTurn({
        matchId,
        version: match.version,
        action: humanAction(match),
      });
      expect(response.success, response.message).toBe(true);
      sent.push(...response.events);
    }
    const { match, log } = await caller.getMatch({ matchId });
    expect(log?.version).toBe(match?.version);
    expect(log?.events).toEqual(sent);
    expect(sent.some((event) => event.t === "mulligan" && event.seat === 0)).toBe(true);
    // The opponent's draws and replaced cards stay hidden; only ids the events name are listed.
    for (const event of log?.events ?? []) {
      if (event.t === "drawn" && event.seat === 1)
        expect(event.cards.every((id) => id === "?")).toBe(true);
      if (event.t === "mulligan" && event.seat === 1)
        expect([...event.removed, ...event.drawn].every((id) => id === "?")).toBe(true);
    }
    const stored = (await matchRow(matchId))?.state as unknown as KessenStoredMatch;
    const named = JSON.stringify(log?.events ?? []);
    for (const [id, cardId] of Object.entries(log?.inst ?? {})) {
      expect(named).toContain(`"${id}"`);
      expect(stored.engine.inst[id]).toBe(cardId);
    }
  });

  it("opens Academy lessons in order and pays each first completion once", async () => {
    const caller = await api();
    expect(await caller.startLesson({ lessonKey: "enough" })).toEqual({
      success: false,
      message: 'Finish "First Blood" first.',
    });
    const hubBefore = await caller.getHub();
    expect(hubBefore.academy).toMatchObject({
      completed: 0,
      total: 6,
      next: "first-blood",
    });
    expect(hubBefore.needsLesson).toBe(true);

    let expected = START_MONEY;
    for (const key of KESSEN_ACADEMY_LESSON_KEYS) {
      const finished = await playLesson(key);
      expected += KESSEN_ACADEMY_LESSON_RYO;
      const last = key === KESSEN_ACADEMY_LESSON_KEYS.at(-1);
      expect(finished?.status).toBe("FINISHED");
      expect(finished?.lesson).toBe(key);
      expect(finished?.result).toMatchObject({
        winner: 0,
        rewarded: false,
        ryo: KESSEN_ACADEMY_LESSON_RYO,
        lessonCompleted: true,
        academy: {
          lesson: key,
          ryo: KESSEN_ACADEMY_LESSON_RYO,
          graduationPackId: last ? KESSEN_ACADEMY_GRADUATION_PACK_ID : null,
        },
        firstWin:
          key === "first-blood"
            ? { itemIds: [], choice: { kind: "starterFaction" } }
            : null,
      });
      expect(await money()).toBe(expected);
      expect((await progress())?.academy?.[key]).toBe(finished?.id);
    }
    expect(await owned(KESSEN_ACADEMY_GRADUATION_PACK_ID)).toBe(1);
    expect((await progress())?.academyGraduatedMatchId).toBeTruthy();
    const hub = await caller.getHub();
    expect(hub).toMatchObject({
      needsLesson: false,
      needsStarter: true,
      progress: { lessonCompleted: true },
      academy: { completed: 6, next: null, graduated: true },
    });

    // Replays teach again but pay nothing.
    const replay = await playLesson("enough");
    expect(replay?.result).toMatchObject({
      winner: 0,
      ryo: 0,
      lessonCompleted: false,
      academy: { lesson: "enough", ryo: 0, graduationPackId: null },
    });
    const lastReplay = await playLesson("leaders-moment");
    expect(lastReplay?.result?.academy?.graduationPackId).toBeNull();
    expect(await money()).toBe(expected);
    expect(await owned(KESSEN_ACADEMY_GRADUATION_PACK_ID)).toBe(1);
  });

  it("pays a lesson once when its finishing turn is sent twice", async () => {
    const caller = await api();
    const started = await caller.startLesson({ lessonKey: "first-blood" });
    if (!started.success) throw new Error(started.message);
    const match = await playTaughtLine(started.match.id, { doubleSubmit: true });
    expect(match?.result).toMatchObject({ lessonCompleted: true });
    expect(await money()).toBe(START_MONEY + KESSEN_ACADEMY_LESSON_RYO);
  });

  it("explains a lost lesson without paying it", async () => {
    const caller = await api();
    const started = await caller.startLesson({ lessonKey: "first-blood" });
    if (!started.success) throw new Error(started.message);
    const matchId = started.match.id;
    for (let turn = 0; turn < 40; turn++) {
      const { match } = await caller.getMatch({ matchId });
      if (match?.status !== "ACTIVE") break;
      const response = await caller.playTurn({
        matchId,
        version: match.version,
        action: { t: "pass" },
      });
      expect(response.success, response.message).toBe(true);
    }
    const { match } = await caller.getMatch({ matchId });
    expect(match?.result).toMatchObject({ winner: 1, ryo: 0, lessonCompleted: false });
    expect((await progress())?.academy).toEqual({});
    expect(await money()).toBe(START_MONEY);
  });

  it("pays a finished match once, with the first win and weekly pack", async () => {
    await setProgress({ academy: FIRST_LESSON_DONE });
    const { match, before, attempts } = await winAgainstLemu();
    const result = match?.result;
    expect(result).toMatchObject({
      winner: 0,
      rewarded: true,
      reason: null,
      weeklyFirstWinPack: true,
      firstWin: { itemIds: ["kessen-lemu-academy-instructor", KESSEN_PACK_IDS.paper] },
    });
    const dropRyo = soldRyo(result);
    expect(result?.ryo).toBe(KESSEN_MATCH_WIN_RYO.GENIN + dropRyo);
    expect(await money()).toBe((before ?? 0) + (result?.ryo ?? 0));
    // First-win Paper Bundle plus the weekly first-win Paper Bundle.
    expect(await owned(KESSEN_PACK_IDS.paper)).toBe(2);
    expect(await owned("kessen-lemu-academy-instructor")).toBeGreaterThanOrEqual(1);
    const record = await progress();
    expect(record).toMatchObject({
      dayKey: getUtcDayKey(),
      // Lost attempts before the win were rewarded matches too.
      rewardedToday: attempts,
      npcWinsToday: { lemu: 1 },
      weekKey: thisWeek(),
      weeklyWins: 1,
    });
    expect(record?.seenKeywords.length).toBeGreaterThan(0);
    const [npc] = await (await db()).select().from(kessenNpcProgress);
    expect(npc).toMatchObject({ npcKey: "lemu", wins: 1 });
    expect(npc?.firstWinAt).not.toBeNull();
    expect((await matchRow(match?.id as string))?.rewarded).toBe(true);

    // Replaying the finishing request cannot pay again.
    const paid = await money();
    const replay = await (await api()).playTurn({
      matchId: match?.id as string,
      version: (match?.version ?? 1) - 1,
      action: { t: "pass" },
    });
    expect(replay.success).toBe(false);
    expect(await money()).toBe(paid);
    const hub = await (await api()).getHub();
    expect(hub.circuit.find((npc) => npc.key === "kazehiko")?.lockReason).toBeNull();
    expect(hub.today).toMatchObject({ rewarded: attempts });
    expect(hub.week).toEqual({ firstWinPack: false });
  });

  it("grants the weekly pack on the first rewarded win of a new week", async () => {
    // Last week's wins do not count against this week's pack.
    await setProgress({
      academy: FIRST_LESSON_DONE,
      weekKey: getUtcDayKey(new Date(periodStart("weekly", new Date()).getTime() - 1)),
      weeklyWins: 9,
    });
    expect((await (await api()).getHub()).week).toEqual({ firstWinPack: true });
    const { match } = await winAgainstLemu();
    expect(match?.result).toMatchObject({ rewarded: true, weeklyFirstWinPack: true });
    expect(await progress()).toMatchObject({ weekKey: thisWeek(), weeklyWins: 1 });
  });

  it("pays the weekly pack once when another win claims the week first", async () => {
    await setProgress({ academy: FIRST_LESSON_DONE });
    const database = await db();
    let raced = false;
    // Another match's rewarded win lands between this match's plan and its claim.
    const racing = aroundStatements(
      database,
      kessenProgress,
      async (run) => {
        const [planned] = (
          await database
            .select({ state: kessenMatch.state })
            .from(kessenMatch)
            .where(eq(kessenMatch.status, "FINISHED"))
        ).filter(
          (row) =>
            (row.state as unknown as KessenStoredMatch).settlement?.result
              .weeklyFirstWinPack === true,
        );
        if (planned && !raced) {
          raced = true;
          await database
            .update(kessenProgress)
            .set({ weekKey: thisWeek(), weeklyWins: 1 })
            .where(eq(kessenProgress.userId, PLAYER));
        }
        return run();
      },
      { operations: ["execute"] },
    );
    const { match } = await winAgainstLemu({
      caller: callerForDatabase(kessenRouter, PLAYER, racing),
    });
    expect(raced).toBe(true);
    expect(match?.result).toMatchObject({ rewarded: false, weeklyFirstWinPack: false });
    // Only Lemu's first-win Paper Bundle arrives.
    expect(await owned(KESSEN_PACK_IDS.paper)).toBe(1);
    expect((await progress())?.weeklyWins).toBe(1);
  });

  it("stores no first-win reward until the settled payout has claimed it", async () => {
    await setProgress({ academy: FIRST_LESSON_DONE });
    const pending: KessenStoredMatch["result"][] = [];
    const watched = aroundStatements(
      await db(),
      kessenMatch,
      async (run) => {
        const done = await run();
        const finished = await (await db())
          .select()
          .from(kessenMatch)
          .where(eq(kessenMatch.status, "FINISHED"));
        const latest = finished.sort((a, b) => b.version - a.version)[0];
        const stored = latest?.state as unknown as KessenStoredMatch | undefined;
        pending.push(stored?.result ?? null);
        return done;
      },
      { when: (set) => set.status === "FINISHED" },
    );
    const { match } = await winAgainstLemu({
      caller: callerForDatabase(kessenRouter, PLAYER, watched),
    });
    expect(pending.length).toBeGreaterThan(0);
    // A first-win choice cannot be claimed in the window before the claims ran.
    expect(pending.every((result) => result?.firstWin === null)).toBe(true);
    expect(match?.result?.firstWin?.itemIds.length).toBeGreaterThan(0);
    const stored = (await matchRow(match?.id as string))?.state as unknown as
      | KessenStoredMatch
      | undefined;
    expect(stored?.result?.firstWin).toEqual(match?.result?.firstWin ?? null);
  });

  it("finishes a payout whose finishing request ended after its claims", async () => {
    await setProgress({ academy: FIRST_LESSON_DONE });
    // The settled result write is the one match update that sets `rewarded` without a
    // status; failing it leaves the claims landed and nothing paid.
    const interrupted = aroundStatements(
      await db(),
      kessenMatch,
      async () => {
        throw new Error("The request ended.");
      },
      { when: (set) => set.status === undefined && set.rewarded !== undefined },
    );
    const broken = callerForDatabase(kessenRouter, PLAYER, interrupted);
    const caller = await api();
    let won: string | null = null;
    for (const seed of SEEDS) {
      const started = await caller.startMatch({
        npcKey: "lemu",
        mode: "standard",
        deck: { source: "loaner", faction: "AKASUMI" },
        replaceActive: true,
      });
      const id = "match" in started ? (started.match?.id as string) : "";
      await reseed(id, seed);
      await backdate(id);
      for (let turn = 0; turn < 200; turn++) {
        const { match } = await caller.getMatch({ matchId: id });
        if (match?.status !== "ACTIVE") break;
        const request = {
          matchId: id,
          version: match.version,
          action: humanAction(match),
        };
        const response = await broken.playTurn(request).catch(() => null);
        if (!response) break;
      }
      const row = await matchRow(id);
      const stored = row?.state as unknown as KessenStoredMatch;
      if (stored.engine.result?.winner === 0) {
        won = id;
        break;
      }
      // A lost attempt settles on its next read, like any interrupted match.
      await caller.getMatch({ matchId: id });
    }
    if (!won) throw new Error("No seed produced a win");

    const before = await money();
    const pending = await matchRow(won);
    const pendingState = pending?.state as unknown as KessenStoredMatch;
    expect(pending).toMatchObject({ status: "FINISHED", rewarded: false });
    expect(pendingState.settlement).toBeTruthy();
    // The stored result claims nothing while it is unsettled.
    expect(pendingState.result).toMatchObject({
      rewarded: false,
      ryo: 0,
      drops: [],
      firstWin: null,
    });
    expect(await owned("kessen-lemu-academy-instructor")).toBe(0);
    const claimed = await progress();
    expect(claimed?.rewardedMatchId).toBe(won);
    const rewardedBefore = claimed?.rewardedToday;

    const { match } = await caller.getMatch({ matchId: won });
    expect(match?.result).toMatchObject({
      winner: 0,
      rewarded: true,
      firstWin: { itemIds: ["kessen-lemu-academy-instructor", KESSEN_PACK_IDS.paper] },
    });
    expect(await money()).toBe((before ?? 0) + (match?.result?.ryo ?? 0));
    expect(await owned("kessen-lemu-academy-instructor")).toBeGreaterThanOrEqual(1);
    const settled = await matchRow(won);
    expect(settled?.rewarded).toBe(true);
    const settledState = settled?.state as unknown as KessenStoredMatch | undefined;
    expect(settledState?.settlement).toBeNull();
    // The claims are counted once, however often the settlement ran.
    expect((await progress())?.rewardedToday).toBe(rewardedBefore);
    const [npc] = await (await db()).select().from(kessenNpcProgress);
    expect(npc).toMatchObject({ npcKey: "lemu", wins: 1 });
    expect(npc?.firstWinAt?.getTime()).toBe(settled?.finishedAt?.getTime());

    // Reading it again pays nothing more.
    const paid = await money();
    await caller.getMatch({ matchId: won });
    expect(await money()).toBe(paid);
  });

  it("never pays twice when every turn is submitted twice at once", async () => {
    await setProgress({ academy: FIRST_LESSON_DONE });
    const caller = await api();
    const started = await caller.startMatch({
      npcKey: "lemu",
      mode: "standard",
      deck: { source: "loaner", faction: "AKASUMI" },
    });
    const id = "match" in started ? (started.match?.id as string) : "";
    await reseed(id, SEEDS[0] as string);
    await backdate(id);
    const { match } = await playOut(id, { doubleSubmit: true });
    expect(match?.status).toBe("FINISHED");
    expect(await money()).toBe(START_MONEY + (match?.result?.ryo ?? 0));
    expect((await progress())?.rewardedToday).toBe(1);
  });

  it("returns the fresh match for a stale version", async () => {
    await setProgress({ academy: FIRST_LESSON_DONE });
    const caller = await api();
    const started = await caller.startMatch({
      npcKey: "lemu",
      mode: "standard",
      deck: { source: "loaner", faction: "AKASUMI" },
    });
    const match = "match" in started ? (started.match as KessenMatchPayload) : null;
    const first = await caller.playTurn({
      matchId: match?.id as string,
      version: match?.version as number,
      action: humanAction(match as KessenMatchPayload),
    });
    expect(first.success).toBe(true);
    const stale = await caller.playTurn({
      matchId: match?.id as string,
      version: match?.version as number,
      action: { t: "pass" },
    });
    expect(stale).toMatchObject({
      success: false,
      message: "This match moved on in another window; showing the latest turn.",
      match: { version: (match?.version ?? 0) + 1 },
    });
  });

  it("does not reward short matches or concessions", async () => {
    await setProgress({ academy: FIRST_LESSON_DONE });
    const caller = await api();
    const started = await caller.startMatch({
      npcKey: "lemu",
      mode: "standard",
      deck: { source: "loaner", faction: "AKASUMI" },
    });
    const id = "match" in started ? (started.match?.id as string) : "";
    await reseed(id, SEEDS[0] as string);
    const { match } = await playOut(id);
    expect(match?.result).toMatchObject({
      rewarded: false,
      ryo: 0,
      reason: "The match was too short to be rewarded.",
    });
    expect(await money()).toBe(START_MONEY);

    const next = await caller.startMatch({
      npcKey: "lemu",
      mode: "standard",
      deck: { source: "loaner", faction: "AKASUMI" },
    });
    const nextMatch = "match" in next ? (next.match as KessenMatchPayload) : null;
    await backdate(nextMatch?.id as string);
    const conceded = await caller.concede({
      matchId: nextMatch?.id as string,
      version: nextMatch?.version as number,
    });
    expect(conceded).toMatchObject({
      success: true,
      match: { status: "CONCEDED", result: { rewarded: false, ryo: 0 } },
    });
    expect(await money()).toBe(START_MONEY);
    expect((await progress())?.rewardedToday).toBe(0);
  });

  it("turns matches past the daily cap into practice", async () => {
    await setProgress({
      academy: FIRST_LESSON_DONE,
      dayKey: getUtcDayKey(),
      rewardedToday: KESSEN_DAILY_REWARDED_MATCHES,
    });
    const { match, before } = await winAgainstLemu();
    expect(match?.result).toMatchObject({
      rewarded: false,
      ryo: 0,
      reason: "Daily reward limit reached; this match was practice.",
      weeklyFirstWinPack: false,
    });
    // The first win is uncapped.
    expect(match?.result?.firstWin?.itemIds).toContain(
      "kessen-lemu-academy-instructor",
    );
    expect(await money()).toBe(before);
  });

  it("halves ryo after four wins against the same NPC today", async () => {
    await setProgress({
      academy: FIRST_LESSON_DONE,
      dayKey: getUtcDayKey(),
      rewardedToday: 4,
      npcWinsToday: { lemu: 4 },
      weekKey: thisWeek(),
      weeklyWins: 4,
    });
    const { match, before } = await winAgainstLemu();
    const dropRyo = soldRyo(match?.result);
    expect(match?.result).toMatchObject({ rewarded: true, weeklyFirstWinPack: false });
    expect(match?.result?.ryo).toBe(
      Math.floor(KESSEN_MATCH_WIN_RYO.GENIN / 2) + dropRyo,
    );
    expect(await money()).toBe((before ?? 0) + (match?.result?.ryo ?? 0));
    expect((await progress())?.npcWinsToday).toEqual({ lemu: 5 });
    expect(KESSEN_MATCH_LOSS_RYO.GENIN).toBeGreaterThan(0);
  });

  it("advances win_card_duel objectives filtered by NPC and tier", async () => {
    await setProgress({ academy: FIRST_LESSON_DONE });
    const objective = (id: string, extra: Record<string, unknown>) => ({
      id,
      task: "win_card_duel",
      value: 1,
      description: "",
      successDescription: "",
      ...extra,
    });
    await insertQuests([
      {
        id: "duel-quest",
        consecutiveObjectives: false,
        content: QuestValidatorRawSchema.shape.content.parse({
          objectives: [
            objective("any", {}),
            objective("lemu", { npcKey: "lemu", tier: "GENIN" }),
            objective("other", { npcKey: "kazehiko" }),
            objective("kage", { tier: "KAGE" }),
          ],
          reward: {},
          sceneBackground: "",
          sceneCharacters: [],
        }),
      },
    ]);
    await insertQuestHistory([
      { id: "duel-history", userId: PLAYER, questId: "duel-quest", completed: 0 },
    ]);
    await winAgainstLemu();
    const [user] = await (await db())
      .select()
      .from(userData)
      .where(eq(userData.userId, PLAYER));
    const goals = user?.questData?.find(
      (tracker) => tracker.id === "duel-quest",
    )?.goals;
    const goalValue = (id: string) => goals?.find((goal) => goal.id === id)?.value ?? 0;
    expect(goalValue("any")).toBe(1);
    expect(goalValue("lemu")).toBe(1);
    expect(goalValue("other")).toBe(0);
    expect(goalValue("kage")).toBe(0);
  });

  it("expires a match whose rules version is retired", async () => {
    await setProgress({ academy: FIRST_LESSON_DONE });
    const caller = await api();
    const started = await caller.startMatch({
      npcKey: "lemu",
      mode: "standard",
      deck: { source: "loaner", faction: "AKASUMI" },
    });
    const match = "match" in started ? (started.match as KessenMatchPayload) : null;
    await (await db())
      .update(kessenMatch)
      .set({ engineVersion: CARD_ENGINE_VERSION - 1 })
      .where(eq(kessenMatch.id, match?.id as string));
    const response = await caller.playTurn({
      matchId: match?.id as string,
      version: match?.version as number,
      action: { t: "pass" },
    });
    expect(response).toMatchObject({ success: false, match: { status: "EXPIRED" } });
    expect((await matchRow(match?.id as string))?.status).toBe("EXPIRED");
    expect(await money()).toBe(START_MONEY);
  });

  it("does not count a match on retired rules as the active match", async () => {
    await setProgress({ academy: FIRST_LESSON_DONE });
    const caller = await api();
    const loaner = { source: "loaner", faction: "AKASUMI" } as const;
    const started = await caller.startMatch({
      npcKey: "lemu",
      mode: "standard",
      deck: loaner,
    });
    const retired = "match" in started ? (started.match?.id as string) : "";
    await (await db())
      .update(kessenMatch)
      .set({ engineVersion: CARD_ENGINE_VERSION - 1 })
      .where(eq(kessenMatch.id, retired));
    expect((await caller.getHub()).activeMatch).toBeNull();
    const next = await caller.startMatch({
      npcKey: "lemu",
      mode: "standard",
      deck: loaner,
    });
    expect(next.success).toBe(true);
    expect((await caller.getMatch({ matchId: retired })).match?.status).toBe("EXPIRED");
  });

  it("expires idle matches from the authenticated cron only", async () => {
    await setProgress({ academy: FIRST_LESSON_DONE });
    const caller = await api();
    const loaner = { source: "loaner", faction: "AKASUMI" } as const;
    const idle = await caller.startMatch({
      npcKey: "lemu",
      mode: "standard",
      deck: loaner,
    });
    const idleId = "match" in idle ? (idle.match?.id as string) : "";
    await (await db())
      .update(kessenMatch)
      .set({ updatedAt: new Date(Date.now() - 25 * 3_600_000) })
      .where(eq(kessenMatch.id, idleId));
    const fresh = await caller.startMatch({
      npcKey: "lemu",
      mode: "standard",
      deck: loaner,
      replaceActive: true,
    });
    const freshId = "match" in fresh ? (fresh.match?.id as string) : "";
    // The replaced match is conceded; restore it as an idle ACTIVE match.
    await (await db())
      .update(kessenMatch)
      .set({ status: "ACTIVE", updatedAt: new Date(Date.now() - 25 * 3_600_000) })
      .where(eq(kessenMatch.id, idleId));

    const unauthorized = await expireMatches(
      new Request("https://example.com/api/kessen-match-expiry"),
    );
    expect(unauthorized.status).toBe(401);
    expect((await matchRow(idleId))?.status).toBe("ACTIVE");

    const response = await expireMatches(
      new Request("https://example.com/api/kessen-match-expiry", {
        headers: { authorization: "Bearer kessen-cron" },
      }),
    );
    expect(response.status).toBe(200);
    expect((await matchRow(idleId))?.status).toBe("EXPIRED");
    expect((await matchRow(freshId))?.status).toBe("ACTIVE");
  });

  it("lets the player pick an Ascended first-win epic once", async () => {
    await setProgress({ academy: FIRST_LESSON_DONE });
    const caller = await api();
    const started = await caller.startMatch({
      npcKey: "lemu",
      mode: "standard",
      deck: { source: "loaner", faction: "AKASUMI" },
    });
    const id = "match" in started ? (started.match?.id as string) : "";
    const row = await matchRow(id);
    const stored = row?.state as unknown as KessenStoredMatch;
    const options = ["kessen-aetherion", "kessen-stormrender"];
    await (await db())
      .update(kessenMatch)
      .set({
        status: "FINISHED",
        state: {
          ...stored,
          result: {
            winner: 0,
            rewarded: true,
            reason: null,
            ryo: 0,
            drops: [],
            firstWin: {
              itemIds: [],
              choice: { kind: "items", options, claimed: null },
            },
            weeklyFirstWinPack: false,
            lessonCompleted: false,
            academy: null,
          },
        } as never,
      })
      .where(eq(kessenMatch.id, id));
    expect(
      await caller.claimFirstWinChoice({ matchId: id, itemId: "kessen-colossus" }),
    ).toEqual({ success: false, message: "That card is not one of the choices." });
    const [a, b] = await Promise.all([
      caller.claimFirstWinChoice({ matchId: id, itemId: "kessen-aetherion" }),
      caller.claimFirstWinChoice({ matchId: id, itemId: "kessen-stormrender" }),
    ]);
    expect([a.success, b.success].filter(Boolean)).toHaveLength(1);
    expect(
      (await owned("kessen-aetherion")) + (await owned("kessen-stormrender")),
    ).toBe(1);
  });

  it("names where the active match stands", async () => {
    await setProgress({ academy: FIRST_LESSON_DONE });
    const caller = await api();
    const started = await caller.startMatch({
      npcKey: "lemu",
      mode: "standard",
      deck: { source: "loaner", faction: "AKASUMI" },
    });
    const id = "match" in started ? (started.match?.id as string) : "";
    expect((await caller.getHub()).activeMatch).toEqual({
      id,
      npcKey: "lemu",
      mode: "standard",
      lesson: null,
      challenge: null,
      round: 1,
      roundWins: [0, 0],
      yourTurn: true,
    });
    const stored = (await matchRow(id))?.state as unknown as KessenStoredMatch;
    const round = { totals: [7, 3] as [number, number], riggedOdds: false };
    const engine = {
      ...stored.engine,
      phase: "play" as const,
      round: 3,
      turn: 1 as const,
      seats: stored.engine.seats.map((seat) => ({ ...seat, mull: null })),
      history: [
        { ...round, round: 1, winner: 0 as const },
        { ...round, round: 2, winner: null },
      ],
    };
    await (await db())
      .update(kessenMatch)
      .set({ state: { ...stored, engine } as never })
      .where(eq(kessenMatch.id, id));
    expect((await caller.getHub()).activeMatch).toMatchObject({
      round: 3,
      roundWins: [1, 0],
      yourTurn: false,
    });
  });

  it("lists first-win picks still open until they are claimed", async () => {
    await setProgress({ academy: FIRST_LESSON_DONE });
    const caller = await api();
    const finish = async (choice: Record<string, unknown>, finishedAt: Date) => {
      const started = await caller.startMatch({
        npcKey: "lemu",
        mode: "standard",
        deck: { source: "loaner", faction: "AKASUMI" },
        replaceActive: true,
      });
      const id = "match" in started ? (started.match?.id as string) : "";
      const stored = (await matchRow(id))?.state as unknown as KessenStoredMatch;
      await (await db())
        .update(kessenMatch)
        .set({
          status: "FINISHED",
          finishedAt,
          state: {
            ...stored,
            result: {
              winner: 0,
              rewarded: true,
              reason: null,
              ryo: 0,
              drops: [],
              firstWin: { itemIds: [], choice },
              weeklyFirstWinPack: false,
              lessonCompleted: false,
              academy: null,
            },
          } as never,
        })
        .where(eq(kessenMatch.id, id));
      return id;
    };
    const firstWinAt = new Date("2026-11-10T12:00:00.123Z");
    const options = ["kessen-aetherion", "kessen-stormrender"];
    // Only the match that granted the NPC's first win counts; the record's first-win
    // time and that match's finish come from one clock reading.
    const pick = await finish({ kind: "items", options, claimed: null }, firstWinAt);
    await finish(
      { kind: "items", options, claimed: null },
      new Date("2026-11-11T12:00:00.000Z"),
    );
    await (await db())
      .insert(kessenNpcProgress)
      .values({ userId: PLAYER, npcKey: "lemu", wins: 2, firstWinAt });
    expect((await caller.getHub()).pendingPicks).toEqual([
      { matchId: pick, npcKey: "lemu" },
    ]);
    const claimed = await caller.claimFirstWinChoice({
      matchId: pick,
      itemId: "kessen-aetherion",
    });
    expect(claimed.success).toBe(true);
    expect((await caller.getHub()).pendingPicks).toEqual([]);
  });

  it("plays turns against a Kage boss", async () => {
    await setProgress({ academy: FIRST_LESSON_DONE });
    const now = new Date();
    await (await db()).insert(kessenNpcProgress).values([
      { userId: PLAYER, npcKey: "anbu-chief", wins: 1, firstWinAt: now },
      { userId: PLAYER, npcKey: "momo", wins: 1, firstWinAt: now },
    ]);
    const caller = await api();
    const started = await caller.startMatch({
      npcKey: "shishi",
      mode: "standard",
      deck: { source: "loaner", faction: "TSUKIMORI" },
    });
    expect(started).toMatchObject({ success: true, match: { tier: "KAGE" } });
    const id = "match" in started ? (started.match?.id as string) : "";
    let turns = 0;
    for (; turns < 6; turns++) {
      const { match } = await caller.getMatch({ matchId: id });
      if (match?.status !== "ACTIVE") break;
      const response = await caller.playTurn({
        matchId: id,
        version: match.version,
        action: humanAction(match),
      });
      expect(response.success).toBe(true);
    }
    expect(turns).toBeGreaterThan(0);
  });

  it("starts a quest challenge only at its position, against the objective's opponent", async () => {
    await assignTableChallenge({ npcKey: "shishi", tier: "JONIN" });
    await moveTo({ sector: 3, longitude: 1, latitude: 1 });
    const caller = await api();
    const start = () =>
      caller.startMatch({
        npcKey: "lemu",
        mode: "ascended",
        deck: { source: "loaner", faction: "AKASUMI" },
        challenge: TABLE_REQUEST,
      });
    const away = await start();
    expect(away.success).toBe(false);
    expect(away.message).toContain("sector 12");
    await moveTo(TABLE_SPOT);
    // The objective names the opponent and tier; no Circuit unlock is needed.
    const started = await start();
    expect(started).toMatchObject({
      success: true,
      match: {
        npcKey: "shishi",
        mode: "standard",
        tier: "JONIN",
        challenge: TABLE_REQUEST,
      },
    });
    // The hall knows the active match is this objective's duel.
    expect((await caller.getHub()).activeMatch?.challenge).toEqual(TABLE_REQUEST);
    // The same opponent outside the quest is still locked.
    const locked = await caller.startMatch({
      npcKey: "shishi",
      mode: "standard",
      deck: { source: "loaner", faction: "AKASUMI" },
      replaceActive: true,
    });
    expect(locked.success).toBe(false);
  });

  it("completes the challenge objective on a win and pays nothing else", async () => {
    await assignTableChallenge({ npcKey: "lemu", tier: "GENIN" });
    await insertQuests([
      {
        id: "duel-quest",
        content: QuestValidatorRawSchema.shape.content.parse({
          objectives: [{ id: "any", task: "win_card_duel", value: 1 }],
          reward: {},
          sceneBackground: "",
          sceneCharacters: [],
        }),
      },
    ]);
    await insertQuestHistory([
      { id: "duel-history", userId: PLAYER, questId: "duel-quest", completed: 0 },
    ]);
    await moveTo(TABLE_SPOT);
    const caller = await api();
    let won: Awaited<ReturnType<typeof playOut>> | null = null;
    for (const seed of SEEDS) {
      const started = await caller.startMatch({
        npcKey: "lemu",
        mode: "standard",
        deck: { source: "loaner", faction: "AKASUMI" },
        challenge: TABLE_REQUEST,
        replaceActive: true,
      });
      if (!started.success || !("match" in started) || !started.match)
        throw new Error(started.message);
      await reseed(started.match.id, seed);
      await backdate(started.match.id);
      const played = await playOut(started.match.id, { caller });
      if (played.match?.result?.winner === 0) {
        won = played;
        break;
      }
      // A lost challenge leaves the objective open for another try.
      expect((await tableGoal())?.done).toBeFalsy();
    }
    if (!won?.match) throw new Error("No seed produced a win");
    const last = won.responses.at(-1);
    expect(last?.message).toBe("You won! Continue the quest in your logbook.");
    const patched = (
      (last && "userPatch" in last ? last.userPatch?.questData : undefined) as
        | QuestTrackerType[]
        | undefined
    )
      ?.find((tracker) => tracker.id === TABLE_REQUEST.questId)
      ?.goals.find((entry) => entry.id === TABLE_REQUEST.objectiveId);
    expect(patched?.done).toBe(true);
    expect((await tableGoal())?.done).toBe(true);
    expect(won.match.result).toMatchObject({
      winner: 0,
      rewarded: false,
      ryo: 0,
      drops: [],
      firstWin: null,
      weeklyFirstWinPack: false,
    });
    expect(await money()).toBe(START_MONEY);
    expect(await owned(KESSEN_PACK_IDS.paper)).toBe(0);
    expect(await (await db()).select().from(kessenNpcProgress)).toEqual([]);
    expect(await progress()).toMatchObject({ rewardedToday: 0, weeklyWins: 0 });
    const [user] = await (await db())
      .select()
      .from(userData)
      .where(eq(userData.userId, PLAYER));
    const duelGoal = user?.questData
      ?.find((tracker) => tracker.id === "duel-quest")
      ?.goals.find((goal) => goal.id === "any");
    expect(duelGoal?.value ?? 0).toBe(0);
    // A completed challenge cannot be started again.
    const again = await caller.startMatch({
      npcKey: "lemu",
      mode: "standard",
      deck: { source: "loaner", faction: "AKASUMI" },
      challenge: TABLE_REQUEST,
    });
    expect(again.success).toBe(false);
  });
});
