import {
  battleTypesField,
  buildFilter,
  ContentFiltering,
  defineFilteringSchema,
  minCountField,
  useContentFiltering,
} from "@/layout/ContentFiltering";
import { tagTypes } from "@/validators/combat";

interface JutsuBalanceFilteringProps {
  state: JutsuBalanceFilteringState;
}

/** Define the jutsu balance filters and their initial battle sample. */
const makeSchema = () =>
  defineFilteringSchema({
    fields: [
      battleTypesField(["RANKED_PVP", "COMBAT", "RANKED_SPARRING", "SPARRING"]),
      minCountField,
      {
        id: "jutsuEffects",
        label: "Jutsu Effects",
        type: "multi-select",
        defaultValue: [],
        options: tagTypes.map((e) => ({ value: e, label: e })),
      },
      {
        id: "bloodlineIds",
        label: "Bloodlines",
        type: "multi-select",
        defaultValue: [],
        dataSource: "bloodlines",
      },
    ] as const,
  });

const JutsuBalanceFiltering: React.FC<JutsuBalanceFilteringProps> = (props) => {
  return (
    <ContentFiltering
      schema={makeSchema()}
      state={props.state.cf}
      triggerButtonId="filter-jutsu-balance"
    />
  );
};

export default JutsuBalanceFiltering;

export const getFilter = (state: JutsuBalanceFilteringState) =>
  buildFilter(state.cf, makeSchema());

export const useFiltering = () => {
  const cf = useContentFiltering(makeSchema());
  return {
    ...cf.values,
    cf,
  };
};

export type JutsuBalanceFilteringState = ReturnType<typeof useFiltering>;
