import { useUserData } from "@/utils/UserContext";
import { canSeeIps } from "@/utils/permissions";
import {
  ContentFiltering,
  useContentFiltering,
  buildFilter,
  defineFilteringSchema,
} from "@/layout/ContentFiltering";
import { effectFilters } from "@/validators/combat";

interface UserFilteringProps {
  state: UserFilteringState;
  aiToggles?: boolean;
  showEffects?: boolean;
}

// Single-source schema
const makeUserFilteringSchema = () =>
  defineFilteringSchema({
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
        options: (effectFilters ?? []).map((ef) => ({ value: ef, label: ef })),
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
  const { data: userData } = useUserData();
  const context = {
    canSeeIps: Boolean(userData && canSeeIps(userData.role)),
    aiToggles: props.aiToggles,
    showEffects: props.showEffects,
  };
  return (
    <ContentFiltering
      schema={makeUserFilteringSchema()}
      state={props.state.cf}
      context={context}
      triggerButtonId="filter-user"
    />
  );
};

export default UserFiltering;

/** tRPC filter to be used on api.jutsu.getAll */
export const getFilter = (state: UserFilteringState) =>
  buildFilter(state.cf, makeUserFilteringSchema());

/** State for the User Filtering component */
export const useFiltering = () => {
  const cf = useContentFiltering(makeUserFilteringSchema());
  return {
    ...cf.values,
    cf,
    setUsername: cf.setters.username,
    setIp: cf.setters.ip,
    setBloodline: cf.setters.bloodline,
    setVillage: cf.setters.village,
    setEffect: cf.setters.effect,
    setIsEvent: cf.setters.isEvent,
    setIsSummon: cf.setters.isSummon,
    setInArena: cf.setters.inArena,
    setInShrines: cf.setters.inShrines,
  };
};

/** State type */
export type UserFilteringState = ReturnType<typeof useFiltering>;
