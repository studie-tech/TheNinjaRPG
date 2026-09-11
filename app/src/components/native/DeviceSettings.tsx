"use client";

import { BellRing, Send } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { PushCategory } from "@/drizzle/constants";
import { useLocalStorage } from "@/hooks/localstorage";
import { useNativePushPermission } from "@/hooks/useNativePush";
import { useNativeShell } from "@/hooks/useNativeShell";
import { haptics } from "@/libs/native";
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
export default function DeviceSettings() {
  const [hapticsOn, setHapticsOn] = useLocalStorage<boolean>(
    haptics.HAPTICS_STORAGE_KEY,
    true,
  );

  const native = useNativeShell();
  const { permission, requestPermission } = useNativePushPermission();

  const { data: preferences } = api.push.getPreferences.useQuery(undefined, {
    enabled: native === true,
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

  if (!native) return null;

  return (
    <>
      <div>
        <p className="mb-3 font-medium">Haptics</p>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm">Vibration feedback</p>
            <p className="text-muted-foreground text-xs">
              Taps on hits, level ups and travel arrivals
            </p>
          </div>
          <Switch
            checked={hapticsOn}
            onCheckedChange={(checked) => {
              setHapticsOn(checked);
              // Play the feedback being switched on so the strength is obvious.
              if (checked) void haptics.impact("MEDIUM");
            }}
            aria-label="Toggle haptic feedback"
          />
        </div>
      </div>

      <div>
        <p className="mb-3 font-medium">Notifications</p>
        {permission !== "granted" ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-muted-foreground text-xs">
              {permission === "denied"
                ? "Notifications are blocked. Turn them back on for TheNinja-RPG in your device settings."
                : "Get alerted when your ninja is needed, even with the app closed."}
            </p>
            {permission !== "denied" && (
              <Button size="sm" onClick={() => void requestPermission()}>
                <BellRing className="mr-1 h-4 w-4" />
                Enable
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {preferences?.categories.map(({ category, enabled }) => {
              const isSaving = savingCategories.has(category);
              const displayedValue = preferenceOverrides[category] ?? enabled;
              const savingStatusId = `push-${category}-saving`;

              return (
                <div key={category} className="flex items-center justify-between gap-3">
                  <p className="text-sm">{CATEGORY_LABELS[category]}</p>
                  <div className="flex items-center gap-2">
                    {isSaving && (
                      <span
                        id={savingStatusId}
                        role="status"
                        aria-live="polite"
                        className="text-muted-foreground text-xs"
                      >
                        Saving…
                      </span>
                    )}
                    <Switch
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
              size="sm"
              variant="outline"
              disabled={isSendingTest}
              onClick={() => sendTest()}
            >
              <Send className="mr-1 h-4 w-4" />
              Send a test notification
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
