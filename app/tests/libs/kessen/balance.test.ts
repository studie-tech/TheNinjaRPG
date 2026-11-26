import { describe, expect, it } from "bun:test";
import { KESSEN_BALANCE, kessenReferenceDecks } from "@/libs/kessen/balance";
import {
  gauntletJobs,
  type KessenSimOutcome,
  playSimGame,
  summarizeGauntlet,
} from "@/libs/kessen/balanceSim";
import { KESSEN_DECK_FACTIONS } from "@/libs/kessen/deck";
import { KESSEN_SEED_CATALOG } from "./fixtures/catalog";

/**
 * Balance smoke run: the gauntlet of the balance page (every cross-faction pair of the
 * starter and champion decks, seats swapped on a shared seed) at a few games per pair.
 * The win-rate band is deliberately coarser than the page's; the match health limits
 * are the page's own.
 */
describe("Kessen balance smoke run", () => {
  const decks = kessenReferenceDecks();
  const jobs = gauntletJobs(decks, GAMES_PER_PAIR, "balance");
  const outcomes = new Map<string, KessenSimOutcome>(
    jobs.map((job) => [job.id, playSimGame(job, KESSEN_SEED_CATALOG)]),
  );
  const summary = summarizeGauntlet(decks, jobs, outcomes);

  it("finishes every match", () => {
    expect([...outcomes.values()].every((game) => game.finished)).toBe(true);
    expect(jobs).toHaveLength(CROSS_FACTION_PAIRS * GAMES_PER_PAIR);
  });

  it("keeps every faction inside a coarse win-rate band", () => {
    const rates = Object.fromEntries(
      summary.factions.map(({ faction, rate }) => {
        const percent = Math.round(100 * rate.score);
        return [faction, percent >= 35 && percent <= 65 ? "in band" : `${percent}%`];
      }),
    );
    expect(rates).toEqual(
      Object.fromEntries(KESSEN_DECK_FACTIONS.map((faction) => [faction, "in band"])),
    );
  });

  it("keeps the match length, ties, the opener, swings and rows inside the health limits", () => {
    const { health } = summary;
    expect(health.flags).toEqual([]);
    expect(health.plays).toBeGreaterThanOrEqual(KESSEN_BALANCE.health.plays[0]);
    expect(health.swingMax).toBeLessThanOrEqual(KESSEN_BALANCE.health.swingMax);
  });
});

const GAMES_PER_PAIR = 6;
/** Twelve decks, two per faction: 66 pairs minus the 6 same-faction ones. */
const CROSS_FACTION_PAIRS = 60;
