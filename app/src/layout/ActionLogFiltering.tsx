import type { LogType } from "@/drizzle/constants";
import { LOG_TYPES } from "@/drizzle/constants";
import {
  ContentFiltering,
  defineFilteringSchema,
  toOptions,
  useContentFiltering,
} from "@/layout/ContentFiltering";
import { canSeeSecretData } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";

interface ActionLogFilteringProps {
  state: ActionLogFilteringState;
}

const makeActionLogSchema = () =>
  defineFilteringSchema({
    fields: [
      {
        id: "logtype",
        label: "Type",
        type: "single-select",
        defaultValue: "user",
        includeNone: false,
        emptyValues: [],
        options: toOptions(LOG_TYPES),
      },
      {
        id: "username",
        label: "Performed by",
        type: "text",
        defaultValue: "",
        visibleIf: (ctx) =>
          Boolean((ctx as { canSeeUsernames?: boolean } | undefined)?.canSeeUsernames),
      },
      { id: "search", label: "Search", type: "text", defaultValue: "" },
    ] as const,
  });

const ActionLogFiltering: React.FC<ActionLogFilteringProps> = (props) => {
  const { data: userData } = useUserData();
  const context = {
    canSeeUsernames: Boolean(userData && canSeeSecretData(userData.role)),
  };
  return (
    <ContentFiltering
      schema={makeActionLogSchema()}
      state={props.state.cf}
      context={context}
      triggerButtonId="filter-actionlog"
    />
  );
};

export default ActionLogFiltering;

// Strongly-typed filter payload to satisfy consumers
type ActionLogFilter = {
  logtype: LogType;
  search?: string;
  username?: string;
};

export const getFilter = (state: ActionLogFilteringState): ActionLogFilter => {
  const { debounced } = state.cf;
  return {
    logtype: debounced.logtype,
    search:
      debounced.search && debounced.search.length > 0 ? debounced.search : undefined,
    username:
      debounced.username && debounced.username.length > 0
        ? debounced.username
        : undefined,
  };
};

export const useFiltering = (logType: LogType = "user") => {
  const cf = useContentFiltering(makeActionLogSchema());
  if (!cf.values.logtype) {
    cf.setters.logtype(logType);
  }
  return {
    ...cf.values,
    cf,
    setSearch: cf.setters.search,
    setLogType: cf.setters.logtype,
    setUsername: cf.setters.username,
  };
};

export type ActionLogFilteringState = ReturnType<typeof useFiltering>;
