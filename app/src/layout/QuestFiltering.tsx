import { LetterRanks, QuestTypes, RESTRICTED_QUEST_TYPES } from "@/drizzle/constants";
import {
  buildFilter,
  type ContentEditContext,
  ContentFiltering,
  type ContentFilteringOptions,
  defineFilteringSchema,
  hiddenVisibilityField,
  toOptions,
  useContentEditContext,
  useContentFiltering,
} from "@/layout/ContentFiltering";
import { allObjectiveTasks } from "@/validators/objectives";
import { QUEST_FILTER_MAX_LEVEL } from "@/validators/quest";

interface QuestFilteringProps {
  state: QuestFilteringState;
}

export const QUEST_FILTERING_SCHEMA = defineFilteringSchema({
  fields: [
    { id: "name", label: "Name", type: "text", defaultValue: "" },
    {
      id: "objectives",
      label: "Objectives",
      type: "multi-select",
      defaultValue: [],
      options: toOptions(allObjectiveTasks),
    },
    {
      id: "questType",
      label: "Type",
      type: "single-select",
      defaultValue: "ALL",
      includeNone: true,
      emptyValues: ["ALL"],
      options: toOptions(QuestTypes),
      // Types with dedicated acquisition flows are redacted from player listings, so these
      // only ever produce an empty result.
      filterOptions: (opts, ctx) =>
        (ctx as ContentEditContext | undefined)?.canEdit
          ? opts
          : opts.filter(
              (o) => !(RESTRICTED_QUEST_TYPES as readonly string[]).includes(o.value),
            ),
      noneOption: { value: "ALL", label: "None" },
    },
    {
      id: "rank",
      label: "Quest Rank",
      type: "single-select",
      defaultValue: "NONE",
      includeNone: true,
      emptyValues: ["NONE"],
      options: toOptions(LetterRanks),
      noneOption: { value: "NONE", label: "None" },
    },
    {
      id: "userLevel",
      label: "User Level",
      type: "number",
      defaultValue: undefined,
      max: QUEST_FILTER_MAX_LEVEL,
    },
    {
      id: "village",
      label: "Village",
      type: "single-select",
      defaultValue: "None",
      includeNone: true,
      emptyValues: ["None"],
      dataSource: "villages",
      filterOptions: (opts) => opts.sort((a, b) => a.label.localeCompare(b.label)),
    },
    {
      id: "bloodline",
      label: "Bloodline",
      type: "single-select",
      defaultValue: "None",
      includeNone: true,
      emptyValues: ["None"],
      dataSource: "bloodlines",
      filterOptions: (opts) => opts.sort((a, b) => a.label.localeCompare(b.label)),
    },
    hiddenVisibilityField(),
  ] as const,
});

const QuestFiltering: React.FC<QuestFilteringProps> = (props) => {
  const context = useContentEditContext();
  return (
    <ContentFiltering
      schema={QUEST_FILTERING_SCHEMA}
      state={props.state.cf}
      context={context}
      triggerButtonId="filter-quests"
    />
  );
};

export default QuestFiltering;

export const getFilter = (state: QuestFilteringState) =>
  buildFilter(state.cf, QUEST_FILTERING_SCHEMA);

export const useFiltering = (options?: ContentFilteringOptions) => {
  const cf = useContentFiltering(QUEST_FILTERING_SCHEMA, options);
  return {
    ...cf.values,
    cf,
  };
};

export type QuestFilteringState = ReturnType<typeof useFiltering>;
