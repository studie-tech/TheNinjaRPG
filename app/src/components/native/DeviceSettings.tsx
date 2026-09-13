"use client";

import { useUser } from "@clerk/nextjs";
import { BellRing, LayoutGrid, Loader2, Send, Shield, Vibrate } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { NativeAccountDeletionLink } from "@/components/native/NativeAccountDeletionLink";
import { NativeFeatureCard } from "@/components/native/NativeFeatureCard";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { PushCategory } from "@/drizzle/constants";
import { useLocalStorage } from "@/hooks/localstorage";
import { useNativePushPermission } from "@/hooks/useNativePush";
import { useNativeShell } from "@/hooks/useNativeShell";
import { haptics, platform } from "@/libs/native";
import { showMutationToast } from "@/libs/toast";

/** Player-facing wording for each push category. */
const CATEGORY_LABELS: Record<PushCategory, string> = {
  combat: "Battles and attacks",
  recovery: "Hospital and regeneration",
  training: "Training completed",
  war: "Village wars and raids",
  clan: "Clan and ANBU activity",
  trade: "Auctions and trades",
  social: "Messages and mentions",
  system: "Announcements",
};

/**
 * Device-only settings — haptics and push notifications. Renders nothing in a browser, so
 * it can sit unconditionally in the shared settings panel.
 */
