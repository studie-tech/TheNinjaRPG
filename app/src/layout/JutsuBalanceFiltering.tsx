import { api } from "@/app/_trpc/client";
import { BattleTypes } from "@/drizzle/constants";
import {
  buildFilter,
  ContentFiltering,
  defineFilteringSchema,
  toOptions,
  useContentFiltering,
} from "@/layout/ContentFiltering";
import { effectFilters } from "@/validators/combat";

interface JutsuBalanceFilteringProps {
  state: JutsuBalanceFilteringState;
}

const makeSchema = (bloodlines: { id: string; name: string }[]) =>
  defineFilteringSchema({
    fields: [
      {
        id: "battleTypes",
        label: "Battle Types",
        type: "multi-select",
        defaultValue: ["RANKED_PVP", "COMBAT", "RANKED_SPARRING", "SPARRING"],
        options: toOptions(BattleTypes),
      },
      {
        id: "minCount",
        label: "Minimum Count",
        type: "number",
        defaultValue: undefined,
        normalizeForFilter: (v) => (v !== undefined && v >= 1 ? v : undefined),
      },
      {
        id: "jutsuEffects",
        label: "Jutsu Effects",
        type: "multi-select",
        defaultValue: [],
        options: effectFilters.map((e) => ({ value: e, label: e })),
      },
      {
        id: "bloodlineIds",
        label: "Bloodlines",
        type: "multi-select",
        defaultValue: [],
        options: bloodlines.map((b) => ({ value: b.id, label: b.name })),
      },
    ] as const,
  });

const JutsuBalanceFiltering: React.FC<JutsuBalanceFilteringProps> = (props) => {
  const { data: bloodlines } = api.bloodline.getAllNames.useQuery(undefined);
  const bl = bloodlines ?? [];
  const schema = makeSchema(bl);
  return (
    <ContentFiltering
      schema={schema}
      state={props.state.cf}
      triggerButtonId="filter-jutsu-balance"
    />
  );
};

export default JutsuBalanceFiltering;

export const getFilter = (state: JutsuBalanceFilteringState) =>
  buildFilter(state.cf, makeSchema([]));

export const useFiltering = () => {
  const { data: bloodlines } = api.bloodline.getAllNames.useQuery(undefined);
  const bl = bloodlines ?? [];
  const cf = useContentFiltering(makeSchema(bl));
  return {
    ...cf.values,
    cf,
    setBattleTypes: cf.setters.battleTypes,
    setMinCount: cf.setters.minCount,
    setJutsuEffects: cf.setters.jutsuEffects,
    setBloodlineIds: cf.setters.bloodlineIds,
  };
};

export type JutsuBalanceFilteringState = ReturnType<typeof useFiltering>;
