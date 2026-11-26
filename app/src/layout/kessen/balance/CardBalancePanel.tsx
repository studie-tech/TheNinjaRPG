"use client";

import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type {
  CardMatchTest,
  useCardBalanceDraft,
} from "@/hooks/kessen/useCardBalanceDraft";
import {
  BandMeter,
  FlagList,
  LIMIT_BAND,
  StatusMark,
  signed,
  statusOf,
} from "@/layout/kessen/balance/BalanceParts";
import Link from "@/layout/Link";
import {
  KESSEN_BALANCE,
  type KessenBalanceFlag,
  type KessenSubjectFlag,
  points,
} from "@/libs/kessen/balance";
import {
  type KessenGauntletSummary,
  type KessenTrialSummary,
  percent,
  trialReference,
} from "@/libs/kessen/balanceSim";
import { KESSEN_FACTION_NAMES } from "@/libs/kessen/packs";
import type { KessenCard } from "@/libs/kessen/types";

type Draft = ReturnType<typeof useCardBalanceDraft>;

/** Anchor of the full balance panel, which the summary links to. */
export const CARD_BALANCE_PANEL_ID = "card-balance";

/**
 * The draft's balance at a glance, for the card preview column: its status, its curve
 * gap and how many guidelines it breaks, updated on every edit.
 */
export function CardBalanceSummary({ draft }: { draft: Draft }) {
  const analysis = draft.analysis;
  if (!analysis) {
    return (
      <p className="text-muted-foreground text-sm">
        Balance checks appear once the card data is valid.
      </p>
    );
  }
  const flags = [
    ...analysis.entry.flags,
    ...analysis.elsewhere.raised.map((e) => e.flag),
  ];
  const breaks = flags.filter((flag) => flag.severity === "break").length;
  const warnings = flags.length - breaks;
  const status = statusOf(flags);
  const { gap } = analysis.entry;
  const tolerance = KESSEN_BALANCE.curveTolerance / 1000;
  return (
    <a
      href={`#${CARD_BALANCE_PANEL_ID}`}
      className="hover:bg-muted/50 grid gap-1 rounded-md border p-2 text-sm"
    >
      <span className="font-semibold">Balance</span>
      <StatusMark
        status={status}
        label={
          status === "ok"
            ? "In guidelines"
            : [
                breaks > 0 ? `${breaks} break${breaks === 1 ? "" : "s"}` : null,
                warnings > 0 ? `${warnings} warning${warnings === 1 ? "" : "s"}` : null,
              ]
                .filter(Boolean)
                .join(", ")
        }
      />
      {gap !== null ? (
        <>
          <span>
            Curve <span className="font-semibold">{signed(gap / 1000)}</span>
          </span>
          <BandMeter
            value={gap / 1000}
            domain={[-4, 4]}
            bands={[{ from: -tolerance, to: tolerance, className: LIMIT_BAND }]}
            status={statusOf(analysis.entry.flags.filter((f) => f.rule === "curve"))}
            label={`Curve gap ${signed(gap / 1000)}; limit ±${tolerance}`}
          />
        </>
      ) : null}
    </a>
  );
}

/**
 * The draft against every guideline: its checks, what saving records in the change log,
 * the flags it raises or clears elsewhere, and a seeded match test of saved against draft.
 */
