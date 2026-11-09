"use client";

import { sentenceCase as label } from "change-case";
import { useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput, validateNumberInputs } from "@/components/ui/number-input";
import { Textarea } from "@/components/ui/textarea";
import {
  EVENT_TOURNAMENT_MAX_CAPACITY,
  EVENT_TOURNAMENT_MIN_CAPACITY,
  MAX_PVP_BRACKET,
} from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import { RewardFormWrapper } from "@/layout/RewardEditor";
import { showMutationToast } from "@/libs/toast";
import { DAY_S, formatLocalDateTimeInput } from "@/utils/time";
import { ObjectiveReward } from "@/validators/rewards";
import {
  EVENT_TOURNAMENT_SERIES_LENGTHS,
  type EventTournamentConfig,
  type EventTournamentSeriesLength,
  eventTournamentConfigSchema,
} from "@/validators/tournament";

/** Edit a draft with the shared configuration and quest-reward validators before saving. */
export const EventTournamentEditor = ({
  initial,
  tournamentId,
  onSaved,
}: {
  initial?: EventTournamentConfig;
  tournamentId?: string;
  onSaved: () => void;
}) => {
  const [config, setConfig] = useState<EventTournamentConfig>(
    initial ?? defaultConfig(),
  );
  const [message, setMessage] = useState("");
  const formRef = useRef<HTMLDivElement>(null);
  const mutation = api.tournament.saveEvent.useMutation({
    onSuccess: (result) => {
      showMutationToast(result);
      setMessage(result.message);
      if (result.success) onSaved();
    },
  });
  const update = <K extends keyof EventTournamentConfig>(
    key: K,
    value: EventTournamentConfig[K],
  ) => setConfig((current) => ({ ...current, [key]: value }));
  const save = (container: HTMLElement | null) => {
    if (!validateNumberInputs(container)) return;
    const parsed = eventTournamentConfigSchema.safeParse(config);
    if (!parsed.success) {
      setMessage(
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(". "),
      );
      return;
    }
    mutation.mutate({ tournamentId, config: parsed.data });
  };
  const rewardKeys = [
    "winner",
    "runnerUp",
    "semifinalist",
    "participation",
    "perWin",
  ] as const;
  const rewards = rewardKeys.map((key) => config.rewards[key]);
  return (
    <ContentBox
      title={tournamentId ? "Edit tournament draft" : "Create tournament"}
      defaultBackHref="/manual/tournaments"
    >
      <div ref={formRef} className="space-y-4">
        <label htmlFor="event-name" className="block space-y-1">
          Name
          <Input
            id="event-name"
            value={config.name}
            onChange={(e) => update("name", e.target.value)}
          />
        </label>
        <label htmlFor="event-description" className="block space-y-1">
          Description
          <Textarea
            id="event-description"
            value={config.description}
            onChange={(e) => update("description", e.target.value)}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          {(["registration", "format", "seeding", "rules", "scheduling"] as const).map(
            (key) => (
              <label htmlFor={`event-${key}`} className="space-y-1" key={key}>
                {label(key)}
                <select
                  className="block w-full rounded-md border bg-background p-2"
                  id={`event-${key}`}
                  value={config[key]}
                  onChange={(e) => update(key, e.target.value as never)}
                >
                  {eventTournamentConfigSchema.shape[key].options.map((value) => (
                    <option key={value} value={value}>
                      {label(value)}
                    </option>
                  ))}
                </select>
              </label>
            ),
          )}
          <label htmlFor="event-capacity" className="space-y-1">
            Capacity ({EVENT_TOURNAMENT_MIN_CAPACITY}–{EVENT_TOURNAMENT_MAX_CAPACITY})
            <NumberInput
              id="event-capacity"
              min={EVENT_TOURNAMENT_MIN_CAPACITY}
              max={EVENT_TOURNAMENT_MAX_CAPACITY}
              value={config.capacity}
              onValueChange={(value) => update("capacity", value)}
            />
          </label>
          <label className="space-y-1">
            Default games per series
            <select
              className="block w-full rounded-md border bg-background p-2"
              value={config.bestOf}
              onChange={(e) =>
                update("bestOf", Number(e.target.value) as EventTournamentSeriesLength)
              }
            >
              {EVENT_TOURNAMENT_SERIES_LENGTHS.map((n) => (
                <option value={n} key={n}>
                  Best of {n}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="event-round-overrides" className="space-y-1">
            Round overrides (comma-separated 1, 3 or 5)
            <Input
              id="event-round-overrides"
              defaultValue={config.roundBestOf.join(", ")}
              onChange={(e) =>
                update(
                  "roundBestOf",
                  e.target.value.trim()
                    ? (e.target.value
                        .split(",")
                        .map(Number) as EventTournamentSeriesLength[])
                    : [],
                )
              }
              placeholder="1, 1, 3, 5"
            />
          </label>
          {(
            [
              "minBracket",
              "maxBracket",
              "minPvpWins",
              "minWinRate",
              "minMasteredJutsu",
            ] as const
          ).map((key) => (
            <label htmlFor={`event-${key}`} className="space-y-1" key={key}>
              {label(key)}
              <NumberInput
                min={0}
                id={`event-${key}`}
                value={config[key]}
                onValueChange={(value) => update(key, value)}
              />
            </label>
          ))}
          {(["registrationClosesAt", "endsAt"] as const).map((key) => (
            <label htmlFor={`event-${key}`} className="space-y-1" key={key}>
              {label(key)}
              <Input
                type="datetime-local"
                id={`event-${key}`}
                value={
                  Number.isFinite(config[key])
                    ? formatLocalDateTimeInput(new Date(config[key]))
                    : ""
                }
                onChange={(e) => update(key, new Date(e.target.value).getTime())}
              />
            </label>
          ))}
        </div>
        <p className="text-muted-foreground text-sm">
          Random seeding is generated once by the server. Ranked seeding orders the
          frozen PvP-win totals, with user ID as a stable tiebreak. Staff may start
          early with at least two accepted players; byes fill empty bracket slots.
        </p>
        {rewardKeys.map((key, idx) => (
          <details className="rounded-lg border p-3" key={key}>
            <summary className="cursor-pointer font-bold">{label(key)} rewards</summary>
            <RewardFormWrapper
              idx={idx}
              reward={config.rewards[key]}
              rewards={rewards}
              setRewards={(next) =>
                update(
                  "rewards",
                  Object.fromEntries(
                    rewardKeys.map((k, i) => [k, next[i] ?? ObjectiveReward.parse({})]),
                  ) as EventTournamentConfig["rewards"],
                )
              }
            />
          </details>
        ))}
        {message && (
          <p role="alert" className="rounded-md border p-3">
            {message}
          </p>
        )}
        <div className="flex gap-2">
          <Button disabled={mutation.isPending} onClick={() => save(formRef.current)}>
            Save draft
          </Button>
          <Button variant="outline" onClick={onSaved}>
            Back
          </Button>
        </div>
      </div>
    </ContentBox>
  );
};

/** Allocate independent draft settings and reward objects for each new editor. */
const defaultConfig = (): EventTournamentConfig => ({
  name: "New Colosseum Tournament",
  description: "A staff-hosted tournament at Wake Island.",
  registration: "OPEN",
  format: "SINGLE_ELIMINATION",
  seeding: "RANDOM",
  rules: "OPEN",
  scheduling: "SIMULTANEOUS",
  capacity: EVENT_TOURNAMENT_MIN_CAPACITY,
  bestOf: 1,
  roundBestOf: [],
  minBracket: 0,
  maxBracket: MAX_PVP_BRACKET,
  minPvpWins: 0,
  minWinRate: 0,
  minMasteredJutsu: 0,
  registrationClosesAt: Date.now() + DAY_S * 1000,
  endsAt: Date.now() + 7 * DAY_S * 1000,
  rewards: {
    winner: ObjectiveReward.parse({}),
    runnerUp: ObjectiveReward.parse({}),
    semifinalist: ObjectiveReward.parse({}),
    participation: ObjectiveReward.parse({}),
    perWin: ObjectiveReward.parse({}),
  },
});
