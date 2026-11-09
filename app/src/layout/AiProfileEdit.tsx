import { FilePlus, Save, SquareArrowDown, SquareArrowUp, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";
import type React from "react";
import { Fragment, useEffect, useState } from "react";
import { api } from "@/app/_trpc/client";
import Toggle from "@/components/control/Toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/ui/multi-select";
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Accordion from "@/layout/Accordion";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import NavTabs from "@/layout/NavTabs";
import { SearchSelect } from "@/layout/SearchSelect";
import { showMutationToast } from "@/libs/toast";
import { getUnique } from "@/utils/grouping";
import { canChangeContent } from "@/utils/permissions";
import { useRequiredUserData } from "@/utils/UserContext";
import type { AiRuleType, ZodAllAiAction, ZodAllAiCondition } from "@/validators/ai";
import {
  ActionMoveTowardsOpponent,
  AiActionTypes,
  AiConditionTypes,
  AvailableActionTargets,
  AvailableEffectTypes,
  AvailableTargets,
  aiCoordinatesSchema,
  enforceExtraRules,
  getActionSchema,
  getBackupRules,
  getConditionSchema,
  updateAiProfileSchema,
} from "@/validators/ai";

interface AiProfileEditProps {
  /** Profile identity and selectable definitions; saved rules can reference missing entries. */
  userData: {
    aiProfileId: string | null;
    userId: string;
    jutsus: { jutsuId: string; jutsu: { name: string } }[];
    items: { itemId: string; item: { name: string } }[];
  };
  hideTitle?: boolean;
  /** Owned names for saved combo references outside the selectable loadout. */
  comboActionNames?: Record<string, string>;
  /** Controlled mode skips profile loading and delegates persistence/pending state to the owner. */
  configuration?: {
    profile: { rules: AiRuleType[]; includeDefaultRules: boolean };
    isSaving: boolean;
    disabled?: boolean;
    onSave: (profile: { rules: AiRuleType[]; includeDefaultRules: boolean }) => void;
  };
  /** Restrict the shared editor to actions supported by the caller's combat actor. */
  availableActionTypes?: readonly ZodAllAiAction["type"][];
  /** Restrict highest-power action filters without changing the shared rule executor. */
  availableActionEffects?: readonly string[];
}

/** Edit an ordinary AI profile or a caller-controlled companion configuration with the same rule UI. */
const AiProfileEdit: React.FC<AiProfileEditProps> = (props) => {
  // User information
  const { data: userData } = useRequiredUserData();

  // State
  const availableTabs = ["Default", "Custom"] as const;
  const [includeDefault, setIncludeDefault] = useState<boolean | undefined>(undefined);
  const [rules, setRules] = useState<AiRuleType[]>([]);
  const [activeElement, setActiveElement] = useState<string>("");
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const aiProfileId = props.userData.aiProfileId || "Default";
  const utils = api.useUtils();
  const isControlled = !!props.configuration;
  const isDefault = !isControlled && aiProfileId === "Default";

  // Check role
  const isStaff = canChangeContent(userData?.role ?? "USER");

  // Data
  const { data: loadedProfile, isPending: isLoadingProfile } =
    api.ai.getAiProfile.useQuery(
      { id: aiProfileId },
      { enabled: !props.configuration },
    );
  const profile = props.configuration?.profile ?? loadedProfile;
  const isPending = !props.configuration && isLoadingProfile;

  // Mutations
  const { mutate: toggleAiProfile, isPending: isToggling } =
    api.ai.toggleAiProfile.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await Promise.all([
            utils.profile.getAi.invalidate(),
            utils.profile.getPublicUser.invalidate(),
          ]);
        }
      },
    });

  const { mutate: updateAiProfile, isPending: isUpdatingProfile } =
    api.ai.updateAiProfile.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await Promise.all([
            utils.ai.getAiProfile.invalidate({ id: aiProfileId }),
            utils.profile.getAi.invalidate(),
            utils.profile.getPublicUser.invalidate(),
          ]);
        }
      },
    });
  const isSaving = props.configuration?.isSaving ?? isUpdatingProfile;
  const canEdit =
    !isSaving && !props.configuration?.disabled && (isStaff || !isDefault);
  // Rules store definition IDs, so multiple owned copies must produce one choice.
  const jutsus = getUnique(props.userData.jutsus, "jutsuId");
  const items = getUnique(props.userData.items, "itemId");

  // Get backup rules
  const backupRules = getBackupRules();

  // Hydrate when switching profiles or receiving a saved profile.
  useEffect(() => {
    if (!profile) return;
    const copyRules = structuredClone(profile.rules);
    if (profile.includeDefaultRules || (!isStaff && !isControlled)) {
      enforceExtraRules(copyRules, getBackupRules());
    }
    setRules(copyRules.map((rule) => ({ ...rule, id: nanoid() })));
    setIncludeDefault(profile.includeDefaultRules);
    setActiveElement("");
    setCollapsedGroups([]);
  }, [profile, isStaff, isControlled]);

  const groups = getUnique(
    rules.flatMap((rule) => (rule.group ? [rule.group] : [])),
    "id",
  );
  const updateGroup = (id: string, field: "name" | "note", value: string) => {
    setRules((previous) =>
      previous.map((rule) =>
        rule.group?.id === id
          ? { ...rule, group: { ...rule.group, [field]: value } }
          : rule,
      ),
    );
  };
  const addRule = (newGroup = false) => {
    const index = rules.findIndex((rule) => rule.id === activeElement);
    const customRuleCount = includeDefault
      ? Math.max(0, rules.length - backupRules.length)
      : rules.length;
    const insertionIndex = index < 0 ? 0 : Math.min(index, customRuleCount);
    const group = newGroup
      ? { id: nanoid(), name: "New group", note: "" }
      : rules[insertionIndex]?.group;
    const id = nanoid();
    setRules((previous) => [
      ...previous.slice(0, insertionIndex),
      { id, group, conditions: [], action: ActionMoveTowardsOpponent.parse({}) },
      ...previous.slice(insertionIndex),
    ]);
    if (group)
      setCollapsedGroups((previous) => previous.filter((value) => value !== group.id));
    setActiveElement(id);
  };

  /** Swap a rule with a neighbour; a move past either end keeps the order. */
  const moveRule = (from: number, to: number) => {
    setRules((prevRules) => {
      if (to < 0 || to >= prevRules.length) return prevRules;
      const newRules = [...prevRules];
      const a = newRules[from];
      const b = newRules[to];
      if (a && b) {
        newRules[from] = b;
        newRules[to] = a;
      }
      return newRules;
    });
  };

  // Convenience method for updating rules
  const updateCondition = (
    ruleIndex: number,
    conditionIdx: number,
    field: string,
    value: string | number,
  ) => {
    setRules((prevRules) =>
      prevRules.map((rule, i) => {
        if (i === ruleIndex) {
          return {
            ...rule,
            conditions: rule.conditions.map((condition, j) => {
              if (j === conditionIdx) {
                return {
                  ...condition,
                  [field]: value,
                };
              }
              return condition;
            }),
          };
        }
        return rule;
      }),
    );
  };

  const updateAction = (
    ruleIndex: number,
    update: (action: ZodAllAiAction) => ZodAllAiAction,
  ) => {
    setRules((previous) =>
      previous.map((rule, index) =>
        index === ruleIndex ? { ...rule, action: update(rule.action) } : rule,
      ),
    );
  };

  // If no profile
  if (isPending) return <Loader explanation="Loading AI Profile" />;
  if (!profile) return <Loader explanation="No AI profiles? Should not get here" />;

  // Render
  return (
    <ContentBox
      title={props.hideTitle ? "" : "AI Profile"}
      subtitle={isDefault ? "Default AI Profile" : "Custom AI Profile"}
      initialBreak={true}
      padding={false}
      topRightContent={
        props.configuration ? undefined : isToggling ? (
          <Loader explanation="Toggling AI Profile" />
        ) : (
          <NavTabs
            id="profileSelection"
            current={isDefault ? "Default" : "Custom"}
            options={availableTabs}
            onChange={() => {
              toggleAiProfile({ aiId: props.userData.userId });
            }}
          />
        )
      }
    >
      {rules.map((rule, ruleIndex) => {
        // With includeDefault, enforceExtraRules keeps the backup rules last and locked.
        const isBackupRule = ruleIndex >= rules.length - backupRules.length;
        const cannotMoveDown = ruleIndex >= rules.length - backupRules.length - 1;
        const ruleKey = rule.id ?? `rule-${ruleIndex}`;
        const group = rule.group;
        const beginsGroup = group && rules[ruleIndex - 1]?.group?.id !== group.id;
        const isCollapsed = !!group && collapsedGroups.includes(group.id);
        return (
          <Fragment key={ruleKey}>
            {beginsGroup && (
              <RuleGroupHeader
                group={group}
                isCollapsed={isCollapsed}
                canEdit={canEdit}
                setCollapsedGroups={setCollapsedGroups}
                setRules={setRules}
                updateGroup={updateGroup}
              />
            )}
            <div hidden={isCollapsed}>
              <Accordion
                selectionKey={ruleKey}
                collapsible
                className={includeDefault && isBackupRule ? "opacity-50" : ""}
                title={`Rule ${ruleIndex + 1}`}
                titlePostfix={`: ${rule.conditions.map((c) => c.type).join(", ")} -> ${rule.action.type}`}
                selectedTitle={activeElement}
                onClick={setActiveElement}
                options={
                  <span className="flex">
                    {canEdit && (!includeDefault || !isBackupRule) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Move rule up"
                        className="h-6 w-6 hover:cursor-pointer hover:text-orange-500"
                        onClick={() => moveRule(ruleIndex, ruleIndex - 1)}
                      >
                        <SquareArrowUp className="h-6 w-6" />
                      </Button>
                    )}
                    {canEdit && (!includeDefault || !cannotMoveDown) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Move rule down"
                        className="h-6 w-6 hover:cursor-pointer hover:text-orange-500"
                        onClick={() => moveRule(ruleIndex, ruleIndex + 1)}
                      >
                        <SquareArrowDown className="h-6 w-6" />
                      </Button>
                    )}
                    {canEdit && (!includeDefault || !isBackupRule) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Delete rule"
                        className="h-6 w-6 hover:cursor-pointer hover:text-orange-500"
                        onClick={() => {
                          setRules((prevRules) =>
                            prevRules.filter((_, j) => j !== ruleIndex),
                          );
                        }}
                      >
                        <Trash2 className="h-6 w-6" />
                      </Button>
                    )}
                  </span>
                }
              >
                {canEdit && (!includeDefault || !isBackupRule) && (
                  <div className="py-2">
                    <Label>Rule group</Label>
                    <Select
                      value={group?.id ?? "ungrouped"}
                      onValueChange={(id) =>
                        setRules((previous) =>
                          previous.map((entry) =>
                            entry.id === rule.id
                              ? {
                                  ...entry,
                                  group: groups.find((value) => value.id === id),
                                }
                              : entry,
                          ),
                        )
                      }
                    >
                      <SelectTrigger aria-label="Rule group">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ungrouped">No group</SelectItem>
                        {groups.map((value) => (
                          <SelectItem key={value.id} value={value.id}>
                            {value.name || "Unnamed group"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="grid w-full grid-cols-1 gap-2 md:grid-cols-2">
                  {/* ******************** */}
                  {/*     CONDITIONS       */}
                  {/* ******************** */}
                  <RuleConditionsEditor
                    rule={rule}
                    ruleIndex={ruleIndex}
                    canEdit={canEdit}
                    setRules={setRules}
                    updateCondition={updateCondition}
                  />
                  {/* ******************** */}
                  {/*       ACTION         */}
                  {/* ******************** */}
                  <RuleActionEditor
                    rule={rule}
                    ruleIndex={ruleIndex}
                    canEdit={canEdit}
                    jutsus={jutsus}
                    items={items}
                    updateAction={updateAction}
                    comboActionNames={props.comboActionNames}
                    availableActionTypes={props.availableActionTypes}
                    availableActionEffects={props.availableActionEffects}
                  />
                </div>
              </Accordion>
            </div>
          </Fragment>
        );
      })}

      {!includeDefault && (
        <div>
          <Badge className="m-3 animate-pulse bg-red-500 p-3">
            WARNING: Not including the default rules allow you to seriously shoot
            yourself in the foot, with AIs just standing around not doing anything, or
            worse resulting in battle errors. Be careful, and note that usually it is
            good to include default rules as a final catch-all.
          </Badge>
        </div>
      )}
      <div className="flex flex-row flex-wrap items-center gap-2 p-3">
        {rules.length === 0 && <p>No rules added to this AI profile yet</p>}
        <div className="grow"></div>
        {(isStaff || props.configuration) && (
          <Toggle
            id="catchAllRules"
            value={includeDefault}
            disabled={isDefault || isSaving || props.configuration?.disabled}
            setShowActive={(value) => {
              setIncludeDefault(value);
              if (value)
                setRules((previous) => {
                  const next = [...previous];
                  enforceExtraRules(next, getBackupRules());
                  return next.map((rule) => ({ ...rule, id: rule.id ?? nanoid() }));
                });
            }}
            labelActive="Include CatchAll"
            labelInactive="No CatchAll"
          />
        )}
        {canEdit && (
          <Button onClick={() => addRule()}>
            <FilePlus className="mr-2 h-6 w-6" /> Add Rule
          </Button>
        )}
        {canEdit && (
          <Button variant="outline" onClick={() => addRule(true)}>
            Add Group
          </Button>
        )}
        {canEdit && (props.configuration || rules.length > 0) && (
          <Button
            onClick={() => {
              const parsed = updateAiProfileSchema.safeParse({
                id: aiProfileId,
                rules,
                includeDefaultRules: !!includeDefault,
              });
              if (!parsed.success) {
                showMutationToast({
                  success: false,
                  message: parsed.error.issues[0]?.message ?? "Invalid AI rules",
                });
                return;
              }
              if (props.configuration) {
                props.configuration.onSave({
                  rules: parsed.data.rules,
                  includeDefaultRules: parsed.data.includeDefaultRules,
                });
              } else {
                updateAiProfile(parsed.data);
              }
            }}
          >
            <Save className="mr-2 h-6 w-6" /> Save Profile
          </Button>
        )}
        {isSaving && <Loader />}
      </div>
    </ContentBox>
  );
};

export default AiProfileEdit;

type SetRules = React.Dispatch<React.SetStateAction<AiRuleType[]>>;

/** Collapsible name and note of the rule group that starts at this rule. */
const RuleGroupHeader: React.FC<{
  group: NonNullable<AiRuleType["group"]>;
  isCollapsed: boolean;
  canEdit: boolean;
  setCollapsedGroups: React.Dispatch<React.SetStateAction<string[]>>;
  setRules: SetRules;
  updateGroup: (id: string, field: "name" | "note", value: string) => void;
}> = ({ group, isCollapsed, canEdit, setCollapsedGroups, setRules, updateGroup }) => (
  <div className="border-b-2 bg-popover p-3">
    <Button
      variant="ghost"
      className="w-full justify-start"
      aria-expanded={!isCollapsed}
      onClick={() =>
        setCollapsedGroups((previous) =>
          isCollapsed
            ? previous.filter((id) => id !== group.id)
            : [...previous, group.id],
        )
      }
    >
      {isCollapsed ? "▸" : "▾"} {group.name || "Unnamed group"}
    </Button>
    {!isCollapsed && (
      <div className="flex flex-col gap-2">
        {canEdit ? (
          <>
            <Label>Group name</Label>
            <Input
              aria-label="Group name"
              value={group.name}
              maxLength={100}
              onChange={(event) => updateGroup(group.id, "name", event.target.value)}
            />
            <Label>Group note</Label>
            <Input
              aria-label="Group note"
              value={group.note}
              maxLength={1000}
              onChange={(event) => updateGroup(group.id, "note", event.target.value)}
            />
            <Button
              variant="outline"
              onClick={() =>
                setRules((previous) =>
                  previous.map((entry) =>
                    entry.group?.id === group.id
                      ? { ...entry, group: undefined }
                      : entry,
                  ),
                )
              }
            >
              Remove label
            </Button>
          </>
        ) : (
          <p>{group.note}</p>
        )}
      </div>
    )}
  </div>
);

/** The clauses that must all match for a rule to apply. */
const RuleConditionsEditor: React.FC<{
  rule: AiRuleType;
  ruleIndex: number;
  canEdit: boolean;
  setRules: SetRules;
  updateCondition: (
    ruleIndex: number,
    conditionIdx: number,
    field: string,
    value: string | number,
  ) => void;
}> = ({ rule, ruleIndex, canEdit, setRules, updateCondition }) => (
  <div className="flex flex-col gap-2">
    <Select
      disabled={!canEdit}
      value={""}
      onValueChange={(e) =>
        setRules((prevRules) => {
          const conditionType = e as ZodAllAiCondition["type"];
          const schema = getConditionSchema(conditionType);
          return prevRules.map((entry, index) =>
            index === ruleIndex
              ? {
                  ...entry,
                  conditions: [...entry.conditions, schema.parse({})],
                }
              : entry,
          );
        })
      }
    >
      <Label htmlFor="available_conditions">Available Conditions</Label>
      <SelectTrigger>
        <SelectValue placeholder={`None`} />
      </SelectTrigger>
      <SelectContent id="available_conditions">
        {AiConditionTypes.map((condition, i) => (
          <SelectItem key={`${condition}-${i}`} value={condition}>
            {condition}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
    <Label htmlFor="available_conditions">Clauses (all conditions must match)</Label>
    <p className="text-muted-foreground text-xs">
      Combine conditions with AND. With no clauses, this rule always applies.
    </p>
    {rule.conditions.map((condition, conditionIndex) => (
      <div
        className="relative flex w-full flex-col rounded-lg border bg-popover p-2 text-xs"
        key={`ai-condition-${ruleIndex}-${condition.type}-${conditionIndex}`}
      >
        <b>{condition.type}</b>
        <i>{condition.description}</i>
        {canEdit && (
          <Trash2
            className="absolute top-2 right-2 h-6 w-6 hover:cursor-pointer hover:text-orange-500"
            onClick={() => {
              setRules((prevRules) =>
                prevRules.map((rule, k) => {
                  if (k === ruleIndex) {
                    return {
                      ...rule,
                      conditions: rule.conditions.filter(
                        (_, l) => l !== conditionIndex,
                      ),
                    };
                  }
                  return rule;
                }),
              );
            }}
          />
        )}
        {"value" in condition && (
          <Input
            disabled={!canEdit}
            id="value"
            type="input"
            value={condition.value}
            onChange={(e) => {
              updateCondition(ruleIndex, conditionIndex, "value", e.target.value);
            }}
          />
        )}
        {"minRange" in condition && (
          <div className="grid grid-cols-2 gap-2">
            <Label>
              Minimum range
              <NumberInput
                disabled={!canEdit}
                aria-label="Minimum range"
                min={0}
                value={condition.minRange}
                onValueChange={(value) =>
                  updateCondition(ruleIndex, conditionIndex, "minRange", value)
                }
              />
            </Label>
            <Label>
              Maximum range
              <NumberInput
                disabled={!canEdit}
                aria-label="Maximum range"
                min={0}
                value={condition.maxRange}
                onValueChange={(value) =>
                  updateCondition(ruleIndex, conditionIndex, "maxRange", value)
                }
              />
            </Label>
          </div>
        )}
        {"effectType" in condition && (
          <Select
            disabled={!canEdit}
            value={condition.effectType}
            onValueChange={(value) => {
              updateCondition(ruleIndex, conditionIndex, "effectType", value);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select effect type" />
            </SelectTrigger>
            <SelectContent>
              {AvailableEffectTypes.map((effectType) => (
                <SelectItem key={effectType} value={effectType}>
                  {effectType}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {"threshold" in condition && (
          <NumberInput
            disabled={!canEdit}
            id="threshold"
            min="0"
            max="100"
            value={condition.threshold}
            onValueChange={(value) => {
              updateCondition(ruleIndex, conditionIndex, "threshold", value);
            }}
            placeholder="Effect threshold (0-100)"
          />
        )}
        {"target" in condition && (
          <Select
            disabled={!canEdit}
            value={condition.target}
            onValueChange={(value) => {
              updateCondition(ruleIndex, conditionIndex, "target", value);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select target" />
            </SelectTrigger>
            <SelectContent>
              {AvailableTargets.map((target, i) => (
                <SelectItem key={`${target}-${i}`} value={target}>
                  {target}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    ))}
    {rule.conditions.length === 0 && <Badge className="bg-slate-500">None Added</Badge>}
  </div>
);

/** The action a rule takes, with the settings its action type supports. */
const RuleActionEditor: React.FC<{
  rule: AiRuleType;
  ruleIndex: number;
  canEdit: boolean;
  jutsus: AiProfileEditProps["userData"]["jutsus"];
  items: AiProfileEditProps["userData"]["items"];
  updateAction: (
    ruleIndex: number,
    update: (action: ZodAllAiAction) => ZodAllAiAction,
  ) => void;
  comboActionNames: AiProfileEditProps["comboActionNames"];
  availableActionTypes: AiProfileEditProps["availableActionTypes"];
  availableActionEffects: AiProfileEditProps["availableActionEffects"];
}> = (props) => {
  const { rule, ruleIndex, canEdit, jutsus, items, updateAction } = props;
  const currentActionType = rule.action.type;
  const itemId = "itemId" in rule.action ? rule.action.itemId : undefined;
  const coordinates = "target" in rule.action ? rule.action.coordinates : undefined;
  return (
    <div className="flex flex-col gap-2">
      <Select
        disabled={!canEdit}
        value={currentActionType}
        onValueChange={(e) =>
          updateAction(ruleIndex, () =>
            getActionSchema(e as ZodAllAiAction["type"]).parse({}),
          )
        }
      >
        <Label htmlFor="available_action">Selected Action</Label>
        <SelectTrigger>
          <SelectValue placeholder={`None`} />
        </SelectTrigger>
        <SelectContent id="available_action">
          {AiActionTypes.filter(
            (action) =>
              !props.availableActionTypes ||
              props.availableActionTypes.some((type) => type === action),
          ).map((action, i) => (
            <SelectItem key={`${action}-${i}`} value={action}>
              {action}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Label htmlFor="available_conditions">Action Settings</Label>
      <div className="flex w-full flex-col gap-2 rounded-lg border bg-popover p-2 text-xs">
        <div className="flex flex-col">
          <b>{currentActionType}</b>
          <i>{rule.action.description}</i>
        </div>
        {"jutsuId" in rule.action && (
          <SearchSelect
            label="Specific jutsu"
            searchLabel="Search jutsu"
            emptyText="No jutsu found."
            // A saved ID stays selected until the player picks a replacement.
            placeholder={
              rule.action.jutsuId ? "Selected jutsu unavailable" : "Select jutsu"
            }
            disabled={!canEdit}
            value={rule.action.jutsuId}
            options={jutsus.map((entry) => ({
              value: entry.jutsuId,
              label: entry.jutsu.name,
            }))}
            onChange={(e) =>
              updateAction(ruleIndex, (action) => ({
                ...action,
                jutsuId: e,
              }))
            }
          />
        )}
        {"itemId" in rule.action && (
          <Select
            disabled={!canEdit}
            value={rule.action.itemId}
            onValueChange={(e) =>
              updateAction(ruleIndex, (action) => ({
                ...action,
                itemId: e,
              }))
            }
          >
            <SelectTrigger aria-label="Specific item">
              <SelectValue placeholder="Select item">
                {items.find((entry) => entry.itemId === itemId)?.item.name ||
                  (rule.action.itemId ? "Selected item unavailable" : "Select item")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent id="available_action">
              {items.map((useritem) => (
                <SelectItem key={useritem.itemId} value={useritem.itemId}>
                  {useritem.item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {"comboIds" in rule.action && (
          <MultiSelect
            disabled={!canEdit}
            selected={rule.action.comboIds}
            getSelectedLabel={(id) => {
              const name = props.comboActionNames?.[id];
              return name ? `${name} (unavailable)` : "Unavailable action";
            }}
            options={[
              ...items.map((ui) => ({
                value: ui.itemId,
                label: ui.item.name,
              })),
              ...jutsus.map((uj) => ({
                value: uj.jutsuId,
                label: uj.jutsu.name,
              })),
            ]}
            onChange={(e) =>
              updateAction(ruleIndex, (action) => ({
                ...action,
                comboIds: e as string[],
              }))
            }
          />
        )}
        {"target" in rule.action && (
          <Select
            disabled={!canEdit}
            value={rule.action.target}
            onValueChange={(e) =>
              updateAction(ruleIndex, (action) => {
                if (!("target" in action)) return action;
                return {
                  ...action,
                  target: e as typeof action.target,
                  coordinates:
                    e === "COORDINATE"
                      ? (action.coordinates ?? {
                          longitude: 0,
                          latitude: 0,
                        })
                      : undefined,
                };
              })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder={`None`} />
            </SelectTrigger>
            <SelectContent id="available_action">
              {AvailableActionTargets.map((target, i) => (
                <SelectItem key={`${target}-${i}`} value={target}>
                  {target}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {"target" in rule.action && rule.action.target === "COORDINATE" && (
          <div className="flex flex-col gap-2">
            <p>
              Zero-based battle tiles: X is the column, Y is the row. The top-left tile
              is (0, 0). Unavailable tiles skip this rule.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(["longitude", "latitude"] as const).map((axis) => (
                <Label key={axis}>
                  {axis === "longitude" ? "X (column)" : "Y (row)"}
                  <NumberInput
                    disabled={!canEdit}
                    aria-label={axis === "longitude" ? "X (column)" : "Y (row)"}
                    min={0}
                    step={1}
                    value={coordinates?.[axis]}
                    onValueChange={(value) => {
                      updateAction(ruleIndex, (action) => {
                        if (!("target" in action)) return action;
                        return {
                          ...action,
                          coordinates: {
                            ...(action.coordinates ?? {
                              longitude: Number.NaN,
                              latitude: Number.NaN,
                            }),
                            [axis]: value,
                          },
                        };
                      });
                    }}
                  />
                </Label>
              ))}
            </div>
            {!aiCoordinatesSchema.safeParse(rule.action.coordinates).success && (
              <p role="alert" className="text-red-500">
                Enter a non-negative whole number for both X and Y.
              </p>
            )}
          </div>
        )}
        {"effect" in rule.action && rule.action.effect && (
          <Select
            disabled={!canEdit}
            value={rule.action.effect}
            onValueChange={(e) =>
              updateAction(ruleIndex, (action) => ({
                ...action,
                effect: e,
              }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder={`None`} />
            </SelectTrigger>
            <SelectContent id="available_action">
              {AvailableEffectTypes.filter(
                (effect) =>
                  !props.availableActionEffects ||
                  props.availableActionEffects.includes(effect),
              ).map((effect, i) => (
                <SelectItem key={`${effect}-${i}`} value={effect}>
                  {effect}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
};
