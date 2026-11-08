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
import { BasicElementName, GeneralTypes } from "@/drizzle/constants";
import { useAutoCombatSetting } from "@/hooks/combat";
import { useSingleFlight } from "@/hooks/useSingleFlight";
import AiProfileEdit from "@/layout/AiProfileEdit";
import Confirm from "@/layout/Confirm";
import Loader from "@/layout/Loader";
import { getPreferredDamageElement } from "@/libs/combat/elementalDamage";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserData } from "@/utils/UserContext";
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
  const { data: userData, updateUser } = useRequiredUserData();
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
              Start non-PvP battles with auto combat (your AI profile fights for you)
            </Label>
            <br />
            <br />
            <Confirm
              title="Reset AI Profile"
              button={
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={!profile?.aiProfileId || isPending}
                >
                  {isPending ? <Loader size={5} /> : "Reset AI Profile"}
                </Button>
              }
              onAccept={() => {
                if (!profile?.aiProfileId) return;
                const defaultAiProfilePayload = {
                  id: profile.aiProfileId,
                  rules: [
                    AiRule.parse({
                      conditions: [ConditionDistanceHigherThan.parse({ value: 2 })],
                      action: ActionMoveTowardsOpponent.parse({}),
                    }),
                  ],
                  includeDefaultRules: true,
                };
                updateAiProfile(defaultAiProfilePayload);
              }}
            >
              This will reset your AI profile to default settings. This action cannot be
              undone. Are you sure you want to continue?
            </Confirm>
          </TabsContent>
          <TabsContent value="aiprofile">
            <p className="mb-3 text-muted-foreground text-sm">
              Only currently tagged jutsu and items are available for selection.
            </p>
            <AiProfileEdit
              userData={{
                ...profile,
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
              hideTitle
            />
          </TabsContent>
        </Tabs>
      </div>

      <p className="italic">
        This allows you to change how your character behaves in the game in e.g. kage
        battles.
      </p>
    </div>
  );
};
