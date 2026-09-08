"use client";

import { BellRing, Send } from "lucide-react";
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

  const { data: preferences, refetch } = api.push.getPreferences.useQuery(undefined, {
    enabled: native === true,
  });

  const { mutate: setPreference } = api.push.setPreference.useMutation({
    onSuccess: async (result) => {
      if (!result.success) showMutationToast(result);
      await refetch();
    },
  });

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
            {preferences?.categories.map(({ category, enabled }) => (
              <div key={category} className="flex items-center justify-between">
                <p className="text-sm">{CATEGORY_LABELS[category]}</p>
                <Switch
                  checked={enabled}
                  onCheckedChange={(checked) =>
                    setPreference({ category, enabled: checked })
                  }
                  aria-label={`Toggle ${CATEGORY_LABELS[category]} notifications`}
                />
              </div>
            ))}
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
