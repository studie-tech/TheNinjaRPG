"use client";

import { Pencil } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { type KessenSimState, useKessenBalance } from "@/hooks/kessen/useKessenBalance";
import { useKessenCatalog } from "@/hooks/kessen/useKessenHub";
import ContentBox from "@/layout/ContentBox";
import {
  BandMeter,
  FlagList,
  type KessenBalanceStatus,
  LIMIT_BAND,
  StatusMark,
  signed,
  statusOf,
  TARGET_BAND,
} from "@/layout/kessen/balance/BalanceParts";
import { FactionSigil } from "@/layout/kessen/FactionSigil";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { KESSEN_AI_VERSION } from "@/libs/kessen/ai";
import {
  KESSEN_BALANCE,
  KESSEN_BALANCE_FACTIONS,
  type KessenBalanceFlag,
  type KessenCardBalance,
  type KessenCatalogBalance,
  points,
} from "@/libs/kessen/balance";
import {
  isTrialSubject,
  KESSEN_BALANCE_SIM,
  type KessenGauntletSummary,
  type KessenTrialSummary,
  medianOf,
  percent,
  trialReference,
} from "@/libs/kessen/balanceSim";
import { KESSEN_DECK_RULES } from "@/libs/kessen/deck";
import { KESSEN_FACTION_NAMES } from "@/libs/kessen/packs";
import { CARD_ENGINE_VERSION } from "@/libs/kessen/rules";
import { cn } from "@/libs/shadui";
import { canChangeContent } from "@/utils/permissions";
import { useUserDataSelector } from "@/utils/UserContext";
import type { KessenFaction } from "@/validators/itemCard";

/**
 * Kessen balance: every collectible card, leader, set and faction against the balance
 * guidelines, with the seeded gauntlet and match trials played in this browser. Public,
 * so a change that leaves the guidelines is visible to everyone.
 */
export function ManualKessenBalanceScreen() {
  const { data: userData } = useUserDataSelector((profile) => ({ role: profile.role }));
  const canEdit = !!userData && canChangeContent(userData.role);
  const catalog = useKessenCatalog();
  const { report, sims } = useKessenBalance(catalog.data?.cards);
  const issues = useMemo(() => (report ? issuesOf(report, sims) : []), [report, sims]);

  return (
    <div className="text-base">
      <ContentBox
        title="Kessen Balance"
        subtitle="Every card and faction against the balance guidelines"
        defaultBackHref="/manual/kessen"
      >
        <p>
          Each card is priced by the value curve, and every faction is measured in
          matches between the AI on fixed seeds. The same catalog always yields the same
          numbers on every device, so any change that leaves the guidelines shows up
          here.{" "}
          <a href="#kessen-balance-guidelines" className="font-semibold underline">
            Read the guidelines
          </a>
          .
        </p>
        {report ? (
          <Summary report={report} sims={sims} issues={issues} />
        ) : (
          <Loader explanation="Loading the card catalog" />
        )}
      </ContentBox>
      {report ? (
        <>
          <ContentBox
            id="kessen-balance-factions"
            title="Factions"
            subtitle="Gauntlet win rate, curve bias, pool and reference decks"
            initialBreak
          >
            <FactionGrid report={report} gauntlet={sims.gauntlet} />
          </ContentBox>
          <ContentBox
            id="kessen-balance-health"
            title="Match health"
            subtitle={`Across ${sims.gauntlet?.health.games ?? "the"} gauntlet games`}
            initialBreak
          >
            <HealthGrid gauntlet={sims.gauntlet} />
          </ContentBox>
          <ContentBox
            id="kessen-balance-cards"
            title="Cards"
            subtitle="Value curve, variant parity and match trials of collectible deck cards"
            initialBreak
          >
            <CardList report={report} trials={sims.trials} canEdit={canEdit} />
          </ContentBox>
          <ContentBox
            id="kessen-balance-leaders"
            title="Leaders"
            subtitle="Leader bonus and what the ability adds with the same faction passive"
            initialBreak
          >
            <LeaderList report={report} trials={sims.trials} canEdit={canEdit} />
          </ContentBox>
          <ContentBox
            id="kessen-balance-sets"
            title="Sets"
            subtitle="What Bonds count and Summons pull"
            initialBreak
          >
            <SetList report={report} />
          </ContentBox>
        </>
      ) : null}
      <ContentBox
        id="kessen-balance-guidelines"
        title="Guidelines"
        subtitle="What each check measures and where its limit sits"
        initialBreak
      >
        <Guidelines />
      </ContentBox>
    </div>
  );
}

