"use client";

import { AlertTriangle, Check, ChevronDown, Swords } from "lucide-react";
import { useId, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  KESSEN_CARD_SELL_VALUES,
  KESSEN_COPY_LIMITS,
  KESSEN_DAILY_DROP_ROLLS,
  KESSEN_DAILY_REWARDED_MATCHES,
  KESSEN_EPIC_PITY_PACKS,
  KESSEN_LEGENDARY_PITY_PACKS,
  KESSEN_MATCH_IDLE_EXPIRY_HOURS,
  KESSEN_MATCH_LOSS_RYO,
  KESSEN_MATCH_WIN_RYO,
  KESSEN_MAX_DECKS,
  KESSEN_MIN_MATCH_SECONDS,
  KESSEN_MIN_TOTAL_PLAYS,
  KESSEN_NPC_FULL_PAY_WINS,
  KESSEN_NPC_HALF_PAY_WINS,
  KESSEN_PAPER_BUNDLE_DAILY_LIMIT,
  KESSEN_VILLAGE_BUNDLE_WEEKLY_LIMIT,
  KessenTiers,
} from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import { KESSEN_BOOK_FACTIONS, KESSEN_FACTION_INFO } from "@/layout/kessen/hub/hubData";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { QueryError } from "@/layout/QueryError";
import {
  KESSEN_AI_TIER_SPECS,
  KESSEN_AI_TIERS,
  KESSEN_AI_VERSION,
} from "@/libs/kessen/ai";
import { KESSEN_DECK_RULES } from "@/libs/kessen/deck";
import {
  KESSEN_NPCS,
  type KessenNpc,
  type KessenNpcUnlock,
  type KessenNpcVariant,
  kessenNpc,
} from "@/libs/kessen/npcs";
import { KESSEN_FACTION_NAMES, kessenPackSlotLabels } from "@/libs/kessen/packs";
import { KESSEN_DROP_TABLES } from "@/libs/kessen/rewards";
import {
  CARD_ENGINE_VERSION,
  DEFAULT_KNOBS,
  LANTERNS,
  ROUND_DRAWS,
  ROWS,
  START_HAND,
} from "@/libs/kessen/rules";
import {
  KESSEN_GLOSSARY,
  KESSEN_KEYWORDS,
  KESSEN_TERMS,
  ROW_LABELS,
} from "@/libs/kessen/text";
import { cn } from "@/libs/shadui";
import { canChangeContent } from "@/utils/permissions";
import { useUserDataSelector } from "@/utils/UserContext";
import type {
  KessenCatalog,
  KessenPackOdds,
  KessenPackSlots,
} from "@/validators/kessen";

/**
 * The Kessen manual: the player reference (how a match plays, rows, deck rules, the
 * keyword glossary, factions and their perks, pack odds and pity, rewards and limits),
 * then for content staff the rules and AI versions, the Circuit roster with every deck,
 * reward and drop table, and the simulation targets the content is tuned to. Everything
 * is read from the shipped code data and the live card catalog.
 */
