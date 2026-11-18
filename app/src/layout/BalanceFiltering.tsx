import { MAX_PLAYER_LEVEL, type UserRank, UserRanks } from "@/drizzle/constants";
import {
  battleTypesField,
  buildFilter,
  ContentFiltering,
  defineFilteringSchema,
  toOptions,
  useContentFiltering,
} from "@/layout/ContentFiltering";
import Link from "@/layout/Link";
import { balanceUsageFilterSchema } from "@/validators/balance";

/** Player demographics refer to the account at battle initiation, before combat scaling. */
export const balanceDemographicFields = [
  {
    id: "userRanks",
    label: "Player ranks",
    type: "multi-select",
    defaultValue: [] as UserRank[],
    options: toOptions(UserRanks),
  },
  {
    id: "minLevel",
    label: "Minimum player level",
    type: "number",
    defaultValue: undefined,
    min: 1,
    max: MAX_PLAYER_LEVEL,
  },
  {
    id: "maxLevel",
    label: "Maximum player level",
    type: "number",
    defaultValue: undefined,
    min: 1,
    max: MAX_PLAYER_LEVEL,
  },
] as const;

const schema = defineFilteringSchema({
  fields: [
    battleTypesField(["RANKED_PVP", "COMBAT", "RANKED_SPARRING", "SPARRING"]),
    ...balanceDemographicFields,
  ] as const,
});

/** Use the same battle and progression filters across the overview's content and turn-order reports. */
export const useBalanceFiltering = () =>
  useContentFiltering(schema, { persistKey: "balance-overview" });

/** Build the overview's typed query input from the shared filter controls. */
export const getBalanceFilter = (state: ReturnType<typeof useBalanceFiltering>) =>
  buildFilter(state, schema);

/** Render the overview filter dialog using the manual's established controls. */
export const BalanceFiltering = ({
  state,
}: {
  state: ReturnType<typeof useBalanceFiltering>;
}) => (
  <ContentFiltering
    schema={schema}
    state={state}
    triggerButtonId="filter-balance-overview"
  />
);

/** Identify an inverted player-level range before requesting a report. */
export const hasInvalidBalanceLevelRange = (filter: {
  minLevel?: number;
  maxLevel?: number;
}) =>
  filter.minLevel !== undefined &&
  filter.maxLevel !== undefined &&
  filter.minLevel > filter.maxLevel;

/** Explain battle sample filters alongside the independently counted current loadouts. */
export const BalanceUsageNote = ({ invalidRange }: { invalidRange: boolean }) => (
  <div className="px-3 pb-3 text-sm">
    <p>
      Battle usage covers the current 14-day UTC reporting period. Player level and rank
      are captured before combat scaling; these filters affect battle usage only.
      Equipped and user totals describe current accounts across all levels and ranks.
      Completed periods can be downloaded from the{" "}
      <Link href="/manual/balance" className="underline">
        balance overview
      </Link>
      .
    </p>
    {invalidRange && (
      <p role="alert" className="text-destructive mt-2">
        Minimum player level must not exceed maximum player level. Adjust the filters to
        continue.
      </p>
    )}
  </div>
);

/** Carry the overview sample into a usage report without changing its tab fragment. */
export const getBalanceUsageHref = (
  type: "jutsu" | "bloodline" | "item",
  filter: ReturnType<typeof getBalanceFilter>,
) => {
  const params = new URLSearchParams({ balanceFilter: JSON.stringify(filter) });
  return `/manual/${type}/balance?${params}#Usage`;
};

/** Restore only the shared sample fields, leaving content-specific filters intact. */
export const readBalanceUsageFilter = () => {
  const raw = new URLSearchParams(window.location.search).get("balanceFilter");
  if (!raw) return {};
  try {
    const parsed = balanceUsageFilterSchema.parse(JSON.parse(raw));
    return {
      battleTypes: parsed.battleTypes ?? [],
      userRanks: parsed.userRanks ?? [],
      minLevel: parsed.minLevel,
      maxLevel: parsed.maxLevel,
    };
  } catch {
    return {};
  }
};