/** Counts, simulation progress and every flag of the catalog. */
function Summary({
  report,
  sims,
  issues,
}: {
  report: KessenCatalogBalance;
  sims: KessenSimState;
  issues: Issue[];
}) {
  const breaks = issues.filter((issue) => issue.flag.severity === "break").length;
  const warnings = issues.length - breaks;
  const clean = report.cards.filter(
    (entry) =>
      entry.flags.length === 0 &&
      (sims.trials?.[entry.card.id]?.flags.length ?? 0) === 0,
  ).length;
  const factionsInBand = sims.gauntlet
    ? sims.gauntlet.factions.filter((faction) => faction.flags.length === 0).length
    : null;
  return (
    <div className="@container mt-3 grid gap-3">
      <dl className="grid grid-cols-2 gap-2 @xl:grid-cols-4">
        <Tile label="Cards in guidelines" value={`${clean}/${report.cards.length}`} />
        <Tile
          label="Breaks"
          value={String(breaks)}
          status={breaks > 0 ? "break" : "ok"}
        />
        <Tile
          label="Warnings"
          value={String(warnings)}
          status={warnings > 0 ? "warn" : "ok"}
        />
        <Tile
          label="Factions in band"
          value={factionsInBand === null ? "…" : `${factionsInBand}/6`}
          status={
            factionsInBand === null ? undefined : factionsInBand === 6 ? "ok" : "break"
          }
        />
      </dl>
      <SimProgress sims={sims} />
      {issues.length > 0 ? (
        <section aria-labelledby="kessen-balance-issues">
          <h3 id="kessen-balance-issues" className="font-bold">
            Flagged
          </h3>
          <ul className="mt-1 grid gap-1">
            {groupIssues(issues).map((group) => (
              <li
                key={`${group.anchor}:${group.subject}`}
                className="flex items-start gap-1.5"
              >
                <StatusMark status={statusOf(group.flags)} className="mt-0.5" />
                <span>
                  <a href={`#${group.anchor}`} className="font-semibold underline">
                    {group.subject}
                  </a>
                  : {group.flags.map((flag) => flag.message).join("; ")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p>
          <StatusMark status="ok" label="Nothing is flagged." />
        </p>
      )}
      <p className="text-muted-foreground text-sm">
        Catalog fingerprint <code>{report.fingerprint}</code>, match rules v
        {CARD_ENGINE_VERSION}, AI v{KESSEN_AI_VERSION}
      </p>
    </div>
  );
}

function Tile({
  label,
  value,
  status,
}: {
  label: string;
  value: string;
  status?: KessenBalanceStatus;
}) {
  return (
    <div className="rounded-md border p-2">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="flex items-center gap-1.5 text-xl font-bold">
        {status ? <StatusMark status={status} /> : null}
        {value}
      </dd>
    </div>
  );
}

function SimProgress({ sims }: { sims: KessenSimState }) {
  if (sims.status === "error") {
    return (
      <p role="alert" className="text-red-600 dark:text-red-500">
        The simulations stopped: {sims.error}. Reload the page to run them again.
      </p>
    );
  }
  if (sims.status !== "running") return null;
  const stage =
    sims.stage === "gauntlet"
      ? "Playing the faction gauntlet"
      : "Playing the match trials of every card";
  const value = sims.total > 0 ? (100 * sims.done) / sims.total : 0;
  return (
    <div className="grid gap-1" aria-live="polite">
      <p className="text-sm">
        {stage}: {sims.done.toLocaleString()} of {sims.total.toLocaleString() || "…"}{" "}
        games
      </p>
      <Progress value={value} aria-label={stage} />
    </div>
  );
}

/** A faction card: its gauntlet rate, decks, bias, pool and flags. */
function FactionGrid({
  report,
  gauntlet,
}: {
  report: KessenCatalogBalance;
  gauntlet: KessenGauntletSummary | null;
}) {
  const [low, high] = KESSEN_BALANCE.factionWinRate;
  const [targetLow, targetHigh] = KESSEN_BALANCE.factionTarget;
  return (
    <div className="@container">
      <div className="grid gap-2 @xl:grid-cols-2">
        {KESSEN_BALANCE_FACTIONS.map((faction) => {
          const pool = report.factions.find((entry) => entry.faction === faction);
          const rate = gauntlet?.factions.find((entry) => entry.faction === faction);
          const decks = report.decks.filter((deck) => deck.deck.faction === faction);
          const deckRates = gauntlet?.decks ?? [];
          const flags: KessenBalanceFlag[] = [
            ...(rate?.flags ?? []),
            ...(pool?.flags ?? []),
            ...decks.flatMap((deck) => deck.flags),
            ...deckRates
              .filter((entry) => decks.some((deck) => deck.deck.key === entry.key))
              .flatMap((entry) => entry.flags),
          ];
          const status = statusOf(flags);
          return (
            <section
              key={faction}
              id={`faction-${faction}`}
              aria-label={KESSEN_FACTION_NAMES[faction]}
              className={cn(
                "grid scroll-mt-16 content-start gap-2 rounded-md border p-2",
                // Neutral has no win rate; it takes the row the six factions leave.
                faction === "NEUTRAL" && "@xl:col-span-2",
              )}
            >
              <header className="flex items-center gap-2">
                <FactionSigil faction={faction} className="h-7 w-7" decorative />
                <h3 className="text-lg font-bold">{KESSEN_FACTION_NAMES[faction]}</h3>
                <StatusMark status={status} className="ml-auto" />
              </header>
              {faction === "NEUTRAL" ? (
                <p className="text-muted-foreground text-sm">
                  Neutral cards join every deck; their match trials play from all six
                  factions.
                </p>
              ) : rate ? (
                <div className="grid gap-1">
                  <p className="flex items-baseline justify-between gap-2">
                    <span className="text-muted-foreground text-sm">
                      Gauntlet win rate
                    </span>
                    <span className="text-xl font-bold">
                      {percent(rate.rate.score)}
                      <span className="text-muted-foreground ml-1 text-sm font-normal">
                        ± {Math.round(200 * rate.rate.se)}
                      </span>
                    </span>
                  </p>
                  <BandMeter
                    value={rate.rate.score}
                    whisker={2 * rate.rate.se}
                    domain={[0.3, 0.7]}
                    bands={[
                      { from: low, to: high, className: LIMIT_BAND },
                      { from: targetLow, to: targetHigh, className: TARGET_BAND },
                    ]}
                    status={statusOf(rate.flags)}
                    label={`${percent(rate.rate.score)} win rate; limit ${percent(low)} to ${percent(high)}`}
                  />
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">Simulating…</p>
              )}
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
                {decks.map((deck) => {
                  const deckRate = deckRates.find(
                    (entry) => entry.key === deck.deck.key,
                  );
                  return (
                    <Fact key={deck.deck.key} label={deck.deck.label}>
                      {deckRate ? `${percent(deckRate.rate.score)} · ` : ""}
                      {deck.stats.provision}/{deck.stats.budget} provision
                      {deck.errors.length > 0 ? " · illegal" : ""}
                    </Fact>
                  );
                })}
                <Fact label="Curve bias">
                  {pool?.bias === null || pool?.bias === undefined
                    ? "—"
                    : `${signed(pool.bias / 1000)} (limit ±${points(KESSEN_BALANCE.factionBias)})`}
                </Fact>
                <Fact label="Pool">
                  {pool
                    ? `${pool.counts.COMMON} common · ${pool.counts.RARE} rare · ${pool.counts.EPIC} epic · ${pool.counts.LEGENDARY} legendary`
                    : "—"}
                </Fact>
              </dl>
              <FlagList flags={flags} className="text-sm" />
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

/** The gauntlet's match length, ties, opener score, swings and rows against their limits. */
function HealthGrid({ gauntlet }: { gauntlet: KessenGauntletSummary | null }) {
  if (!gauntlet) return <p className="text-muted-foreground">Simulating…</p>;
  const { health } = gauntlet;
  const limits = KESSEN_BALANCE.health;
  const tiles: { label: string; value: string; limit: string; ok: boolean }[] = [
    {
      label: "Plays per match",
      value: health.plays.toFixed(1),
      limit: `${limits.plays[0]}–${limits.plays[1]}`,
      ok: health.plays >= limits.plays[0] && health.plays <= limits.plays[1],
    },
    {
      label: "Tied rounds",
      value: percent(health.tieRate),
      limit: `at most ${percent(limits.tieRate)}`,
      ok: health.tieRate <= limits.tieRate,
    },
    {
      label: "Round 1 opener scores",
      value: percent(health.opener),
      limit: `${percent(limits.opener[0])}–${percent(limits.opener[1])}`,
      ok: health.opener >= limits.opener[0] && health.opener <= limits.opener[1],
    },
    {
      label: "Swing of the top 1% of plays",
      value: String(health.swingP99),
      limit: `at most ${limits.swingP99}`,
      ok: health.swingP99 <= limits.swingP99,
    },
    {
      label: "Largest swing",
      value: String(health.swingMax),
      limit: `at most ${limits.swingMax}`,
      ok: health.swingMax <= limits.swingMax,
    },
    {
      label: "Largest row",
      value: String(health.rowMax),
      limit: `at most ${limits.rowMax}`,
      ok: health.rowMax <= limits.rowMax,
    },
  ];
  return (
    <div className="@container">
      <dl className="grid grid-cols-2 gap-2 @xl:grid-cols-3">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-md border p-2">
            <dt className="text-muted-foreground text-sm">{tile.label}</dt>
            <dd className="flex items-center gap-1.5 text-xl font-bold">
              <StatusMark status={tile.ok ? "ok" : "break"} />
              {tile.value}
            </dd>
            <dd className="text-muted-foreground text-sm">Limit {tile.limit}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

type CardSort = "flagged" | "gap" | "trial" | "name";

const SORTS: { value: CardSort; label: string }[] = [
  { value: "flagged", label: "Flagged first" },
  { value: "gap", label: "Curve gap" },
  { value: "trial", label: "Trial edge" },
  { value: "name", label: "Name" },
];

/** Deck cards with filters: faction, flagged only, search and sort. */
function CardList({
  report,
  trials,
  canEdit,
}: {
  report: KessenCatalogBalance;
  trials: Record<string, KessenTrialSummary> | null;
  canEdit: boolean;
}) {
  const [faction, setFaction] = useState<KessenFaction | "ALL">("ALL");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<CardSort>("flagged");
  const rows = report.cards
    .filter((entry) => entry.card.kind !== "LEADER")
    .map((entry) => {
      const trial = trials?.[entry.card.id] ?? null;
      const flags = [...entry.flags, ...(trial?.flags ?? [])];
      return { entry, trial, flags, status: statusOf(flags) };
    })
    .filter(
      (row) =>
        (faction === "ALL" || row.entry.card.faction === faction) &&
        (!flaggedOnly || row.flags.length > 0) &&
        row.entry.card.name.toLowerCase().includes(query.trim().toLowerCase()),
    )
    .sort((a, b) => {
      const byName = a.entry.card.name.localeCompare(b.entry.card.name);
      if (sort === "name") return byName;
      if (sort === "gap")
        return (b.entry.gap ?? -1e9) - (a.entry.gap ?? -1e9) || byName;
      if (sort === "trial")
        return (b.trial?.edge ?? -1e9) - (a.trial?.edge ?? -1e9) || byName;
      return RANK[a.status] - RANK[b.status] || byName;
    });
  return (
    <div className="@container grid gap-2">
      <div className="grid gap-2 @3xl:grid-cols-[1fr_auto] @3xl:items-end">
        <fieldset className="m-0 flex min-w-0 flex-wrap gap-1 border-0 p-0">
          <legend className="sr-only">Faction</legend>
          {(["ALL", ...KESSEN_BALANCE_FACTIONS] as const).map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={faction === option ? "default" : "outline"}
              aria-pressed={faction === option}
              className="min-h-[36px] pointer-coarse:min-h-[44px]"
              onClick={() => setFaction(option)}
            >
              {option === "ALL" ? "All" : KESSEN_FACTION_NAMES[option]}
            </Button>
          ))}
        </fieldset>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-h-[36px] items-center gap-2 text-sm pointer-coarse:min-h-[44px]">
            <Switch
              id="kessen-balance-flagged"
              checked={flaggedOnly}
              onCheckedChange={setFlaggedOnly}
            />
            <label htmlFor="kessen-balance-flagged">Flagged only</label>
          </div>
          <label className="flex items-center gap-1 text-sm">
            <span className="text-muted-foreground">Sort</span>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as CardSort)}
              className="bg-background h-9 rounded-md border px-2 pointer-coarse:h-[44px]"
            >
              {SORTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <Input
        type="search"
        placeholder="Search cards"
        aria-label="Search cards"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="h-9 pointer-coarse:h-[44px]"
      />
      <div
        aria-hidden
        className="text-muted-foreground hidden gap-3 border-b pb-1 text-sm @3xl:grid @3xl:grid-cols-[minmax(0,1fr)_9rem_9rem]"
      >
        <span>Card</span>
        <span>Value curve</span>
        <span>Match trial</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-muted-foreground">No cards match.</p>
      ) : (
        <ul className="grid">
          {rows.map((row) => (
            <CardRow key={row.entry.card.id} {...row} canEdit={canEdit} />
          ))}
        </ul>
      )}
    </div>
  );
}

const RANK: Record<KessenBalanceStatus, number> = { break: 0, warn: 1, ok: 2 };

function CardRow({
  entry,
  trial,
  flags,
  status,
  canEdit,
}: {
  entry: KessenCardBalance;
  trial: KessenTrialSummary | null;
  flags: KessenBalanceFlag[];
  status: KessenBalanceStatus;
  canEdit: boolean;
}) {
  const { card } = entry;
  return (
    <li
      id={`card-${card.id}`}
      className="grid scroll-mt-16 gap-x-3 gap-y-1.5 border-b py-2 @3xl:grid-cols-[minmax(0,1fr)_9rem_9rem]"
    >
      <div className="min-w-0">
        <p className="flex items-center gap-1.5">
          <StatusMark status={status} />
          <Link
            href={`/manual/item/${card.id}`}
            className="font-semibold hover:underline"
          >
            {card.name}
          </Link>
          {canEdit ? (
            <Link
              href={`/manual/item/edit/${card.id}`}
              aria-label={`Edit ${card.name}`}
              className="text-muted-foreground hover:text-primary"
            >
              <Pencil className="h-4 w-4" />
            </Link>
          ) : null}
        </p>
        <p className="text-muted-foreground text-sm">
          {KESSEN_FACTION_NAMES[card.faction]} · {capitalized(card.rarity)}{" "}
          {card.kind === "TACTIC" ? "tactic" : "unit"} · {card.power} power ·{" "}
          {card.provision} provision
        </p>
        <FlagList flags={flags} className="mt-1 text-sm" />
      </div>
      <GapCell entry={entry} />
      <TrialCell card={card} trial={trial} />
    </li>
  );
}

function GapCell({ entry }: { entry: KessenCardBalance }) {
  const tolerance = KESSEN_BALANCE.curveTolerance / 1000;
  if (entry.gap === null || entry.value === null || entry.target === null) {
    return (
      <div className="text-sm">
        <span className="text-muted-foreground @3xl:sr-only">Value curve: </span>
        Not priced (Infiltrator)
      </div>
    );
  }
  const gap = entry.gap / 1000;
  const status = statusOf(entry.flags.filter((flag) => flag.rule === "curve"));
  return (
    <div className="grid grid-cols-[11rem_1fr] items-center gap-x-2 text-sm @3xl:grid-cols-1">
      <span className="whitespace-nowrap">
        <span className="text-muted-foreground @3xl:sr-only">Curve </span>
        <span className="font-semibold">{signed(gap)}</span>
        <span className="text-muted-foreground">
          {" "}
          · {points(entry.value)} vs {points(entry.target)}
        </span>
      </span>
      <BandMeter
        value={gap}
        domain={[-4, 4]}
        bands={[{ from: -tolerance, to: tolerance, className: LIMIT_BAND }]}
        status={status}
        label={`Curve gap ${signed(gap)}; limit ±${tolerance}`}
      />
    </div>
  );
}

function TrialCell({
  card,
  trial,
}: {
  card: KessenCardBalance["card"];
  trial: KessenTrialSummary | null;
}) {
  if (!isTrialSubject(card)) {
    return <p className="text-muted-foreground text-sm">Parity check only</p>;
  }
  if (!trial) {
    return (
      <div className="text-muted-foreground text-sm">
        <span className="@3xl:sr-only">Match trial: </span>Simulating…
      </div>
    );
  }
  const limit = KESSEN_BALANCE.trialEdge;
  return (
    <div className="grid grid-cols-[11rem_1fr] items-center gap-x-2 text-sm @3xl:grid-cols-1">
      <span
        className="whitespace-nowrap"
        title={`Against a vanilla ${trialReference(card).power}-power unit`}
      >
        <span className="text-muted-foreground @3xl:sr-only">Trial </span>
        <span className="font-semibold">{signed(trial.edge)}</span>
        <span className="text-muted-foreground"> ± {(2 * trial.se).toFixed(0)}</span>
      </span>
      <BandMeter
        value={trial.edge}
        whisker={2 * trial.se}
        domain={[-40, 40]}
        bands={[{ from: -limit, to: limit, className: LIMIT_BAND }]}
        status={statusOf(trial.flags)}
        label={`Trial edge ${signed(trial.edge)} points; limit ±${limit}`}
      />
    </div>
  );
}

/** Collectible leaders: bonus range and ability trial edge with the faction passive. */
function LeaderList({
  report,
  trials,
  canEdit,
}: {
  report: KessenCatalogBalance;
  trials: Record<string, KessenTrialSummary> | null;
  canEdit: boolean;
}) {
  const leaders = report.cards
    .filter((entry) => entry.card.kind === "LEADER")
    .sort(
      (a, b) =>
        KESSEN_BALANCE_FACTIONS.indexOf(a.card.faction) -
          KESSEN_BALANCE_FACTIONS.indexOf(b.card.faction) ||
        a.card.name.localeCompare(b.card.name),
    );
  const edges = leaders.flatMap((entry) => {
    const edge = trials?.[entry.card.id]?.edge;
    return edge === undefined ? [] : [edge];
  });
  const median = edges.length > 0 ? medianOf(edges) : null;
  const spread = KESSEN_BALANCE.leaderSpread;
  return (
    <div className="@container">
      <ul className="grid gap-x-4 @3xl:grid-cols-2">
        {leaders.map((entry) => {
          const trial = trials?.[entry.card.id] ?? null;
          const flags = [...entry.flags, ...(trial?.flags ?? [])];
          return (
            <li
              key={entry.card.id}
              id={`card-${entry.card.id}`}
              className="grid scroll-mt-16 gap-1 border-b py-2"
            >
              <p className="flex items-center gap-1.5">
                <StatusMark status={statusOf(flags)} />
                <Link
                  href={`/manual/item/${entry.card.id}`}
                  className="font-semibold hover:underline"
                >
                  {entry.card.name}
                </Link>
                {canEdit ? (
                  <Link
                    href={`/manual/item/edit/${entry.card.id}`}
                    aria-label={`Edit ${entry.card.name}`}
                    className="text-muted-foreground hover:text-primary"
                  >
                    <Pencil className="h-4 w-4" />
                  </Link>
                ) : null}
              </p>
              <p className="text-muted-foreground text-sm">
                {KESSEN_FACTION_NAMES[entry.card.faction]} · Leader bonus{" "}
                {entry.card.leaderBonus} (limit {KESSEN_BALANCE.leaderBonus[0]}–
                {KESSEN_BALANCE.leaderBonus[1]})
              </p>
              {trial && median !== null ? (
                <div className="grid gap-1 text-sm">
                  <span>
                    <span className="text-muted-foreground">Adds </span>
                    <span className="font-semibold">{signed(trial.edge)}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      ± {(2 * trial.se).toFixed(0)} win-rate points over a leader
                      without abilities
                    </span>
                  </span>
                  <BandMeter
                    value={trial.edge}
                    whisker={2 * trial.se}
                    domain={[0, 80]}
                    bands={[
                      {
                        from: median - spread,
                        to: median + spread,
                        className: LIMIT_BAND,
                      },
                    ]}
                    status={statusOf(trial?.flags ?? [])}
                    label={`Adds ${signed(trial.edge)} points; median leader ${signed(median)}`}
                  />
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">Simulating…</p>
              )}
              <FlagList flags={flags} className="text-sm" />
            </li>
          );
        })}
      </ul>
      {median !== null ? (
        <p className="text-muted-foreground mt-2 text-sm">
          The shaded range is the median leader ({signed(median)}) ± {spread} points.
        </p>
      ) : null}
    </div>
  );
}

/** Sets with members, callers and their strongest Summon pull. */
function SetList({ report }: { report: KessenCatalogBalance }) {
  if (report.sets.length === 0) return <p>No card belongs to a set.</p>;
  return (
    <div className="@container">
      <ul className="grid gap-2 @xl:grid-cols-2">
        {report.sets.map((set) => {
          const flags = report.cards
            .filter((entry) => set.callers.some((card) => card.id === entry.card.id))
            .flatMap((entry) =>
              entry.flags.filter(
                (flag) =>
                  (flag.rule === "summonSet" || flag.rule === "bondSet") &&
                  flag.message.includes(set.name),
              ),
            );
          const unique = [
            ...new Map(flags.map((flag) => [flag.message, flag])).values(),
          ];
          return (
            <li
              key={set.name}
              className="grid content-start gap-1 rounded-md border p-2"
            >
              <p className="flex items-center gap-1.5 font-bold">
                <StatusMark status={statusOf(unique)} />
                {set.name}
              </p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
                <Fact label="Members">
                  {set.members.map((card) => card.name).join(", ") || "None"}
                </Fact>
                <Fact label="Called by">
                  {set.callers.map((card) => card.name).join(", ") || "None"}
                </Fact>
                {set.maxSummonPower === null ? null : (
                  <Fact label="Strongest pull">{set.maxSummonPower} power</Fact>
                )}
              </dl>
              <FlagList flags={unique} className="text-sm" />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Every guideline with its limit, read from `KESSEN_BALANCE`. */
function Guidelines() {
  const g = KESSEN_BALANCE;
  const ranges = (["COMMON", "RARE", "EPIC", "LEGENDARY"] as const)
    .map(
      (rarity) =>
        `${capitalized(rarity)} ${g.provision[rarity][0]}–${g.provision[rarity][1]}`,
    )
    .join(", ");
  const rules: [string, React.ReactNode][] = [
    [
      "Value curve",
      <>
        Power plus a fixed price per ability must match the card&apos;s provision plus
        its rarity premium within ±{points(g.curveTolerance)}. Over the curve breaks the
        guideline; under it is a warning, since situational tactics sit there on
        purpose. Infiltrators and leaders are priced by their trials instead.
      </>,
    ],
    ["Provision range", <>Deck cards cost {ranges} provision.</>],
    [
      "Keywords",
      <>A common or rare card prints one keyword, an epic or legendary two.</>,
    ],
    [
      "Leader bonus",
      <>
        Collectible leaders add {g.leaderBonus[0]}–{g.leaderBonus[1]} provision to the{" "}
        {KESSEN_DECK_RULES.baseBudget} budget.
      </>,
    ],
    [
      "Forbidden variants",
      <>
        A Forbidden variant keeps its base card&apos;s stats exactly; only its art
        differs.
      </>,
    ],
    [
      "Sets",
      <>
        A Summon pulls no unit with more power than the Summon is priced at plus{" "}
        {points(g.curveTolerance)}. A Bond&apos;s set holds {g.bondSet[0]}–
        {g.bondSet[1]} units its decks can field.
      </>,
    ],
    [
      "Faction bias",
      <>
        The cards of a faction that sit on the curve average within ±
        {points(g.factionBias)} of it, so no faction leans strong card by card.
      </>,
    ],
    [
      "Reference decks",
      <>
        Every starter deck and village champion deck stays legal under the current
        cards.
      </>,
    ],
    [
      "Gauntlet",
      <>
        Each reference deck plays every other faction&apos;s{" "}
        {KESSEN_BALANCE_SIM.gauntletGamesPerPair} times on fixed seeds, seats swapped. A
        faction wins {percent(g.factionWinRate[0])}–{percent(g.factionWinRate[1])}{" "}
        (tuned factions sit at {percent(g.factionTarget[0])}–
        {percent(g.factionTarget[1])}); a single deck {percent(g.deckWinRate[0])}–
        {percent(g.deckWinRate[1])}.
      </>,
    ],
    [
      "Match trial",
      <>
        A card takes up to its copy limit of slots in its faction&apos;s starter deck
        (its own copies first, then Musashi Ken Swordsman&apos;s) and plays{" "}
        {KESSEN_BALANCE_SIM.trialGames} games; the same games are replayed with a
        vanilla unit of power equal to its curve target in those slots. The edge is the
        difference in win rate. It warns past ±{g.trialEdge} points once two standard
        errors still keep it clear of zero.
      </>,
    ],
    [
      "Leaders",
      <>
        A leader leads its faction&apos;s starter deck against the same deck with a
        leader without active abilities, preserving the faction passive. It warns when
        its edge sits more than {g.leaderSpread} points from the median leader&apos;s.
      </>,
    ],
    [
      "Match health",
      <>
        Across the gauntlet: {g.health.plays[0]}–{g.health.plays[1]} plays per match, at
        most {percent(g.health.tieRate)} tied rounds, an opener score of{" "}
        {percent(g.health.opener[0])}–{percent(g.health.opener[1])}, the top 1% of plays
        swinging the board by at most {g.health.swingP99}, no play over{" "}
        {g.health.swingMax}, and no row over {g.health.rowMax} power.
      </>,
    ],
  ];
  return (
    <div className="grid gap-2">
      <dl className="grid gap-2">
        {rules.map(([term, text]) => (
          <div key={term}>
            <dt className="font-bold">{term}</dt>
            <dd>{text}</dd>
          </div>
        ))}
      </dl>
      <p className="text-muted-foreground text-sm">
        The matches are played by the {capitalized(KESSEN_BALANCE_SIM.tier)} AI on both
        seats. Saving a card that leaves a guideline records it in the change log and
        the content Discord channel.
      </p>
    </div>
  );
}

/** One flag with the subject it belongs to and where it is shown. */
interface Issue {
  subject: string;
  anchor: string;
  flag: KessenBalanceFlag;
}

/** Every flag of the catalog and the simulations, breaks first. */
const issuesOf = (report: KessenCatalogBalance, sims: KessenSimState): Issue[] => {
  const out: Issue[] = [];
  for (const entry of report.cards) {
    const flags = [...entry.flags, ...(sims.trials?.[entry.card.id]?.flags ?? [])];
    for (const flag of flags) {
      out.push({ subject: entry.card.name, anchor: `card-${entry.card.id}`, flag });
    }
  }
  for (const faction of report.factions) {
    for (const flag of faction.flags) {
      out.push({
        subject: KESSEN_FACTION_NAMES[faction.faction],
        anchor: `faction-${faction.faction}`,
        flag,
      });
    }
  }
  for (const deck of report.decks) {
    for (const flag of deck.flags) {
      out.push({
        subject: KESSEN_FACTION_NAMES[deck.deck.faction],
        anchor: `faction-${deck.deck.faction}`,
        flag,
      });
    }
  }
  const gauntlet = sims.gauntlet;
  if (gauntlet) {
    for (const faction of gauntlet.factions) {
      for (const flag of faction.flags) {
        out.push({
          subject: KESSEN_FACTION_NAMES[faction.faction],
          anchor: `faction-${faction.faction}`,
          flag,
        });
      }
    }
    for (const deck of gauntlet.decks) {
      const faction = report.decks.find((entry) => entry.deck.key === deck.key);
      for (const flag of deck.flags) {
        out.push({
          subject: faction ? KESSEN_FACTION_NAMES[faction.deck.faction] : deck.key,
          anchor: faction
            ? `faction-${faction.deck.faction}`
            : "kessen-balance-factions",
          flag,
        });
      }
    }
    for (const flag of gauntlet.health.flags) {
      out.push({ subject: "Match health", anchor: "kessen-balance-health", flag });
    }
  }
  return out.sort(
    (a, b) =>
      (a.flag.severity === "break" ? 0 : 1) - (b.flag.severity === "break" ? 0 : 1),
  );
};

/** Issues of one subject together, in the order their first issue appears. */
const groupIssues = (issues: readonly Issue[]) => {
  const groups = new Map<
    string,
    { subject: string; anchor: string; flags: KessenBalanceFlag[] }
  >();
  for (const issue of issues) {
    const key = `${issue.anchor}:${issue.subject}`;
    const group = groups.get(key);
    if (group) group.flags.push(issue.flag);
    else {
      groups.set(key, {
        subject: issue.subject,
        anchor: issue.anchor,
        flags: [issue.flag],
      });
    }
  }
  return [...groups.values()];
};

const capitalized = (value: string) => value.charAt(0) + value.slice(1).toLowerCase();