export default function ManualKessen() {
  const { data: userData } = useUserDataSelector((profile) => ({ role: profile.role }));
  const isStaff = !!userData && canChangeContent(userData.role);
  const catalog = api.kessen.getCatalog.useQuery(undefined, {
    staleTime: Number.POSITIVE_INFINITY,
  });
  const sections = isStaff ? [...PLAYER_SECTIONS, ...STAFF_SECTIONS] : PLAYER_SECTIONS;

  return (
    // Phones inherit a smaller body size; reference text stays readable at every width.
    <div className="text-base">
      <ContentBox
        title="Kessen"
        subtitle="Rules and card reference"
        defaultBackHref="/manual"
      >
        <p>
          Kessen is a best-of-three card duel on a war table of three rows. Win two
          rounds against the Circuit&apos;s ninja to earn ryo, cards and packs, and
          build your own decks from the collection you gather. Lemu teaches the rules in
          two minutes on your first visit to the Card Hall.
        </p>
        <Button asChild className="mt-3">
          <Link href="/kessen">
            <Swords className="h-5 w-5" aria-hidden />
            Open the Card Hall
          </Link>
        </Button>
        <nav aria-label="On this page" className="mt-3">
          <p className="font-bold">On this page</p>
          <ul className="mt-1 flex flex-wrap gap-2">
            {sections.map(([id, label]) => (
              <li key={id}>
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="min-h-[36px] pointer-coarse:min-h-[44px]"
                >
                  <a href={`#${id}`}>{label}</a>
                </Button>
              </li>
            ))}
          </ul>
        </nav>
      </ContentBox>

      <ContentBox
        id="kessen-match"
        title="How a match works"
        subtitle="Rounds, turns and lanterns"
        initialBreak
      >
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Each player starts with {LANTERNS} lanterns. Losing a round puts one out;
            the first player with none left loses the match, so a match lasts two or
            three rounds.
          </li>
          <li>
            You draw {START_HAND} cards at the start, then {ROUND_DRAWS[2]} before Round
            2 and {ROUND_DRAWS[3]} before Round 3. Your hand holds at most{" "}
            {DEFAULT_KNOBS.handCap}; a draw that would pass it is kept as an extra
            mulligan instead (up to {DEFAULT_KNOBS.maxBanked}).
          </li>
          <li>
            Before Round 1 you may swap up to {DEFAULT_KNOBS.r1Mulligans} cards, and up
            to {DEFAULT_KNOBS.laterMulligans} before each later round. Swapped cards go
            to the bottom of your deck.
          </li>
          <li>
            On your turn you do one thing: play a card from your hand, use your
            leader&apos;s ability (once per match) or pass. After passing you take no
            more turns that round; the other player keeps going until they pass too.
          </li>
          <li>
            When both have passed, the side with the higher total power wins the round.
            A tie puts out a lantern on both sides. Then the board clears, except for
            units that carry over.
          </li>
          <li>
            The round winner opens the next round, and going first is the weaker seat.
            The Round 1 opener gets a Shadow Clone token worth{" "}
            {DEFAULT_KNOBS.gambitPower} power to make up for it.
          </li>
          <li>
            Every round counts, but cards are the real resource: winning a round by
            spending your whole hand often loses the match. Passing early to save cards
            for the last round is a strong play.
          </li>
        </ul>
      </ContentBox>

      <ContentBox
        id="kessen-rows"
        title="Rows"
        subtitle="Where units stand"
        initialBreak
      >
        <p>
          Each side has three rows, from the centre line outward:{" "}
          {ROWS.map((row) => ROW_LABELS[row]).join(", ")}. A unit is placed in the row
          printed on it; an Any-row unit picks its row when placed and stays there. A
          row holds at most {DEFAULT_KNOBS.rowCap} units per side. Rows matter through
          the effects that target them: Terrain, Rally, row Strikes, Purge and Empower.
        </p>
      </ContentBox>

      <ContentBox
        id="kessen-decks"
        title="Building a deck"
        subtitle="Leaders, copies and provision"
        initialBreak
      >
        <ul className="list-disc space-y-1 pl-5">
          <li>
            One leader. It sets the faction: the deck holds that faction&apos;s cards
            and Neutral cards. The leader is not part of the deck and its ability works
            once per match.
          </li>
          <li>
            {KESSEN_DECK_RULES.minCards} to {KESSEN_DECK_RULES.maxCards} cards, at most{" "}
            {KESSEN_DECK_RULES.maxTactics} of them tactics, at most{" "}
            {KESSEN_DECK_RULES.maxLegendaries} Legendaries and at most{" "}
            {KESSEN_DECK_RULES.maxInfiltrators} Infiltrators.
          </li>
          <li>
            Copies per card: Common {KESSEN_COPY_LIMITS.COMMON}, Rare{" "}
            {KESSEN_COPY_LIMITS.RARE}, Epic {KESSEN_COPY_LIMITS.EPIC}, Legendary{" "}
            {KESSEN_COPY_LIMITS.LEGENDARY}. A Forbidden card shares its base card&apos;s
            name, so a deck holds one or the other.
          </li>
          <li>
            Provision: the cards&apos; provision may total at most{" "}
            {KESSEN_DECK_RULES.baseBudget} plus the leader&apos;s bonus.
          </li>
          <li>
            You can save {KESSEN_MAX_DECKS} decks. Copies listed in the auction house
            stay out of decks. A deck short of cards can play with borrowed copies, or
            you can play today&apos;s loaner deck.
          </li>
        </ul>
      </ContentBox>

      <ContentBox
        id="kessen-keywords"
        title="Keywords"
        subtitle="The abilities printed on cards"
        initialBreak
      >
        <dl className="grid gap-x-4 sm:grid-cols-[max-content_minmax(0,1fr)] sm:gap-y-2">
          {KESSEN_KEYWORDS.map((keyword) => (
            <div key={keyword} className="contents">
              <dt className="font-bold">{keyword}</dt>
              <dd className="max-sm:mb-2">{KESSEN_GLOSSARY[keyword]}</dd>
            </div>
          ))}
          {Object.entries(KESSEN_TERMS).map(([term, text]) => (
            <div key={term} className="contents">
              <dt className="font-bold">{term}</dt>
              <dd className="max-sm:mb-2">{text}</dd>
            </div>
          ))}
        </dl>
      </ContentBox>

      <ContentBox
        id="kessen-factions"
        title="Factions and perks"
        subtitle="What each deck faction plays for, and its passive perk"
        initialBreak
      >
        <ul className="grid gap-2 sm:grid-cols-2">
          {KESSEN_BOOK_FACTIONS.map((faction) => {
            const info = KESSEN_FACTION_INFO[faction];
            return (
              <li key={faction} className="rounded-md border p-2">
                <p className="font-bold">
                  {KESSEN_FACTION_NAMES[faction]} · {info.region}
                </p>
                <p>{info.identity}</p>
                {info.perk ? (
                  <p>
                    <span className="font-bold">{info.perk}:</span> {info.perkText}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </ContentBox>

      <ContentBox
        id="kessen-packs"
        title="Pack odds and pity"
        subtitle="Per slot, from the live pack items"
        initialBreak
      >
        <CatalogPart catalog={catalog}>
          {(data) => <PackOdds packs={data.packs} />}
        </CatalogPart>
        <p className="mt-2">
          The fifth slot is raised to Epic after {KESSEN_EPIC_PITY_PACKS} packs without
          an Epic and to an unowned Legendary after {KESSEN_LEGENDARY_PITY_PACKS - 1}{" "}
          packs without a Legendary; the counters are shared by every pack. The First
          Bundle&apos;s fifth slot is always Epic or better. Copies of cards you already
          hold at the deck limit re-roll within their rarity.
        </p>
      </ContentBox>

      <ContentBox
        id="kessen-rewards"
        title="Rewards and limits"
        subtitle="What a match pays"
        initialBreak
      >
        <ul className="list-disc space-y-1 pl-5">
          <li>
            A win pays{" "}
            {KessenTiers.map(
              (tier) =>
                `${KESSEN_MATCH_WIN_RYO[tier].toLocaleString()} ryo (${tierLabel(tier)})`,
            ).join(", ")}
            ; a loss pays{" "}
            {KessenTiers.map((tier) =>
              KESSEN_MATCH_LOSS_RYO[tier].toLocaleString(),
            ).join(" / ")}{" "}
            ryo by the same tiers.
          </li>
          <li>
            {KESSEN_DAILY_REWARDED_MATCHES} matches a day are rewarded and{" "}
            {KESSEN_DAILY_DROP_ROLLS} wins a day roll the opponent&apos;s card drops;
            later matches are practice. Against one opponent the first{" "}
            {KESSEN_NPC_FULL_PAY_WINS} wins of a day pay full ryo and wins up to{" "}
            {KESSEN_NPC_HALF_PAY_WINS} pay half.
          </li>
          <li>
            Your first rewarded win of the week adds a Paper Bundle. The first win
            against each opponent, and again on its Ascended rematch, grants that
            opponent&apos;s first-win reward once.
          </li>
          <li>
            The Card Master sells {KESSEN_PAPER_BUNDLE_DAILY_LIMIT} Paper Bundle a day
            and {KESSEN_VILLAGE_BUNDLE_WEEKLY_LIMIT} Village Bundle a week; the six
            Village Bundles share that weekly purchase. Weeks start Monday 00:00 UTC.
          </li>
          <li>
            A match pays only after {KESSEN_MIN_MATCH_SECONDS} seconds and{" "}
            {KESSEN_MIN_TOTAL_PLAYS} cards played; conceded matches pay nothing, and a
            match left idle for {KESSEN_MATCH_IDLE_EXPIRY_HOURS} hours ends as a loss.
          </li>
          <li>
            Surplus copies beyond the deck limit sell for Common{" "}
            {KESSEN_CARD_SELL_VALUES.COMMON.toLocaleString()}, Rare{" "}
            {KESSEN_CARD_SELL_VALUES.RARE.toLocaleString()}, Epic{" "}
            {KESSEN_CARD_SELL_VALUES.EPIC.toLocaleString()} and Legendary{" "}
            {KESSEN_CARD_SELL_VALUES.LEGENDARY.toLocaleString()} ryo. Leaders and
            Forbidden cards never sell.
          </li>
        </ul>
      </ContentBox>

      {isStaff ? (
        <CatalogPart catalog={catalog}>
          {(data) => <StaffReference catalog={data} />}
        </CatalogPart>
      ) : null}
    </div>
  );
}

/** A part of the page drawn from the card catalog, with its loading and error states. */
const CatalogPart = ({
  catalog,
  children,
}: {
  catalog: {
    data?: KessenCatalog;
    isError: boolean;
    isFetching: boolean;
    error: { message: string } | null;
    refetch: () => unknown;
  };
  children: (data: KessenCatalog) => React.ReactNode;
}) => {
  if (catalog.isError && !catalog.data) {
    return (
      <QueryError
        layout="panel"
        message={`The card catalog could not be loaded: ${catalog.error?.message ?? "unknown error"}`}
        isRetrying={catalog.isFetching}
        onRetry={() => void catalog.refetch()}
      />
    );
  }
  if (!catalog.data) return <Loader explanation="Loading the card catalog" />;
  return children(catalog.data);
};

/** Staff reference: versions and knobs, AI tiers, the Circuit, drops and balance. */
const StaffReference = ({ catalog }: { catalog: KessenCatalog }) => {
  const names = new Map<string, string>(
    catalog.cards.map((card) => [card.id, card.name]),
  );
  for (const pack of catalog.packs) names.set(pack.id, pack.name);
  const nameOf = (itemId: string) => names.get(itemId) ?? itemId;
  const cardCount = catalog.cards.filter((card) => card.isCollectible).length;
  const missedTargets = BALANCE_TARGETS.filter((row) => !row.met).length;

  return (
    <>
      <ContentBox
        id="kessen-staff"
        title="Staff reference"
        subtitle="Versions, knobs and where content lives"
        initialBreak
      >
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
          <Fact label="Rules version" value={CARD_ENGINE_VERSION} />
          <Fact label="AI version" value={KESSEN_AI_VERSION} />
          <Fact label="Catalog fingerprint" value={catalog.fingerprint} />
          <Fact label="Collectible cards" value={cardCount} />
          <Fact
            label="Rewarded matches per day"
            value={KESSEN_DAILY_REWARDED_MATCHES}
          />
          <Fact label="Drop rolls per day" value={KESSEN_DAILY_DROP_ROLLS} />
          <Fact label="Epic pity (packs)" value={KESSEN_EPIC_PITY_PACKS} />
          <Fact label="Legendary pity (packs)" value={KESSEN_LEGENDARY_PITY_PACKS} />
        </dl>
        <p className="mt-3">
          A stored match records the rules version it started under; a match from
          another version expires unrewarded on its next turn. Raise the version
          whenever a rule, knob or ability handler changes how a recorded match would
          replay. Cards are ordinary items of type Card: edit their numbers and
          abilities in the{" "}
          <Link href="/manual/item" className="font-bold underline">
            item editor
          </Link>
          ; NPC decks, unlocks and rewards are code data in{" "}
          <code>libs/kessen/npcs.ts</code>.
        </p>
        <h3 className="mt-4 font-bold">Rule knobs</h3>
        <ul className="grid grid-cols-2 gap-x-4 sm:grid-cols-3 lg:grid-cols-4">
          {Object.entries(DEFAULT_KNOBS).map(([knob, value]) => (
            <li key={knob} className="flex justify-between gap-2">
              <code className="min-w-0 break-all">{knob}</code>
              <span className="font-bold">{String(value)}</span>
            </li>
          ))}
        </ul>
      </ContentBox>

      <ContentBox
        id="kessen-ai"
        title="AI tiers"
        subtitle="Search settings per difficulty"
        initialBreak
      >
        <ResponsiveTable
          label="AI tiers"
          columns={[
            "Tier",
            "Mistakes",
            "Plan depth",
            "Rollout samples",
            "Candidates",
            "Budget",
            "Match horizon",
          ]}
          rows={KESSEN_AI_TIERS.map((tier) => {
            const spec = KESSEN_AI_TIER_SPECS[tier];
            return {
              key: tier,
              title: tierLabel(tier),
              cells: [
                tierLabel(tier),
                `${spec.mistakePct}%`,
                spec.planDepth,
                spec.samples,
                spec.rolloutCandidates,
                spec.budget.toLocaleString(),
                spec.matchHorizon ? "yes" : "no",
              ],
            };
          })}
        />
        <p className="mt-2">
          The budget caps engine applications per decision, which bounds the slowest
          Kage turn on the server. The AI decides from the redacted view of its own seat
          only.
        </p>
      </ContentBox>

      <ContentBox
        id="kessen-circuit"
        title="Circuit roster"
        subtitle="Unlock order, decks, house rules and rewards"
        initialBreak
      >
        <div className="flex flex-col gap-4">
          {KESSEN_NPCS.map((npc) => (
            <NpcEntry key={npc.key} npc={npc} nameOf={nameOf} />
          ))}
        </div>
      </ContentBox>

      <ContentBox
        id="kessen-drops"
        title="Drop tables"
        subtitle="Repeat-win drop chances"
        initialBreak
      >
        <ResponsiveTable
          label="Drop tables"
          columns={[
            "Table",
            "Card chance",
            "Common",
            "Rare",
            "Epic",
            "Legendary",
            "Forbidden",
          ]}
          rows={Object.entries(KESSEN_DROP_TABLES).map(([key, table]) => ({
            key,
            title: key,
            cells: [
              key,
              percent(table.cardBp),
              percent(table.rarityBp.COMMON),
              percent(table.rarityBp.RARE),
              percent(table.rarityBp.EPIC),
              percent(table.rarityBp.LEGENDARY),
              percent(table.forbiddenBp),
            ],
          }))}
        />
      </ContentBox>

      <ContentBox
        id="kessen-balance"
        title="Balance targets"
        subtitle="Simulation bands the content is tuned to"
        initialBreak
      >
        <p>
          {missedTargets} of {BALANCE_TARGETS.length} targets are missed; they are
          marked in red.
        </p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left">
            <caption className="sr-only">Balance targets</caption>
            <thead>
              <tr className="border-b">
                <th className="p-1">Metric</th>
                <th className="p-1">Target</th>
                <th className="p-1">Measured</th>
              </tr>
            </thead>
            <tbody>
              {BALANCE_TARGETS.map((row) => (
                <tr
                  key={row.metric}
                  className={cn(
                    "border-b last:border-0",
                    !row.met && "bg-destructive/10 text-destructive",
                  )}
                >
                  <td className="p-1">{row.metric}</td>
                  <td className="p-1">{row.target}</td>
                  <td className="p-1">
                    <span className="inline-flex items-center gap-1 font-bold">
                      {row.met ? (
                        <Check className="h-4 w-4 shrink-0" aria-hidden />
                      ) : (
                        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                      )}
                      {row.measured}
                      <span className="sr-only">
                        {row.met ? " (within target)" : " (target missed)"}
                      </span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3 className="mt-4 font-bold">Known risks</h3>
        <ul className="list-disc pl-5">
          {BALANCE_RISKS.map((risk) => (
            <li key={risk}>{risk}</li>
          ))}
        </ul>
        <p className="mt-2">
          Measurements come from AI self-play: thousands of seeded matches per pairing
          with the shipped decks. Rerun the simulations after changing card numbers,
          knobs or NPC decks.
        </p>
      </ContentBox>
    </>
  );
};

/** One Circuit NPC: unlock, tiers, house rules, rewards and both decks. */
const NpcEntry = ({
  npc,
  nameOf,
}: {
  npc: KessenNpc;
  nameOf: (itemId: string) => string;
}) => (
  <section className="rounded-md border p-2">
    <h3 className="flex flex-wrap items-center gap-2 text-lg font-bold">
      {npc.name}, {npc.title}
      {npc.boss ? (
        <Badge variant="destructive">Boss</Badge>
      ) : npc.champion ? (
        <Badge variant="secondary">Champion</Badge>
      ) : null}
    </h3>
    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3">
      <dt className="text-muted-foreground">Where</dt>
      <dd>
        {npc.location} · {KESSEN_FACTION_NAMES[npc.faction]}
      </dd>
      <dt className="text-muted-foreground">Unlock</dt>
      <dd>{unlockText(npc.unlock)}</dd>
      <dt className="text-muted-foreground">Teaches</dt>
      <dd>{npc.teaches.join(", ") || "basics"}</dd>
    </dl>
    <div className={cn("mt-2 grid gap-3", npc.ascended && "md:grid-cols-2")}>
      <VariantEntry label="Standard" variant={npc.standard} nameOf={nameOf} />
      {npc.ascended ? (
        <VariantEntry label="Ascended" variant={npc.ascended} nameOf={nameOf} />
      ) : null}
    </div>
  </section>
);

/** One mode of an NPC: tier, drops, house rule, first-win reward and the deck list. */
const VariantEntry = ({
  label,
  variant,
  nameOf,
}: {
  label: string;
  variant: KessenNpcVariant;
  nameOf: (itemId: string) => string;
}) => {
  // Phones list each deck on request; wider screens always show it.
  const [showDeck, setShowDeck] = useState(false);
  const deckId = useId();
  const reward = [
    ...variant.firstWin.items.map(
      (item) =>
        `${nameOf(item.itemId)}${item.quantity > 1 ? ` ×${item.quantity}` : ""}`,
    ),
    ...(variant.firstWin.choice ? [choiceText(variant.firstWin.choice, nameOf)] : []),
    ...(variant.firstWin.badge ? [`badge ${variant.firstWin.badge}`] : []),
    ...(variant.firstWin.title ? [`title ${variant.firstWin.title}`] : []),
  ];
  const cards = variant.deck.cards.reduce((sum, entry) => sum + entry.count, 0);
  return (
    <div className="bg-muted/40 @container rounded-md p-2">
      <p className="flex flex-wrap items-center gap-2 font-bold">
        {label}
        <Badge variant="outline">{tierLabel(variant.tier)}</Badge>
        <Badge variant="secondary">
          {variant.dropTable ? `drops ${variant.dropTable}` : "no drops"}
        </Badge>
      </p>
      {variant.houseRule ? (
        <p>
          <span className="font-bold">{variant.houseRule.name}:</span>{" "}
          {variant.houseRule.text}
        </p>
      ) : null}
      <p>
        <span className="font-bold">First win:</span> {reward.join(", ") || "nothing"}
      </p>
      <p className="mt-1">
        <span className="font-bold">Leader:</span> {nameOf(variant.deck.leaderId)}
      </p>
      <Button
        type="button"
        variant="link"
        className="px-0 font-bold md:hidden"
        aria-expanded={showDeck}
        aria-controls={deckId}
        onClick={() => setShowDeck((open) => !open)}
      >
        {showDeck ? "Hide" : "Show"} the {cards}-card deck
        <ChevronDown
          className={cn("ml-1 h-4 w-4 transition-transform", showDeck && "rotate-180")}
          aria-hidden
        />
      </Button>
      <p className="hidden font-bold md:block">{cards} cards</p>
      <ul
        id={deckId}
        className={cn(
          "grid list-disc gap-x-6 pl-5 @lg:grid-cols-2",
          !showDeck && "max-md:hidden",
        )}
      >
        {variant.deck.cards.map((entry) => (
          <li key={entry.itemId}>
            {nameOf(entry.itemId)}
            {entry.count > 1 ? ` ×${entry.count}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
};

/**
 * Pack odds: on phones one card per pack with a row for its normal slots and one for its
 * rare slot; from `sm` one table row per slot kind. Slot numbers come from each pack's
 * stored caches.
 */
const PackOdds = ({
  packs,
}: {
  packs: readonly {
    id: string;
    name: string;
    odds: Record<PackSlot, KessenPackOdds>;
    slots: KessenPackSlots;
  }[];
}) => (
  <>
    <ul aria-label="Pack odds" className="flex flex-col gap-2 sm:hidden">
      {packs.map((pack) => (
        <li key={pack.id} className="rounded-md border p-2">
          <p className="font-bold">{pack.name}</p>
          {packSlotsOf(pack.slots).map(([slot, slotLabel]) => (
            <div key={slot} className="mt-1">
              <p className="text-muted-foreground">{slotLabel}</p>
              <dl className="grid grid-cols-2 gap-x-4">
                {RARITY_COLUMNS.map(([rarity, label]) => (
                  <div key={rarity} className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="font-bold">{percent(pack.odds[slot][rarity])}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </li>
      ))}
    </ul>
    <div className="hidden overflow-x-auto sm:block">
      <table className="w-full text-left">
        <caption className="sr-only">Pack odds</caption>
        <thead>
          <tr className="border-b">
            <th className="p-1">Pack</th>
            <th className="p-1">Slots</th>
            {RARITY_COLUMNS.map(([rarity, label]) => (
              <th key={rarity} className="p-1">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {packs.flatMap((pack) =>
            packSlotsOf(pack.slots).map(([slot, slotLabel], index) => (
              <tr key={`${pack.id}-${slot}`} className="border-b last:border-0">
                <td className="p-1 font-bold">{index === 0 ? pack.name : ""}</td>
                <td className="p-1">{slotLabel}</td>
                {RARITY_COLUMNS.map(([rarity]) => (
                  <td key={rarity} className="p-1">
                    {percent(pack.odds[slot][rarity])}
                  </td>
                ))}
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  </>
);

/**
 * A reference table that stays readable on phones: below `sm` each row is a card with
 * its title and one labelled value per column, so no column is cut off.
 */
const ResponsiveTable = ({
  label,
  columns,
  rows,
}: {
  label: string;
  columns: readonly string[];
  rows: readonly { key: string; title: string; cells: readonly React.ReactNode[] }[];
}) => (
  <>
    <ul aria-label={label} className="flex flex-col gap-2 sm:hidden">
      {rows.map((row) => (
        <li key={row.key} className="rounded-md border p-2">
          <p className="font-bold">{row.title}</p>
          <dl className="grid grid-cols-2 gap-x-3">
            {columns.slice(1).map((column, index) => (
              <div key={column} className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{column}</dt>
                <dd className="font-bold">{row.cells[index + 1]}</dd>
              </div>
            ))}
          </dl>
        </li>
      ))}
    </ul>
    <div className="hidden overflow-x-auto sm:block">
      <table className="w-full text-left">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr className="border-b">
            {columns.map((column) => (
              <th key={column} className="p-1">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b last:border-0">
              {row.cells.map((cell, index) => (
                <td
                  key={columns[index]}
                  className={index === 0 ? "p-1 font-bold" : "p-1"}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>
);

const Fact = ({ label, value }: { label: string; value: string | number }) => (
  <div>
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="font-bold">{value}</dd>
  </div>
);

const percent = (basisPoints: number | undefined) =>
  basisPoints ? `${(basisPoints / 100).toLocaleString()}%` : "–";

const tierLabel = (tier: string) => tier.charAt(0) + tier.slice(1).toLowerCase();

const RARITY_COLUMNS = [
  ["COMMON", "Common"],
  ["RARE", "Rare"],
  ["EPIC", "Epic"],
  ["LEGENDARY", "Legendary"],
  ["FORBIDDEN", "Forbidden"],
] as const satisfies readonly (readonly [keyof KessenPackOdds, string])[];

/** A pack's slot kinds with their labels; a pack without a rare slot lists one. */
const packSlotsOf = (slots: KessenPackSlots): (readonly [PackSlot, string])[] => {
  const labels = kessenPackSlotLabels(slots);
  return [
    ["normal", labels.normal],
    ...(slots.rareSlot > 0 ? [["rareSlot", labels.rareSlot] as const] : []),
  ];
};

/** In-page sections linked from the overview, for every reader and then for staff. */
const PLAYER_SECTIONS: readonly (readonly [string, string])[] = [
  ["kessen-match", "How a match works"],
  ["kessen-rows", "Rows"],
  ["kessen-decks", "Building a deck"],
  ["kessen-keywords", "Keywords"],
  ["kessen-factions", "Factions"],
  ["kessen-packs", "Pack odds"],
  ["kessen-rewards", "Rewards"],
];
const STAFF_SECTIONS: readonly (readonly [string, string])[] = [
  ["kessen-staff", "Staff reference"],
  ["kessen-ai", "AI tiers"],
  ["kessen-circuit", "Circuit roster"],
  ["kessen-drops", "Drop tables"],
  ["kessen-balance", "Balance targets"],
];

type PackSlot = "normal" | "rareSlot";

const unlockText = (unlock: KessenNpcUnlock) => {
  switch (unlock.kind) {
    case "always":
      return "always open";
    case "beat":
      return `beat ${unlock.npcs.map((key) => kessenNpc(key)?.name ?? key).join(" and ")}`;
    case "champion":
      return "after Kazehiko, home champion first";
    case "champions":
      return `any ${unlock.count} village champions`;
  }
};

const choiceText = (
  choice: NonNullable<KessenNpcVariant["firstWin"]["choice"]>,
  nameOf: (itemId: string) => string,
) => {
  switch (choice.kind) {
    case "items":
      return `one of ${choice.itemIds.map(nameOf).join(" or ")}`;
    case "unownedLegendary":
      return "one unowned standard legendary";
    case "starterFaction":
      return "a starter faction";
  }
};

/**
 * Target bands and the latest self-play measurements (Chunin mirror unless noted);
 * `met` says whether the measurement falls inside its band.
 */
const BALANCE_TARGETS = [
  {
    metric: "Round 1 opener win rate, mirror",
    target: "49–51%",
    measured: "49.7%",
    met: true,
  },
  { metric: "Faction win rates", target: "47–53%", measured: "48.4–51.7%", met: true },
  {
    metric: "Worst faction matchup",
    target: "≤ 60/40",
    measured: "60/40 (59.6%)",
    met: true,
  },
  {
    metric: "Starter decks, round-robin",
    target: "44–56% each",
    measured: "46.7–53.7%",
    met: true,
  },
  {
    metric: "Alternative vs starter leader",
    target: "±5 points",
    measured: "45.0–51.8%",
    met: true,
  },
  { metric: "Loaner vs starters", target: "40–46%", measured: "44.1%", met: true },
  { metric: "Loaner vs champions", target: "≥ 35%", measured: "43.3%", met: true },
  {
    metric: "Full collection vs starters",
    target: "≤ 62%",
    measured: "55.9%",
    met: true,
  },
  { metric: "Matches won 2–0", target: "35–45%", measured: "23%", met: false },
  {
    metric: "Comeback after losing Round 1",
    target: "30–40%",
    measured: "37.7%",
    met: true,
  },
  { metric: "Plays per match", target: "18–30", measured: "27.7", met: true },
  {
    metric: "Tied rounds",
    target: "≤ 3%",
    measured: "3.1% (plus 2.9% won by Rigged Odds)",
    met: false,
  },
  { metric: "Chunin over Genin", target: "≥ 65%", measured: "60.6%", met: false },
  { metric: "Jonin over Chunin", target: "≥ 65%", measured: "72.7%", met: true },
  { metric: "Kage over Jonin", target: "≥ 63%", measured: "62.7%", met: false },
  {
    metric: "Kage decision time, p99",
    target: "≤ 150 ms",
    measured: "118 ms",
    met: true,
  },
  {
    metric: "Always dry-pass Round 1 bot",
    target: "< 45%",
    measured: "26.2%",
    met: true,
  },
];

/**
 * Self-play win rates of the Infiltrator-built Syndicate list against Chunin decks, and
 * of the Syndicate starter in the same field.
 */
const INFILTRATOR_LIST_WIN_RATE = { list: "61%", starter: "48%" };

const BALANCE_RISKS = [
  `A Syndicate list built around Infiltrators wins about ${INFILTRATOR_LIST_WIN_RATE.list} against Chunin decks (its starter ${INFILTRATOR_LIST_WIN_RATE.starter}); the gain comes from the Chunin Infiltrator opener and disappears against Jonin.`,
  "Few matches end 2–0: one extra card in Round 3 wins about three in four, so conceding Round 2 is usually right.",
  "About 3% of rounds end tied and unresolved; another 3% are ties won by Rigged Odds.",
  "Hyorin over Tsukimori is the widest matchup, about 60/40; Akasumi over Shirohana is about 58/42.",
  "Chunin over Genin and Kage over Jonin sit below the design's margin; the game's variance limits how far a stronger tier pulls ahead.",
  "The AI still misplays Torrential Rain, Seal of Nullification and Cryostorm Aegis.",
];