export function CardBalancePanel({
  draft,
  test,
  onTest,
  canTest,
}: {
  draft: Draft;
  test: CardMatchTest;
  onTest: () => void;
  canTest: boolean;
}) {
  const analysis = draft.analysis;
  const draftKey = draft.draftCard ? JSON.stringify(draft.draftCard) : null;
  const isStale = test.status === "done" && test.draftKey !== draftKey;
  return (
    <section
      id={CARD_BALANCE_PANEL_ID}
      aria-labelledby="card-balance-heading"
      className="@container mt-3 scroll-mt-16 rounded-md border p-2"
    >
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
        <h3 id="card-balance-heading" className="text-lg font-semibold">
          Balance
        </h3>
        <Link href="/manual/kessen/balance" className="text-sm font-semibold underline">
          Balance report
        </Link>
      </div>
      {!analysis || !draft.draftCard ? (
        <p className="text-muted-foreground text-sm">
          The checks appear once the card data is valid.
        </p>
      ) : (
        <div className="grid gap-3 @min-[560px]:grid-cols-2">
          <div className="grid content-start gap-3">
            <Checks
              card={draft.draftCard}
              flags={analysis.entry.flags}
              value={analysis.entry.value}
              target={analysis.entry.target}
            />
            <ChangeLog lines={analysis.changes} />
            <Elsewhere
              raised={analysis.elsewhere.raised}
              cleared={analysis.elsewhere.cleared}
            />
          </div>
          <MatchTest
            card={draft.draftCard}
            test={test}
            isStale={isStale}
            canTest={canTest}
            onTest={onTest}
          />
        </div>
      )}
    </section>
  );
}

function Checks({
  card,
  flags,
  value,
  target,
}: {
  card: KessenCard;
  flags: KessenBalanceFlag[];
  value: number | null;
  target: number | null;
}) {
  return (
    <div className="grid gap-1 text-sm">
      <p className="font-semibold">Guidelines</p>
      {value !== null && target !== null ? (
        <p>
          Value {points(value)} against a target of {points(target)}: provision{" "}
          {card.provision} plus the {card.rarity.toLowerCase()} premium (limit ±
          {points(KESSEN_BALANCE.curveTolerance)}).
        </p>
      ) : (
        <p className="text-muted-foreground">
          {card.kind === "LEADER"
            ? "Leaders are measured by their match trial, not the value curve."
            : card.variant === "FORBIDDEN"
              ? "Forbidden variants keep their base card's numbers."
              : "Infiltrators are measured by their match trial, not the value curve."}
        </p>
      )}
      {!card.isCollectible ? (
        <p className="text-muted-foreground">
          Not collectible: the guidelines cover only cards players can own.
        </p>
      ) : flags.length > 0 ? (
        <FlagList flags={flags} />
      ) : (
        <StatusMark status="ok" label="Inside every guideline" />
      )}
    </div>
  );
}

function ChangeLog({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="grid gap-1 text-sm">
      <p className="font-semibold">Saving records</p>
      <ul className="list-disc pl-5">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="text-muted-foreground">
        These lines join the change log and the content Discord post.
      </p>
    </div>
  );
}

