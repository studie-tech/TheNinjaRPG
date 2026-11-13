import {
  buildFilter,
  ContentFiltering,
  type ContentFilteringOptions,
  defineFilteringSchema,
  useContentFiltering,
} from "@/layout/ContentFiltering";
import { canSeeIps } from "@/utils/permissions";
import { useUserDataSelector } from "@/utils/UserContext";
import { tagTypes } from "@/validators/combat";

interface UserFilteringProps {
  state: UserFilteringState;
  aiToggles?: boolean;
  showEffects?: boolean;
}

// Single-source schema
const USER_FILTERING_SCHEMA = defineFilteringSchema({
  fields: [
    {
      id: "username",
      label: "Username",
      type: "text",
      defaultValue: "",
      filterKey: "username",
    },
    {
      id: "ip",
      label: "Last IP",
      type: "text",
      defaultValue: "",
      filterKey: "ip",
      visibleIf: (ctx) =>
        Boolean((ctx as { canSeeIps?: boolean } | undefined)?.canSeeIps),
    },
    {
      id: "bloodline",
      label: "Bloodline",
      type: "single-select",
      defaultValue: "None",
      includeNone: true,
      emptyValues: ["None"],
      dataSource: "bloodlines",
    },
    {
      id: "village",
      label: "Village",
      type: "single-select",
      defaultValue: "None",
      includeNone: true,
      emptyValues: ["None"],
      dataSource: "villages",
    },
    {
      id: "effect",
      label: "Effects",
      type: "multi-select",
      defaultValue: [],
      options: tagTypes.map((ef) => ({ value: ef, label: ef })),
      visibleIf: (ctx) =>
        Boolean((ctx as { showEffects?: boolean } | undefined)?.showEffects),
    },
    {
      id: "isEvent",
      label: "Event Status",
      type: "tri-state",
      defaultValue: undefined,
      triStateLabels: {
        labelActive: "Event Only",
        labelInactive: "Non-Event Only",
        labelAll: "All Events",
      },
      visibleIf: (ctx) =>
        Boolean((ctx as { aiToggles?: boolean } | undefined)?.aiToggles),
    },
    {
      id: "isWarCamp",
      label: "War Camp Status",
      type: "tri-state",
      defaultValue: undefined,
      triStateLabels: {
        labelActive: "War Camp Only",
        labelInactive: "Non-War Camp Only",
        labelAll: "All War Camps",
      },
      visibleIf: (ctx) =>
        Boolean((ctx as { aiToggles?: boolean } | undefined)?.aiToggles),
    },
    {
      id: "isSummon",
      label: "Summon Status",
      type: "tri-state",
      defaultValue: undefined,
      triStateLabels: {
        labelActive: "Summon Only",
        labelInactive: "Non-Summon Only",
        labelAll: "All Summons",
      },
      visibleIf: (ctx) =>
        Boolean((ctx as { aiToggles?: boolean } | undefined)?.aiToggles),
    },
    {
      id: "inArena",
      label: "Arena Status",
      type: "tri-state",
      defaultValue: undefined,
      triStateLabels: {
        labelActive: "Arena Only",
        labelInactive: "Non-Arena Only",
        labelAll: "All Arena",
      },
      visibleIf: (ctx) =>
        Boolean((ctx as { aiToggles?: boolean } | undefined)?.aiToggles),
    },
    {
      id: "inShrines",
      label: "Shrine Status",
      type: "tri-state",
      defaultValue: undefined,
      triStateLabels: {
        labelActive: "Shrine Only",
        labelInactive: "Non-Shrine Only",
        labelAll: "All Shrines",
      },
      visibleIf: (ctx) =>
        Boolean((ctx as { aiToggles?: boolean } | undefined)?.aiToggles),
    },
  ] as const,
});

const UserFiltering: React.FC<UserFilteringProps> = (props) => {
  const { data: userData } = useUserDataSelector((u) => ({ role: u.role }));
  const context = {
    canSeeIps: Boolean(userData && canSeeIps(userData.role)),
    aiToggles: props.aiToggles,
    showEffects: props.showEffects,
  };
  return (
    <ContentFiltering
      schema={USER_FILTERING_SCHEMA}
      state={props.state.cf}
      context={context}
      triggerButtonId="filter-user"
    />
  );
};

export default UserFiltering;

/** tRPC filter for api.profile.getPublicUsers */
export const getFilter = (state: UserFilteringState) =>
  buildFilter(state.cf, USER_FILTERING_SCHEMA);

/** State for the User Filtering component */
export const useFiltering = (options?: ContentFilteringOptions) => {
  const cf = useContentFiltering(USER_FILTERING_SCHEMA, options);
  return {
    ...cf.values,
    cf,
    setEffect: cf.setters.effect,
  };
};

/** State type */
export type UserFilteringState = ReturnType<typeof useFiltering>;
