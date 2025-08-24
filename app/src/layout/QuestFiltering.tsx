import {
  ContentFiltering,
  useContentFiltering,
  buildFilter,
  defineFilteringSchema,
  toOptions,
} from "@/layout/ContentFiltering";
import { useUserData } from "@/utils/UserContext";
import { canChangeContent } from "@/utils/permissions";
import { QuestTypes, LetterRanks } from "@/drizzle/constants";
import { allObjectiveTasks } from "@/validators/objectives";

interface QuestFilteringProps {
  state: QuestFilteringState;
}

const makeSchema = () =>
  defineFilteringSchema({
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
      {
        id: "hidden",
        label: "Visibility",
        type: "tri-state",
        defaultValue: undefined,
        visibleIf: (ctx) =>
          Boolean(
            (ctx as { canChangeContent?: boolean } | undefined)?.canChangeContent,
          ),
        triStateLabels: {
          labelActive: "Hidden",
          labelInactive: "Visible",
          labelAll: "All Visibility",
        },
      },
    ] as const,
  });

const QuestFiltering: React.FC<QuestFilteringProps> = (props) => {
  const { data: userData } = useUserData();
  const context = {
    canChangeContent: Boolean(userData && canChangeContent(userData.role)),
  };
  return (
    <ContentFiltering
      schema={makeSchema()}
      state={props.state.cf}
      context={context}
      triggerButtonId="filter-quests"
    />
  );
};

export default QuestFiltering;

export const getFilter = (state: QuestFilteringState) =>
  buildFilter(state.cf, makeSchema());

export const useFiltering = () => {
  const cf = useContentFiltering(makeSchema());
  return {
    ...cf.values,
    cf,
    setName: cf.setters.name,
    setObjectives: cf.setters.objectives,
    setQuestType: cf.setters.questType,
    setRank: cf.setters.rank,
    setUserLevel: cf.setters.userLevel,
    setVillage: cf.setters.village,
    setBloodline: cf.setters.bloodline,
    setHidden: cf.setters.hidden,
  };
};

export type QuestFilteringState = ReturnType<typeof useFiltering>;
