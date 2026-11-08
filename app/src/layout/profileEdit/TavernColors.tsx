"use client";
import type React from "react";
import { useEffect, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import type { TavernColorPreset } from "@/drizzle/constants";
import { COST_TAVERN_COLOR_CHANGE, TavernColorPresets } from "@/drizzle/constants";
import Confirm from "@/layout/Confirm";
import Loader from "@/layout/Loader";
import {
  getTavernTitleClass,
  getTavernUsernameClass,
  TAVERN_COLOR_STYLES,
} from "@/libs/tavernColors";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserData } from "@/utils/UserContext";

/** Preset-only tavern styling controls. Username and title are separate purchases. */
export const TavernColors: React.FC = () => {
  const { data: userData, prepareUserUpdate, updateUser } = useRequiredUserData();
  const [usernameColor, setUsernameColor] = useState<TavernColorPreset>(
    userData?.tavernUsernameColor ?? "DEFAULT",
  );
  const [titleColor, setTitleColor] = useState<TavernColorPreset>(
    userData?.tavernTitleColor ?? "DEFAULT",
  );

  useEffect(() => {
    if (userData) {
      setUsernameColor(userData.tavernUsernameColor);
      setTitleColor(userData.tavernTitleColor);
    }
  }, [userData?.tavernUsernameColor, userData?.tavernTitleColor]);

  const updateColor = api.profile.updateTavernColor.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (data, input, revision) => {
      showMutationToast(data);
      if (data.success) {
        const color =
          input.target === "username"
            ? data.userPatch?.tavernUsernameColor
            : data.userPatch?.tavernTitleColor;
        await updateUser(
          color !== undefined
            ? {
                ...(input.target === "username"
                  ? { tavernUsernameColor: color }
                  : { tavernTitleColor: color }),
              }
            : undefined,
          { revision, delta: data.userDelta },
        );
      } else {
        await updateUser(undefined, { revision });
      }
    },
  });

  if (!userData) return <Loader explanation="Loading tavern colors" />;

  const controls: Array<{
    target: "username" | "title";
    label: string;
    value: TavernColorPreset;
    current: TavernColorPreset;
    setValue: (value: TavernColorPreset) => void;
  }> = [
    {
      target: "username",
      label: "Username color",
      value: usernameColor,
      current: userData.tavernUsernameColor,
      setValue: setUsernameColor,
    },
    {
      target: "title",
      label: "Title badge color",
      value: titleColor,
      current: userData.tavernTitleColor,
      setValue: setTitleColor,
    },
  ];

  return (
    // Size pickers to the editor's width, including when the category sidebar is visible.
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,20rem),1fr))] gap-5">
      {controls.map((control) => {
        const cost = COST_TAVERN_COLOR_CHANGE;
        const unchanged = control.value === control.current;
        const canAfford = userData.reputationPoints >= cost;
        const isThisPending =
          updateColor.isPending && updateColor.variables?.target === control.target;
        const disabled = unchanged || !canAfford || updateColor.isPending;
        const error =
          !updateColor.isPending && updateColor.variables?.target === control.target
            ? updateColor.error?.message ||
              (updateColor.data?.success === false
                ? updateColor.data.message
                : undefined)
            : undefined;

        return (
          <section
            key={control.target}
            className="border-border/20 space-y-4 rounded-lg border p-4"
          >
            <fieldset>
              <legend className="font-semibold text-lg">{control.label}</legend>
              <p className="mb-3 text-muted-foreground text-sm">
                Current: {TAVERN_COLOR_STYLES[control.current].label}. Every change
                costs {COST_TAVERN_COLOR_CHANGE} reputation.
              </p>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-2">
                {TavernColorPresets.map((preset) => {
                  const style = TAVERN_COLOR_STYLES[preset];
                  const selected = control.value === preset;
                  return (
                    <label
                      key={preset}
                      className={`border-border/30 hover:bg-poppopover flex min-h-11 cursor-pointer items-center gap-2 rounded-md border p-2 text-left text-sm transition-colors ${
                        selected ? "ring-primary ring-2" : ""
                      } ${updateColor.isPending ? "cursor-not-allowed opacity-50" : ""}`}
                    >
                      <input
                        type="radio"
                        name={`tavern-${control.target}-color`}
                        value={preset}
                        checked={selected}
                        aria-label={`${control.label}: ${style.label}`}
                        className="sr-only"
                        onChange={() => control.setValue(preset)}
                        disabled={updateColor.isPending}
                      />
                      <span
                        aria-hidden="true"
                        className={`h-6 w-6 shrink-0 rounded-full border ${style.swatchClass}`}
                      />
                      {style.label}
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div className="rounded-md bg-popover p-3 text-center">
              <p className="mb-2 text-muted-foreground text-xs">Live preview</p>
              {control.target === "username" ? (
                <span
                  className={`${
                    control.value === "DEFAULT"
                      ? "text-popover-foreground"
                      : getTavernUsernameClass(control.value)
                  } font-bold`}
                >
                  {userData.username}
                </span>
              ) : (
                <span
                  className={`m-1 rounded-md p-1 ${getTavernTitleClass(control.value)}`}
                >
                  {userData.displayTitle || "Title preview"}
                </span>
              )}
            </div>

            <Confirm
              title={`Confirm ${control.label}`}
              disabled={disabled}
              button={
                <Button type="button" className="w-full" disabled={disabled}>
                  {isThisPending ? (
                    <Loader size={5} />
                  ) : unchanged ? (
                    "Already selected"
                  ) : !canAfford ? (
                    `Need ${cost - userData.reputationPoints} More Reps`
                  ) : (
                    `Apply for ${cost} Reps`
                  )}
                </Button>
              }
              onAccept={(event) => {
                event.preventDefault();
                updateColor.mutate({
                  target: control.target,
                  color: control.value,
                  currentColor: control.current,
                });
              }}
            >
              Change your tavern {control.target} color to{" "}
              {TAVERN_COLOR_STYLES[control.value].label} for {cost} reputation points?
            </Confirm>
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
          </section>
        );
      })}
      <p className="text-muted-foreground col-span-full text-sm">
        Username and title choices are purchased independently. Tavern colors never
        appear in inbox, support, forums, or other posts. Staff role styling remains
        authoritative, while Default keeps the existing supporter username style.
      </p>
    </div>
  );
};