export default function DeviceSettings({ onNavigate }: { onNavigate?: () => void }) {
  const [hapticsOn, setHapticsOn] = useLocalStorage<boolean>(
    haptics.HAPTICS_STORAGE_KEY,
    true,
  );

  const native = useNativeShell();
  const { isSignedIn, isLoaded } = useUser();
  const { permission, requestPermission } = useNativePushPermission();

  const {
    data: preferences,
    isLoading: preferencesLoading,
    isError: preferencesError,
    refetch: reloadPreferences,
  } = api.push.getPreferences.useQuery(undefined, {
    enabled: native === true && isSignedIn === true,
  });
  const utils = api.useUtils();
  const savingCategoriesRef = useRef(new Set<PushCategory>());
  const [savingCategories, setSavingCategories] = useState(
    () => new Set<PushCategory>(),
  );
  const [preferenceOverrides, setPreferenceOverrides] = useState<
    Partial<Record<PushCategory, boolean>>
  >({});

  const { mutateAsync: setPreference } = api.push.setPreference.useMutation();

  const updatePreference = (category: PushCategory, enabled: boolean) => {
    // State does not update synchronously, so use a ref to close the double-tap window.
    if (savingCategoriesRef.current.has(category)) return;

    savingCategoriesRef.current.add(category);
    setSavingCategories((current) => new Set(current).add(category));
    setPreferenceOverrides((current) => ({ ...current, [category]: enabled }));

    void setPreference({ category, enabled })
      .then((result) => {
        if (!result.success) {
          showMutationToast(result);
          setPreferenceOverrides((current) => {
            const next = { ...current };
            delete next[category];
            return next;
          });
          return;
        }

        // The successful write confirms this exact category value. Update the cache
        // directly instead of awaiting a refetch: independent category writes may overlap,
        // and an older refresh must not overwrite a newer optimistic or confirmed choice.
        utils.push.getPreferences.setData(undefined, (current) =>
          current
            ? {
                ...current,
                categories: current.categories.map((preference) =>
                  preference.category === category
                    ? { ...preference, enabled }
                    : preference,
                ),
              }
            : current,
        );
        setPreferenceOverrides((current) => {
          const next = { ...current };
          delete next[category];
          return next;
        });
      })
      .catch(() => {
        // Transport errors are surfaced by the shared mutation error handler. Restore
        // only this row; independently saving categories keep their optimistic state.
        setPreferenceOverrides((current) => {
          const next = { ...current };
          delete next[category];
          return next;
        });
      })
      .finally(() => {
        savingCategoriesRef.current.delete(category);
        setSavingCategories((current) => {
          const next = new Set(current);
          next.delete(category);
          return next;
        });
      });
  };

  const { mutate: sendTest, isPending: isSendingTest } = api.push.sendTest.useMutation({
    onSuccess: (result) => showMutationToast(result),
  });

  const [requesting, setRequesting] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const enableNotifications = async () => {
    setRequesting(true);
    setPermissionError(null);
    try {
      await requestPermission();
    } catch {
      setPermissionError("Could not enable notifications. Please try again.");
    } finally {
      setRequesting(false);
    }
  };

  if (!native) return null;
  if (!isLoaded) return <p role="status">Loading app settings…</p>;
  if (!isSignedIn)
    return (
      <Button asChild className="min-h-[44px]">
        <Link href="/login">Sign in to manage app settings</Link>
      </Button>
    );

  return (
    <div className="space-y-4">
      <NativeFeatureCard
        title="Touch feedback"
        description="Feel important moments in your ninja’s journey."
        icon={Vibrate}
      >
        <div className="flex min-h-[44px] items-center justify-between gap-3">
          <div>
            <label htmlFor="native-haptics" className="cursor-pointer text-[14px]">
              Vibration feedback
            </label>
            <p className="text-muted-foreground text-xs">
              Taps on hits, level ups and travel arrivals
            </p>
          </div>
          <Switch
            className="relative after:absolute after:-inset-3"
            id="native-haptics"
            checked={hapticsOn}
            onCheckedChange={(checked) => {
              setHapticsOn(checked);
              // Play the feedback being switched on so the strength is obvious.
              if (checked) void haptics.impact("MEDIUM");
            }}
            aria-label="Toggle haptic feedback"
          />
        </div>
      </NativeFeatureCard>

      <NativeFeatureCard
        title="Notifications"
        description="Choose when the game can call you back."
        icon={BellRing}
      >
        {permission !== "granted" ? (
          <div className="flex flex-col gap-3">
            <p className="text-muted-foreground text-xs">
              {permission === "denied"
                ? "Notifications are blocked. Turn them back on for TheNinja-RPG in your device settings."
                : "Get alerted when your ninja is needed, even with the app closed."}
            </p>
            {permission !== "denied" && (
              <Button
                className="min-h-[44px]"
                disabled={requesting}
                onClick={() => void enableNotifications()}
              >
                <BellRing className="mr-1 h-4 w-4" />
                {requesting ? "Enabling…" : "Enable notifications"}
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {preferencesLoading && (
              <p role="status" className="flex items-center gap-2 text-[14px]">
                <Loader2 className="size-4 animate-spin" /> Loading notification
                preferences…
              </p>
            )}
            {preferencesError && (
              <div role="alert" className="space-y-2 text-[14px]">
                <p>Your preferences could not be loaded.</p>
                <Button
                  variant="outline"
                  className="min-h-[44px]"
                  onClick={() => void reloadPreferences()}
                >
                  Try again
                </Button>
              </div>
            )}
            {preferences?.categories.map(({ category, enabled }) => {
              const isSaving = savingCategories.has(category);
              const displayedValue = preferenceOverrides[category] ?? enabled;
              const savingStatusId = `push-${category}-saving`;

              return (
                <div
                  key={category}
                  className="flex min-h-[44px] items-center justify-between gap-3 border-primary/10 border-b py-2"
                >
                  <label
                    htmlFor={`native-push-${category}`}
                    className="flex-1 cursor-pointer py-2 text-[14px]"
                  >
                    {CATEGORY_LABELS[category]}
                  </label>
                  <div className="flex items-center gap-2">
                    {isSaving && (
                      <span
                        id={savingStatusId}
                        role="status"
                        aria-live="polite"
                        className="text-muted-foreground text-xs"
                      >
                        Saving
                      </span>
                    )}
                    <Switch
                      className="relative after:absolute after:-inset-3"
                      id={`native-push-${category}`}
                      checked={displayedValue}
                      disabled={isSaving}
                      aria-busy={isSaving}
                      aria-describedby={isSaving ? savingStatusId : undefined}
                      onCheckedChange={(checked) => updatePreference(category, checked)}
                      aria-label={`Toggle ${CATEGORY_LABELS[category]} notifications`}
                    />
                  </div>
                </div>
              );
            })}
            <Button
              className="min-h-[44px] w-full"
              variant="outline"
              disabled={isSendingTest}
              onClick={() => sendTest()}
            >
              <Send className="mr-1 h-4 w-4" />
              {isSendingTest ? "Sending…" : "Send a test notification"}
            </Button>
          </div>
        )}
        {permissionError && (
          <p role="alert" className="text-[14px] text-destructive">
            {permissionError}
          </p>
        )}
      </NativeFeatureCard>
      <NativeFeatureCard
        title="At a glance"
        description="Check on your ninja without opening the game."
        icon={LayoutGrid}
      >
        <details className="rounded-md border border-primary/20 px-3">
          <summary className="min-h-[44px] cursor-pointer py-3 font-medium text-[14px]">
            Add a home screen widget
          </summary>
          <p className="pb-3 text-[14px] leading-relaxed">
            {platform() === "ios"
              ? "Touch and hold your home screen, choose Edit, then Add Widget. Search for TheNinja-RPG and choose Status, Quest or Village."
              : "Touch and hold an empty space on your home screen, choose Widgets and find TheNinja-RPG. Drag the Status widget onto your home screen."}
          </p>
        </details>
        {platform() === "ios" && (
          <p className="text-[14px] text-muted-foreground leading-relaxed">
            Live Activities show supported countdowns on your Lock Screen while you
            play. Their availability is controlled in iPhone settings.
          </p>
        )}
        <p className="text-muted-foreground text-xs">
          Widgets refresh periodically. Open the game for the latest status.
        </p>
      </NativeFeatureCard>
      <NativeFeatureCard
        title="Account"
        description="Your account is shared across the app and website."
        icon={Shield}
      >
        <NativeAccountDeletionLink onNavigate={onNavigate} />
        <p className="text-muted-foreground text-xs">
          Review what will be removed before confirming. Opening this page does not
          delete anything.
        </p>
      </NativeFeatureCard>
    </div>
  );
}
