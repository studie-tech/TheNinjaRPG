import React, { useState, useEffect } from "react";
import Loader from "@/layout/Loader";
import NavTabs from "@/layout/NavTabs";
import ContentBox from "@/layout/ContentBox";
import Toggle from "@/components/control/Toggle";
import Accordion from "@/layout/Accordion";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { FilePlus, Trash2, Save } from "lucide-react";
import { SquareArrowUp, SquareArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { showMutationToast } from "@/libs/toast";
import { api } from "@/app/_trpc/client";
import { getConditionSchema, getActionSchema } from "@/validators/ai";
import { AiActionTypes, AiConditionTypes, AvailableEffectTypes } from "@/validators/ai";
import { ActionMoveTowardsOpponent } from "@/validators/ai";
import { getBackupRules, enforceExtraRules } from "@/validators/ai";
import { canChangeContent } from "@/utils/permissions";
import { AvailableTargets } from "@/validators/ai";
import { tagTypes } from "@/libs/combat/types";
import { useRequiredUserData } from "@/utils/UserContext";
import { MultiSelect } from "@/components/ui/multi-select";
import type { AiRuleType, ZodAllAiCondition } from "@/validators/ai";
import type { AiConditionType, AiActionType } from "@/validators/ai";

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
          await utils.profile.getAi.invalidate();
          await utils.profile.getPublicUser.invalidate();
        }
      },
    });

  const { mutate: updateAiProfile, isPending: isSaving } =
    api.ai.updateAiProfile.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.profile.getAi.invalidate();
          await utils.profile.getPublicUser.invalidate();
        }
      },
    });

  // Get backup rules
  const backupRules = getBackupRules();

  // Update based on profile state
  useEffect(() => {
    if (profile) {
      setIncludeDefault(profile.includeDefaultRules);
    }
  }, [profile]);

  // Insert rules from database into client state
  useEffect(() => {
    if (profile) {
      // The rules we'll set
      const copyRules = structuredClone(profile.rules);
      // If the last two rules are not move -> attack, add a default one
      if (includeDefault || !isStaff) {
        enforceExtraRules(copyRules, backupRules);
      }
      setRules(copyRules);
      setActiveElement(`Rule ${profile.rules.length}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeDefault, isDefault]);

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
      {rules.map((rule, i) => {
        const currentActionType = rule.action.type;
        const actionSchema = getActionSchema(currentActionType);
        const isLastTwo = i >= rules.length - backupRules.length;
        const isLastThree = i >= rules.length - backupRules.length - 1;
        return (
          <Accordion
            key={`rule-${i}`}
            className={includeDefault && isLastTwo ? "opacity-50" : ""}
            title={`Rule ${i + 1}`}
            titlePostfix={`: ${rule.conditions.map((c) => c.type).join(", ")} -> ${rule.action.type}`}
            selectedTitle={activeElement}
            onClick={setActiveElement}
            options={
              <>
                {canEdit && (!includeDefault || !isLastTwo) && (
                  <SquareArrowUp
                    className="w-6 h-6 hover:cursor-pointer hover:text-orange-500"
                    onClick={() => {
                      setRules((prevRules) => {
                        if (i < 1) return prevRules;
                        const newRules = [...prevRules];
                        const a = newRules[i]!;
                        const b = newRules[i - 1]!;
                        newRules[i] = b;
                        newRules[i - 1] = a;
                        return newRules;
                      });
                    }}
                  />
                )}
                {canEdit && (!includeDefault || !isLastThree) && (
                  <SquareArrowDown
                    className="w-6 h-6 hover:cursor-pointer hover:text-orange-500"
                    onClick={() => {
                      setRules((prevRules) => {
                        if (i + 1 >= prevRules.length) return prevRules;
                        const newRules = [...prevRules];
                        const a = newRules[i]!;
                        const b = newRules[i + 1]!;
                        newRules[i] = b;
                        newRules[i + 1] = a;
                        return newRules;
                      });
                    }}
                  />
                )}
                {canEdit && (!includeDefault || !isLastTwo) && (
                  <Trash2
                    className="w-6 h-6 hover:cursor-pointer hover:text-orange-500"
                    onClick={() => {
                      setRules((prevRules) => prevRules.filter((_, j) => j !== i));
                    }}
                  />
                )}
              </>
            }
          >
            <div className="w-full grid grid-cols-2 gap-2">
              {/* ******************** */}
              {/*     CONDITIONS       */}
              {/* ******************** */}
              <div className="flex flex-col gap-2">
                <Select
                  defaultValue={""}
                  value={""}
                  onValueChange={(e) =>
                    setRules((prevRules) => {
                      const schema = getConditionSchema(e as AiConditionType);
                      const newRules = [...prevRules];
                      newRules?.[i]?.conditions.push(schema.parse({}));
                      return newRules;
                    })
                  }
                >
                  <Label htmlFor="available_conditions">Available Conditions</Label>
                  <SelectTrigger>
                    <SelectValue placeholder={`None`} />
                  </SelectTrigger>
                  <SelectContent id="available_conditions">
                    {AiConditionTypes.map((condition, j) => (
                      <SelectItem key={`available-condition-${j}`} value={condition}>
                        {condition}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Label htmlFor="available_conditions">Active Conditions</Label>
                {rule.conditions.map((condition, j) => (
                  <div
                    className="relative w-full rounded-lg border p-2 flex flex-col text-xs bg-popover"
                    key={`added-condition-${j}`}
                  >
                    <b>{condition.type}</b>
                    <i>{condition.description}</i>
                    <Trash2
                      className="absolute top-2 right-2 w-6 h-6 hover:cursor-pointer hover:text-orange-500"
                      onClick={() => {
                        setRules((prevRules) =>
                          prevRules.map((rule, k) => {
                            if (k === i) {
                              return {
                                ...rule,
                                conditions: rule.conditions.filter((_, l) => l !== j),
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
                          updateCondition(i, j, "value", e.target.value);
                        }}
                      />
                    )}
                    {"effectType" in condition && (
                      <Select
                        value={condition.effectType}
                        onValueChange={(value) => {
                          updateCondition(i, j, "effectType", value);
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select effect type" />
                        </SelectTrigger>
                        <SelectContent>
                          {AvailableEffectTypes.map((effectType, k) => (
                            <SelectItem key={`effect-type-${k}`} value={effectType}>
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
                          updateCondition(i, j, "threshold", (parseInt(e.target.value) || 0).toString());
                        }}
                        placeholder="Effect threshold (0-100)"
                      />
                    )}
                    {"target" in condition && (
                      <Select
                        value={condition.target}
                        onValueChange={(value) => {
                          updateCondition(i, j, "target", value);
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select target" />
                        </SelectTrigger>
                        <SelectContent>
                          {AvailableTargets.map((target, k) => (
                            <SelectItem key={`target-${k}`} value={target}>
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
                    setRules((prevRules) =>
                      prevRules.map((rule, k) => {
                        if (k === i) {
                          return {
                            ...rule,
                            action: getActionSchema(e as AiActionType).parse({}),
                          };
                        }
                        return rule;
                      }),
                    )
                  }
                >
                  <Label htmlFor="available_action">Selected Action</Label>
                  <SelectTrigger>
                    <SelectValue placeholder={`None`} />
                  </SelectTrigger>
                  <SelectContent id="available_action">
                    {AiActionTypes.map((action, j) => (
                      <SelectItem key={`available-action-${j}`} value={action}>
                        {action}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Label htmlFor="available_conditions">Action Settings</Label>
                <div className="w-full rounded-lg border p-2 flex flex-col text-xs bg-popover gap-2">
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
                            if (k === i) {
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
                        {props.userData?.jutsus?.map((userjutsu, j) => (
                          <SelectItem
                            key={`rule-${i}-jutsuid-${j}`}
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
                            if (k === i) {
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
                        {props.userData?.items?.map((useritem, j) => (
                          <SelectItem
                            key={`rule-${i}-itemid-${j}`}
                            value={useritem.itemId}
                          >
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
                        ...props.userData?.items?.map((ui) => ({
                          value: ui.itemId,
                          label: ui.item.name,
                        })),
                        ...props.userData?.jutsus?.map((uj) => ({
                          value: uj.jutsuId,
                          label: uj.jutsu.name,
                        })),
                      ]}
                      onChange={(e) => {
                        setRules((prevRules) =>
                          prevRules.map((rule, k) => {
                            if (k === i) {
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
                            if (k === i) {
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
                        {AvailableTargets?.map((target, j) => (
                          <SelectItem key={`rule-${i}-target-${j}`} value={target}>
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
                            if (k === i) {
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
                        {tagTypes?.map((effect, j) => (
                          <SelectItem key={`rule-${i}-effect-${j}`} value={effect}>
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
        );
      })}

      {!includeDefault && (
        <div>
          <Badge className="bg-red-500 m-3 p-3 animate-pulse">
            WARNING: Not including the default rules allow you to seriously shoot
            yourself in the foot, with AIs just standing around not doing anything, or
            worse resulting in battle errors. Be careful, and note that usually it is
            good to include default rules as a final catch-all.
          </Badge>
        </div>
      )}
      <div className="p-3 flex flex-row items-center gap-2">
        {rules.length === 0 && <p>No rules added to this AI profile yet</p>}
        <div className="grow"></div>
        {isStaff && (
          <Toggle
            id="catchAllRules"
            value={includeDefault}
            disabled={isDefault}
            setShowActive={setIncludeDefault}
            labelActive="Include CatchAll"
            labelInactive="No CatchAll"
          />
        )}
        {!isSaving && canEdit && (
          <Button
            onClick={() => {
              setRules((prevRules) => [
                {
                  conditions: [] as ZodAllAiCondition[],
                  action: ActionMoveTowardsOpponent.parse({}),
                  priority: 0,
                } as AiRuleType,
                ...prevRules,
              ]);
              setActiveElement(`Rule ${1}`);
            }}
          >
            <FilePlus className="h-6 w-6 mr-2" /> Add Rule
          </Button>
        )}
        {!isSaving && canEdit && rules.length > 0 && (
          <Button
            onClick={() => {
              updateAiProfile({
                id: aiProfileId,
                rules: rules,
                includeDefaultRules: !!includeDefault,
              });
            }}
          >
            <Save className="h-6 w-6 mr-2" /> Save Profile
          </Button>
        )}
        {isSaving && <Loader />}
      </div>
    </ContentBox>
  );
};

export default AiProfileEdit;
