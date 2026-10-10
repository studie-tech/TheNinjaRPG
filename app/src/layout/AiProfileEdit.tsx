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
import { showMutationToast } from "@/libs/toast";
import { getUnique } from "@/utils/grouping";
import { canChangeContent } from "@/utils/permissions";
import { useRequiredUserData } from "@/utils/UserContext";
import type { AiRuleType, ZodAllAiAction, ZodAllAiCondition } from "@/validators/ai";
import {
  ActionMoveTowardsOpponent,
  AiActionTypes,
  AiConditionTypes,
  AvailableEffectTypes,
  AvailableTargets,
  enforceExtraRules,
  getActionSchema,
  getBackupRules,
  getConditionSchema,
  updateAiProfileSchema,
} from "@/validators/ai";
import { tagTypes } from "@/validators/combat";

interface AiProfileEditProps {
  userData: {
    aiProfileId: string | null;
    userId: string;
    jutsus: { jutsuId: string; jutsu: { name: string } }[];
    items: { itemId: string; item: { name: string } }[];
  };
  hideTitle?: boolean;
}

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
  const isDefault = aiProfileId === "Default";

  // Check role
  const isStaff = canChangeContent(userData?.role ?? "USER");
  const canEdit = isStaff || !isDefault;

  // Data
  const { data: profile, isPending } = api.ai.getAiProfile.useQuery(
    { id: aiProfileId },
    {},
  );

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

  const { mutate: updateAiProfile, isPending: isSaving } =
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

  // Get backup rules
  const backupRules = getBackupRules();

  // Hydrate when switching profiles or receiving a saved profile.
  useEffect(() => {
    if (!profile) return;
    const copyRules = structuredClone(profile.rules);
    if (profile.includeDefaultRules || !isStaff) {
      enforceExtraRules(copyRules, getBackupRules());
    }
    setRules(copyRules.map((rule) => ({ ...rule, id: nanoid() })));
    setIncludeDefault(profile.includeDefaultRules);
    setActiveElement("");
    setCollapsedGroups([]);
  }, [profile, isStaff]);

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

  // Convenience method for updating rules
  const updateCondition = (
    ruleIndex: number,
    conditionIdx: number,
    field: string,
    value: string,
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
        isToggling ? (
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
        const currentActionType = rule.action.type;
        const actionSchema = getActionSchema(currentActionType);
        const isLastTwo = ruleIndex >= rules.length - backupRules.length;
        const isLastThree = ruleIndex >= rules.length - backupRules.length - 1;
        const ruleKey = rule.id ?? `rule-${ruleIndex}`;
        const group = rule.group;
        const beginsGroup = group && rules[ruleIndex - 1]?.group?.id !== group.id;
        const isCollapsed = !!group && collapsedGroups.includes(group.id);
        return (
          <Fragment key={ruleKey}>
            {beginsGroup && (
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
                          onChange={(event) =>
                            updateGroup(group.id, "name", event.target.value)
                          }
                        />
                        <Label>Group note</Label>
                        <Input
                          aria-label="Group note"
                          value={group.note}
                          maxLength={1000}
                          onChange={(event) =>
                            updateGroup(group.id, "note", event.target.value)
                          }
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
            )}
            <div hidden={isCollapsed}>
              <Accordion
                selectionKey={ruleKey}
                collapsible
                className={includeDefault && isLastTwo ? "opacity-50" : ""}
                title={`Rule ${ruleIndex + 1}`}
                titlePostfix={`: ${rule.conditions.map((c) => c.type).join(", ")} -> ${rule.action.type}`}
                selectedTitle={activeElement}
                onClick={setActiveElement}
                options={
                  <span className="flex">
                    {canEdit && (!includeDefault || !isLastTwo) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Move rule up"
                        className="h-6 w-6 hover:cursor-pointer hover:text-orange-500"
                        onClick={() => {
                          setRules((prevRules) => {
                            if (ruleIndex < 1) return prevRules;
                            const newRules = [...prevRules];
                            const a = newRules[ruleIndex];
                            const b = newRules[ruleIndex - 1];
                            if (a && b) {
                              newRules[ruleIndex] = b;
                              newRules[ruleIndex - 1] = a;
                            }
                            return newRules;
                          });
                        }}
                      >
                        <SquareArrowUp className="h-6 w-6" />
                      </Button>
                    )}
                    {canEdit && (!includeDefault || !isLastThree) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Move rule down"
                        className="h-6 w-6 hover:cursor-pointer hover:text-orange-500"
                        onClick={() => {
                          setRules((prevRules) => {
                            if (ruleIndex + 1 >= prevRules.length) return prevRules;
                            const newRules = [...prevRules];
                            const a = newRules[ruleIndex];
                            const b = newRules[ruleIndex + 1];
                            if (a && b) {
                              newRules[ruleIndex] = b;
                              newRules[ruleIndex + 1] = a;
                            }
                            return newRules;
                          });
                        }}
                      >
                        <SquareArrowDown className="h-6 w-6" />
                      </Button>
                    )}
                    {canEdit && (!includeDefault || !isLastTwo) && (
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
                {canEdit && (!includeDefault || !isLastTwo) && (
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
                  <div className="flex flex-col gap-2">
                    <Select
                      defaultValue={""}
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
                    <Label htmlFor="available_conditions">
                      Clauses (all conditions must match)
                    </Label>
                    <p className="text-muted-foreground text-xs">
                      Combine conditions with AND. With no clauses, this rule always
                      applies.
                    </p>
                    {rule.conditions.map((condition, conditionIndex) => (
                      <div
                        className="relative flex w-full flex-col rounded-lg border bg-popover p-2 text-xs"
                        key={`ai-condition-${ruleIndex}-${condition.type}-${conditionIndex}`}
                      >
                        <b>{condition.type}</b>
                        <i>{condition.description}</i>
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
                        {"value" in condition && (
                          <Input
                            id="value"
                            type="input"
                            value={condition.value}
                            onChange={(e) => {
                              updateCondition(
                                ruleIndex,
                                conditionIndex,
                                "value",
                                e.target.value,
                              );
                            }}
                          />
                        )}
                        {"minRange" in condition && (
                          <div className="grid grid-cols-2 gap-2">
                            <Label>
                              Minimum range
                              <Input
                                aria-label="Minimum range"
                                type="number"
                                min={0}
                                value={condition.minRange}
                                onChange={(event) =>
                                  updateCondition(
                                    ruleIndex,
                                    conditionIndex,
                                    "minRange",
                                    event.target.value,
                                  )
                                }
                              />
                            </Label>
                            <Label>
                              Maximum range
                              <Input
                                aria-label="Maximum range"
                                type="number"
                                min={0}
                                value={condition.maxRange}
                                onChange={(event) =>
                                  updateCondition(
                                    ruleIndex,
                                    conditionIndex,
                                    "maxRange",
                                    event.target.value,
                                  )
                                }
                              />
                            </Label>
                          </div>
                        )}
                        {"effectType" in condition && (
                          <Select
                            value={condition.effectType}
                            onValueChange={(value) => {
                              updateCondition(
                                ruleIndex,
                                conditionIndex,
                                "effectType",
                                value,
                              );
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
                          <Input
                            id="threshold"
                            type="number"
                            min="0"
                            max="100"
                            value={condition.threshold}
                            onChange={(e) => {
                              updateCondition(
                                ruleIndex,
                                conditionIndex,
                                "threshold",
                                (parseInt(e.target.value, 10) || 0).toString(),
                              );
                            }}
                            placeholder="Effect threshold (0-100)"
                          />
                        )}
                        {"target" in condition && (
                          <Select
                            value={condition.target}
                            onValueChange={(value) => {
                              updateCondition(
                                ruleIndex,
                                conditionIndex,
                                "target",
                                value,
                              );
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
                    {rule.conditions.length === 0 && (
                      <Badge className="bg-slate-500">None Added</Badge>
                    )}
                  </div>
                  {/* ******************** */}
                  {/*       ACTION         */}
                  {/* ******************** */}
                  <div className="flex flex-col gap-2">
                    <Select
                      defaultValue={currentActionType}
                      value={currentActionType}
                      onValueChange={(e) =>
                        setRules((prevRules) => {
                          const actionType = e as ZodAllAiAction["type"];
                          return prevRules.map((rule, k) => {
                            if (k === ruleIndex) {
                              return {
                                ...rule,
                                action: getActionSchema(actionType).parse({}),
                              };
                            }
                            return rule;
                          });
                        })
                      }
                    >
                      <Label htmlFor="available_action">Selected Action</Label>
                      <SelectTrigger>
                        <SelectValue placeholder={`None`} />
                      </SelectTrigger>
                      <SelectContent id="available_action">
                        {AiActionTypes.map((action, i) => (
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
                        <Select
                          defaultValue={rule.action.jutsuId}
                          value={rule.action.jutsuId}
                          onValueChange={(e) =>
                            setRules((prevRules) =>
                              prevRules.map((rule, k) => {
                                if (k === ruleIndex) {
                                  return {
                                    ...rule,
                                    action: actionSchema.parse({
                                      ...rule.action,
                                      jutsuId: e,
                                    }),
                                  };
                                }
                                return rule;
                              }),
                            )
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={`None`} />
                          </SelectTrigger>
                          <SelectContent id="available_action">
                            {props.userData?.jutsus?.map((userjutsu) => (
                              <SelectItem
                                key={userjutsu.jutsuId}
                                value={userjutsu.jutsuId}
                              >
                                {userjutsu.jutsu.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      {"itemId" in rule.action && (
                        <Select
                          defaultValue={rule.action.itemId}
                          value={rule.action.itemId}
                          onValueChange={(e) =>
                            setRules((prevRules) =>
                              prevRules.map((rule, k) => {
                                if (k === ruleIndex) {
                                  return {
                                    ...rule,
                                    action: actionSchema.parse({
                                      ...rule.action,
                                      itemId: e,
                                    }),
                                  };
                                }
                                return rule;
                              }),
                            )
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={`None`} />
                          </SelectTrigger>
                          <SelectContent id="available_action">
                            {props.userData?.items?.map((useritem) => (
                              <SelectItem key={useritem.itemId} value={useritem.itemId}>
                                {useritem.item.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      {"comboIds" in rule.action && (
                        <MultiSelect
                          selected={rule.action.comboIds}
                          options={[
                            ...(props.userData?.items?.map((ui) => ({
                              value: ui.itemId,
                              label: ui.item.name,
                            })) ?? []),
                            ...(props.userData?.jutsus?.map((uj) => ({
                              value: uj.jutsuId,
                              label: uj.jutsu.name,
                            })) ?? []),
                          ]}
                          onChange={(e) => {
                            setRules((prevRules) =>
                              prevRules.map((rule, k) => {
                                if (k === ruleIndex) {
                                  return {
                                    ...rule,
                                    action: actionSchema.parse({
                                      ...rule.action,
                                      comboIds: e,
                                    }),
                                  };
                                }
                                return rule;
                              }),
                            );
                          }}
                        />
                      )}
                      {"target" in rule.action && (
                        <Select
                          defaultValue={rule.action.target}
                          value={rule.action.target}
                          onValueChange={(e) =>
                            setRules((prevRules) =>
                              prevRules.map((rule, k) => {
                                if (k === ruleIndex) {
                                  return {
                                    ...rule,
                                    action: actionSchema.parse({
                                      ...rule.action,
                                      target: e,
                                    }),
                                  };
                                }
                                return rule;
                              }),
                            )
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={`None`} />
                          </SelectTrigger>
                          <SelectContent id="available_action">
                            {AvailableTargets?.map((target, i) => (
                              <SelectItem key={`${target}-${i}`} value={target}>
                                {target}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      {"effect" in rule.action && rule.action.effect && (
                        <Select
                          defaultValue={rule.action.effect}
                          value={rule.action.effect}
                          onValueChange={(e) =>
                            setRules((prevRules) =>
                              prevRules.map((rule, k) => {
                                if (k === ruleIndex) {
                                  return {
                                    ...rule,
                                    action: actionSchema.parse({
                                      ...rule.action,
                                      effect: e,
                                    }),
                                  };
                                }
                                return rule;
                              }),
                            )
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={`None`} />
                          </SelectTrigger>
                          <SelectContent id="available_action">
                            {tagTypes?.map((effect, i) => (
                              <SelectItem key={`${effect}-${i}`} value={effect}>
                                {effect}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </div>
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
      <div className="flex flex-row items-center gap-2 p-3">
        {rules.length === 0 && <p>No rules added to this AI profile yet</p>}
        <div className="grow"></div>
        {isStaff && (
          <Toggle
            id="catchAllRules"
            value={includeDefault}
            disabled={isDefault}
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
        {!isSaving && canEdit && (
          <Button onClick={() => addRule()}>
            <FilePlus className="mr-2 h-6 w-6" /> Add Rule
          </Button>
        )}
        {!isSaving && canEdit && (
          <Button variant="outline" onClick={() => addRule(true)}>
            Add Group
          </Button>
        )}
        {!isSaving && canEdit && rules.length > 0 && (
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
              updateAiProfile(parsed.data);
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
