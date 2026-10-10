/**
 * Vercel BotID configuration shared by the browser (`instrumentation-client.ts`) and the
 * tRPC server (`@/server/utils/botid`).
 *
 * Protected procedures use the Basic check level, which is free on every plan. Account
 * creation (`BOTID_DEEP_ANALYSIS_PROCEDURES`) uses Deep Analysis, which is billed per
 * `checkBotId()` call ($1 per 1,000 on Pro); at ~5,000 sign-ups a month that is ~$5. The
 * level must be identical on the client protect entry and on the server call, or
 * verification fails, so both sides derive it from here. A per-route `checkLevel` takes
 * precedence over the project setting, so keep Deep Analysis disabled in the Vercel
 * dashboard to avoid paying for it anywhere else.
 */
export type BotIdCheckLevel = "basic" | "deepAnalysis";
export const BOTID_CHECK_LEVEL: BotIdCheckLevel = "basic";

/** Protected procedures that get Deep Analysis instead of Basic: account creation only. */
export const BOTID_DEEP_ANALYSIS_PROCEDURES = ["register.createCharacter"] as const;

const deepAnalysisProcedures: ReadonlySet<string> = new Set(
  BOTID_DEEP_ANALYSIS_PROCEDURES,
);

/**
 * The check level for a request naming `paths`. A batch that includes a Deep Analysis
 * procedure is checked at that level as a whole, matching the client, which attaches the
 * challenge of the first protect entry that matches (Deep Analysis entries come first).
 */
export const botIdCheckLevelForPaths = (paths: readonly string[]): BotIdCheckLevel =>
  paths.some((path) => deepAnalysisProcedures.has(path))
    ? "deepAnalysis"
    : BOTID_CHECK_LEVEL;

/**
 * The only tRPC mutations BotID guards. Each check is a ~150-350 ms round trip to
 * api.vercel.com that the mutation waits for, so the list is limited to high-value
 * targets that a player triggers rarely: grind-loop starts, reward claims, value
 * transfers, account creation and the merch cart. Frequent actions (combat moves,
 * movement, equipping, chat) are deliberately left out.
 */
export const BOTID_PROTECTED_PROCEDURES = [
  // Training and grind loops
  "train.startTraining",
  "train.updateEnergyTrainingQueue",
  "train.startMasteryTraining",
  "train.startElementalTraining",
  "train.updateMasteryTrainingQueue",
  "jutsu.startTraining",
  "stealth.trainCovert",
  "quests.startQuest",
  "quests.startRandom",
  "combat.startArenaBattle",
  "farming.harvestPlot",
  "farming.harvestAll",
  // Daily and once-per-period rewards
  "profile.claimVotes",
  "activityStreak.claimStreakDay",
  "bank.claimInterest",
  "raids.claimDamageReward",
  "pvpRank.claimSeasonRewards",
  // Account creation and value transfer
  "register.createCharacter",
  "bank.transfer",
  "blackmarket.createOffer",
  "blackmarket.takeOffer",
  "auction.createAuctionListing",
  "auction.placeBid",
  // Merch cart
  "merch.addToCart",
  "merch.updateCart",
  "merch.checkout",
] as const;

const protectedProcedures: ReadonlySet<string> = new Set(BOTID_PROTECTED_PROCEDURES);

/** Whether a tRPC procedure path is one BotID guards. */
export const isBotIdProtectedProcedure = (path: string) =>
  protectedProcedures.has(path);

/**
 * Request header the BotID client sets on every request it protects. A protected
 * mutation without it comes from a page that never attached a challenge: a tab still
 * running a bundle from before the procedure was protected, or a script.
 */
export const BOTID_CHALLENGE_HEADER = "x-is-human";

/**
 * Requests the BotID client attaches its challenge headers to: one entry per protected
 * procedure.
 *
 * httpBatchLink sends every mutation as a POST to `/api/trpc/<path>[,<path>...]?batch=1`
 * and every query as a GET (no `methodOverride` is configured). BotID matches the
 * pathname only, escapes the dots, and turns `*` into `.*`, so `/api/trpc/*<procedure>*`
 * also matches a batch that carries the procedure alongside others (with `,` or `%2C`
 * between them). No procedure name contains another one, so nothing else matches.
 */
export const BOTID_PROTECTED_ROUTES = [...BOTID_PROTECTED_PROCEDURES]
  // botid uses the first matching entry, so Deep Analysis entries must come first.
  .sort(
    (a, b) =>
      Number(deepAnalysisProcedures.has(b)) - Number(deepAnalysisProcedures.has(a)),
  )
  .map((procedure) => ({
    path: `/api/trpc/*${procedure}*`,
    method: "POST",
    advancedOptions: { checkLevel: botIdCheckLevelForPaths([procedure]) },
  }));

/**
 * Shown when a protected mutation arrives without a BotID challenge. A browser running
 * the current bundle always attaches one, so the page is out of date and a reload fixes it.
 */
export const BOTID_RELOAD_REQUIRED_MESSAGE =
  "This page is running an outdated version of the game. Please reload the page and try again.";

/** Shown to a player whose mutation BotID classified as automated. */
export const BOTID_BLOCKED_MESSAGE =
  "Your request was blocked by our bot protection. Please reload the page and try again; contact support if this keeps happening.";