function Elsewhere({
  raised,
  cleared,
}: {
  raised: KessenSubjectFlag[];
  cleared: KessenSubjectFlag[];
}) {
  if (raised.length === 0 && cleared.length === 0) return null;
  return (
    <div className="grid gap-1 text-sm">
      <p className="font-semibold">Effect on other content</p>
      <ul className="grid gap-0.5">
        {raised.map((entry) => (
          <li key={`r:${entry.subject}:${entry.flag.message}`} className="flex gap-1">
            <StatusMark status={entry.flag.severity} className="mt-px" />
            <span>
              <span className="font-semibold">{entry.subject}</span>:{" "}
              {entry.flag.message}
            </span>
          </li>
        ))}
        {cleared.map((entry) => (
          <li key={`c:${entry.subject}:${entry.flag.message}`} className="flex gap-1">
            <StatusMark status="ok" className="mt-px" />
            <span>
              <span className="font-semibold">{entry.subject}</span> no longer:{" "}
              {entry.flag.message}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MatchTest({
  card,
  test,
  isStale,
  canTest,
  onTest,
}: {
  card: KessenCard;
  test: CardMatchTest;
  isStale: boolean;
  canTest: boolean;
  onTest: () => void;
}) {
  const running = test.status === "running";
  return (
    <div className="grid content-start gap-2 text-sm">
      <p className="font-semibold">Test in matches</p>
      <p className="text-muted-foreground">
        Plays the saved and edited card on the same seeds
        {card.kind === "LEADER"
          ? ", leading its faction's starter deck against a leader without abilities, with the same faction passive"
          : `, in its faction's starter deck against a vanilla ${trialReference(card).power}-power unit`}
        , and the faction gauntlet when a reference deck holds it.
      </p>
      <Button
        type="button"
        variant="outline"
        className="justify-self-start"
        disabled={!canTest || running}
        onClick={onTest}
      >
        <FlaskConical className="mr-2 h-4 w-4" aria-hidden />
        {test.status === "idle" ? "Test in matches" : "Test again"}
      </Button>
      {running ? (
        <div className="grid gap-1" aria-live="polite">
          <span>Playing matches…</span>
          <Progress
            value={test.total > 0 ? (100 * test.done) / test.total : 0}
            aria-label="Match test progress"
          />
        </div>
      ) : null}
      {test.status === "error" ? (
        <p role="alert" className="text-red-600 dark:text-red-500">
          The test stopped: {test.error}
        </p>
      ) : null}
      {test.status === "done" ? (
        <div className="grid gap-2">
          {isStale ? (
            <p className="text-amber-600 dark:text-amber-400">
              The card changed since this test; test again for the current numbers.
            </p>
          ) : null}
          {test.trial ? <TrialResult trial={test.trial} /> : null}
          {test.gauntlet ? (
            <GauntletResult card={card} gauntlet={test.gauntlet} />
          ) : (
            <p className="text-muted-foreground">
              No reference deck holds this card, so the faction gauntlet is unchanged.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function TrialResult({
  trial,
}: {
  trial: { saved: KessenTrialSummary | null; draft: KessenTrialSummary | null };
}) {
  const row = (label: string, entry: KessenTrialSummary | null) =>
    entry ? (
      <p key={label} className="flex flex-wrap items-center gap-x-1.5">
        <span className="text-muted-foreground w-12">{label}</span>
        <span className="font-semibold">{signed(entry.edge)}</span>
        <span className="text-muted-foreground">
          ± {(2 * entry.se).toFixed(0)} points
        </span>
        <StatusMark status={statusOf(entry.flags)} />
      </p>
    ) : null;
  return (
    <div className="grid gap-0.5">
      <p>Match trial edge</p>
      {row("Saved", trial.saved)}
      {row("Edited", trial.draft)}
      {trial.draft ? <FlagList flags={trial.draft.flags} /> : null}
    </div>
  );
}

function GauntletResult({
  card,
  gauntlet,
}: {
  card: KessenCard;
  gauntlet: { saved: KessenGauntletSummary; draft: KessenGauntletSummary };
}) {
  const shown = gauntlet.draft.factions.filter(
    (entry) =>
      card.faction === "NEUTRAL" ||
      entry.faction === card.faction ||
      entry.flags.length > 0,
  );
  const flags = [
    ...gauntlet.draft.factions.flatMap((entry) => entry.flags),
    ...gauntlet.draft.health.flags,
  ];
  return (
    <div className="grid gap-0.5">
      <p>Faction gauntlet win rate, saved → edited</p>
      <ul className="grid gap-0.5">
        {shown.map((entry) => {
          const before = gauntlet.saved.factions.find(
            (f) => f.faction === entry.faction,
          );
          return (
            <li key={entry.faction} className="flex flex-wrap gap-x-1.5">
              <span className="w-20">{KESSEN_FACTION_NAMES[entry.faction]}</span>
              <span>
                {before ? percent(before.rate.score) : "—"} →{" "}
                <span className="font-semibold">{percent(entry.rate.score)}</span>
              </span>
              <StatusMark status={statusOf(entry.flags)} />
            </li>
          );
        })}
      </ul>
      <FlagList flags={flags} />
    </div>
  );
}
