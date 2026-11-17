"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getToggledAiLoadouts } from "@/deltas/ai";
import {
  AI_PROFILE_MAX_RULES,
  BasicElementName,
  GeneralTypes,
} from "@/drizzle/constants";
import { useAutoCombatSetting } from "@/hooks/combat";
import { useSingleFlight } from "@/hooks/useSingleFlight";
import AiProfileEdit from "@/layout/AiProfileEdit";
import Confirm from "@/layout/Confirm";
import JutsuLoadoutSelector from "@/layout/JutsuLoadoutSelector";
import Loader from "@/layout/Loader";
import { getPreferredDamageElement } from "@/libs/combat/elementalDamage";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserDataSelector } from "@/utils/UserContext";
import {
  ActionMoveTowardsOpponent,
  AiRule,
  ConditionDistanceHigherThan,
} from "@/validators/ai";
import {
  type UpdateUserPreferencesSchema,
  updateUserPreferencesSchema,
} from "@/validators/user";

/**
 * Battle Settings Edit
 */
export const BattleSettingsEdit: React.FC<{ userId: string }> = ({ userId }) => {
  // Queries & mutations
  const { data: profile, isPending: isPendingProfile } =
    api.profile.getPublicUser.useQuery(
      { userId },
      // Tagging invalidates inventory queries, so reload these choices on return.
      { enabled: !!userId, refetchOnMount: "always" },
    );
  const { data: userData, updateUser } = useRequiredUserDataSelector((u) => ({
    preferredDamageElement: u.preferredDamageElement,
    preferredGeneral1: u.preferredGeneral1,
    preferredGeneral2: u.preferredGeneral2,
    primaryElement: u.primaryElement,
    showBattleDescription: u.showBattleDescription,
    showPvpRecord: u.showPvpRecord,
    // The active jutsu loadout and its rules, kept current by loadout and rule switches.
    aiProfileId: u.aiProfileId,
    jutsuLoadout: u.jutsuLoadout,
  }));
  const { data: loadouts } = api.jutsu.getLoadouts.useQuery();
  const [hasUnsavedRules, setHasUnsavedRules] = useState(false);
  const utils = api.useUtils();
  const [battleDescriptionDraft, setBattleDescriptionDraft] = useState(
    userData?.showBattleDescription ?? false,
  );
  const battleDescriptionFlight = useSingleFlight();
  const preferencesFlight = useSingleFlight();

  // Default auto-combat preference (persisted on the user)
  const [autoCombat, setAutoCombat] = useAutoCombatSetting();

  // Form setup
  const form = useForm<UpdateUserPreferencesSchema>({
    resolver: zodResolver(updateUserPreferencesSchema),
    defaultValues: {
      preferredGeneral1: null,
      preferredGeneral2: null,
      preferredDamageElement: null,
    },
  });

  // Update battle description setting
  const {
    mutateAsync: updateBattleDescription,
    isPending: isUpdatingBattleDescription,
  } = api.profile.updateBattleDescription.useMutation({
    onSuccess: async (result, input) => {
      if (result.success) await updateUser(input);
    },
  });

  useEffect(() => {
    if (!battleDescriptionFlight.current() && userData) {
      setBattleDescriptionDraft(userData.showBattleDescription);
    }
  }, [userData]);

  const handleBattleDescriptionChange = async (checked: boolean) => {
    const previousValue = battleDescriptionDraft;
    await battleDescriptionFlight.run(true, async () => {
      setBattleDescriptionDraft(checked);

      try {
        const result = await updateBattleDescription({
          showBattleDescription: checked,
        });
        if (!result.success) {
          showMutationToast(result);
          setBattleDescriptionDraft(previousValue);
        }
      } catch {
        // Mutation errors are surfaced by the shared tRPC error handler.
        setBattleDescriptionDraft(previousValue);
      }
    });
  };

  const { mutate: updateAiProfile, isPending } = api.ai.updateAiProfile.useMutation({
    onSuccess: async (data, input) => {
      showMutationToast(data);
      if (data.success) {
        await Promise.all([
          utils.ai.getAiProfile.invalidate({ id: input.id }),
          utils.profile.getAi.invalidate(),
        ]);
      }
    },
  });

  // Update highest preferences
  const { mutateAsync: updatePreferences, isPending: isUpdatingPreferences } =
    api.profile.updatePreferences.useMutation();

  // Update form when the stored preferences change, keeping unsaved edits otherwise
  const storedGeneral1 = userData?.preferredGeneral1;
  const storedGeneral2 = userData?.preferredGeneral2;
  const storedDamageElement = userData?.preferredDamageElement;
  const hasUserData = !!userData;
  useEffect(() => {
    if (hasUserData) {
      form.reset({
        preferredGeneral1: storedGeneral1,
        preferredGeneral2: storedGeneral2,
        preferredDamageElement: storedDamageElement,
      });
    }
  }, [hasUserData, storedGeneral1, storedGeneral2, storedDamageElement, form]);

  // Form submission
  const onSubmit = async (values: UpdateUserPreferencesSchema) => {
    await preferencesFlight.run(true, async () => {
      try {
        const result = await updatePreferences(values);
        showMutationToast(result);
        if (result.success) {
          await updateUser(values);
        }
      } catch {
        // Mutation errors are surfaced by the shared tRPC error handler. Keep the draft.
      }
    });
  };

  // Loaders
  if (!profile || isPendingProfile) return <Loader explanation="Loading profile" />;

  // Render
  return (
    <div className="pb-3">
      <div className="m-2 mb-4 flex items-center space-x-2">
        <Tabs
          defaultValue="preferred"
          className="flex w-full flex-col items-center justify-center"
        >
          <TabsList className="text-center">
            <TabsTrigger value="preferred">Preferences</TabsTrigger>
            <TabsTrigger value="combat">Settings</TabsTrigger>
            <TabsTrigger value="aiprofile">AI Profile</TabsTrigger>
          </TabsList>
          <TabsContent value="preferred">
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="grid w-full grid-cols-1 items-end gap-3 p-4 sm:grid-cols-2"
                aria-busy={isUpdatingPreferences}
              >
                {(["preferredGeneral1", "preferredGeneral2"] as const).map(
                  (name, i) => (
                    <FormField
                      key={name}
                      control={form.control}
                      name={name}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>General {i + 1}</FormLabel>
                          <Select
                            disabled={isUpdatingPreferences}
                            onValueChange={(value) =>
                              field.onChange(value === "__highest__" ? null : value)
                            }
                            value={field.value ?? "__highest__"}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Highest" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="__highest__">Highest</SelectItem>
                              {GeneralTypes.filter(
                                (general) => general !== "Highest",
                              ).map((general) => (
                                <SelectItem key={general} value={general}>
                                  {general}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ),
                )}
                <FormField
                  control={form.control}
                  name="preferredDamageElement"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Primary damage element</FormLabel>
                      <Select
                        disabled={isUpdatingPreferences}
                        onValueChange={(value) =>
                          field.onChange(value === "__innate__" ? null : value)
                        }
                        value={field.value ?? "__innate__"}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="__innate__">
                            Default (
                            {getPreferredDamageElement({
                              primaryElement: userData?.primaryElement,
                            })}
                            )
                          </SelectItem>
                          {BasicElementName.map((element) => (
                            <SelectItem key={element} value={element}>
                              {element}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" disabled={isUpdatingPreferences}>
                  {isUpdatingPreferences ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      <span role="status" aria-live="polite">
                        Saving
                      </span>
                    </>
                  ) : (
                    "Save"
                  )}
                </Button>
              </form>
              <FormDescription>
                Preferred Generals 1 and 2 select the general stats used by attacks with
                &quot;Highest&quot; general scaling, such as the basic attack. Selecting
                Highest uses your strongest available generals.
              </FormDescription>
              <FormDescription className="mt-2">
                Your primary damage element controls Elemental Damage effects in future
                battles, including ranked combat. Choose any basic element. This is
                separate from Elemental Mastery's active element and does not change
                your innate elements or jutsu requirements.
              </FormDescription>
            </Form>
          </TabsContent>
          <TabsContent value="combat">
            <div
              className="flex min-h-8 items-center gap-2"
              aria-busy={isUpdatingBattleDescription}
            >
              <Switch
                id="battle-description"
                checked={battleDescriptionDraft}
                disabled={isUpdatingBattleDescription}
                aria-describedby={
                  isUpdatingBattleDescription ? "battle-description-pending" : undefined
                }
                onCheckedChange={handleBattleDescriptionChange}
              />
              <Label htmlFor="battle-description">Show battle descriptions</Label>
              {isUpdatingBattleDescription && (
                <span
                  id="battle-description-pending"
                  role="status"
                  aria-live="polite"
                  className="inline-flex items-center gap-1 text-muted-foreground text-sm"
                >
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Saving
                </span>
              )}
            </div>
            <br />
            <div
              className="flex min-h-8 items-center gap-2"
              aria-busy={isUpdatingPreferences}
            >
              <Switch
                id="show-pvp-record"
                checked={userData?.showPvpRecord ?? false}
                disabled={isUpdatingPreferences}
                onCheckedChange={(checked) => {
                  void onSubmit({ showPvpRecord: checked });
                }}
              />
              <Label htmlFor="show-pvp-record">
                Show PvP wins, losses, and win rate on profile
              </Label>
              {isUpdatingPreferences && (
                <span
                  role="status"
                  aria-live="polite"
                  className="inline-flex items-center gap-1 text-muted-foreground text-sm"
                >
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Saving
                </span>
              )}
            </div>
            <br />
            <Switch
              id="default-auto-combat"
              checked={autoCombat}
              onCheckedChange={setAutoCombat}
            />
            <Label htmlFor="default-auto-combat">
              Start non-PvP battles with auto combat (your rules for the active jutsu
              loadout fight for you)
            </Label>
          </TabsContent>
          <TabsContent value="aiprofile">
            <div className="mb-3 flex flex-col gap-2 px-3">
              <div className="max-w-xs">
                <JutsuLoadoutSelector
                  variant="dropdown"
                  label="Jutsu loadout"
                  disabled={hasUnsavedRules}
                  describedBy={hasUnsavedRules ? "ai-rules-unsaved" : undefined}
                  // Equipping changes the jutsu these rules can use.
                  onSelected={() =>
                    void utils.profile.getPublicUser.invalidate({ userId })
                  }
                />
              </div>
              {hasUnsavedRules && (
                <p id="ai-rules-unsaved" className="text-muted-foreground text-sm">
                  Save or discard your rule changes to switch loadout.
                </p>
              )}
              <p className="text-muted-foreground text-sm">
                These rules belong to your active jutsu loadout. Kage seat, patrol and
                auto combat use whichever loadout is active. Changing loadout here also
                equips its jutsu. Only jutsu this loadout equips and your equipped items
                can be chosen.
              </p>
            </div>
            <AiProfileEdit
              userData={{
                ...profile,
                aiProfileId: userData?.aiProfileId ?? null,
                jutsus: profile.jutsus.filter((entry) => entry.equipped),
                items: profile.items.filter(
                  (entry) => entry.equipped !== "NONE" && entry.quantity > 0,
                ),
              }}
              comboActionNames={Object.fromEntries([
                // Full ownership supplies display names, while the choices above stay tagged-only.
                ...profile.jutsus.map((entry) => [entry.jutsuId, entry.jutsu.name]),
                ...profile.items.map((entry) => [entry.itemId, entry.item.name]),
              ])}
              maxCustomRules={AI_PROFILE_MAX_RULES}
              onDirtyChange={setHasUnsavedRules}
              onToggled={(toggled) =>
                utils.jutsu.getLoadouts.setData(undefined, (current) =>
                  current ? getToggledAiLoadouts(current, toggled) : current,
                )
              }
              copySources={(loadouts ?? []).flatMap((loadout, index) =>
                loadout.customAi &&
                loadout.aiProfile &&
                loadout.id !== userData?.jutsuLoadout &&
                loadout.aiProfile.id !== userData?.aiProfileId
                  ? [
                      {
                        id: loadout.aiProfile.id,
                        name: loadout.name || `Jutsu loadout ${index + 1}`,
                      },
                    ]
                  : [],
              )}
              hideTitle
            />
            {userData?.aiProfileId && (
              <div className="px-3">
                <Confirm
                  title="Reset rules"
                  tone="destructive"
                  button={
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isPending || hasUnsavedRules}
                    >
                      {isPending ? <Loader size={5} /> : "Reset rules"}
                    </Button>
                  }
                  onAccept={() => {
                    if (!userData?.aiProfileId) return;
                    updateAiProfile({
                      id: userData.aiProfileId,
                      rules: [
                        AiRule.parse({
                          conditions: [ConditionDistanceHigherThan.parse({ value: 2 })],
                          action: ActionMoveTowardsOpponent.parse({}),
                        }),
                      ],
                      includeDefaultRules: true,
                    });
                  }}
                >
                  Replace all rules for your active jutsu loadout with a single "move
                  towards opponent" rule plus the fallback rules? Other loadouts are not
                  affected. This cannot be undone.
                </Confirm>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <p className="italic">
        This changes how your character fights when it fights for you, e.g. in Kage seat
        battles, village patrols and auto combat.
      </p>
    </div>
  );
};
