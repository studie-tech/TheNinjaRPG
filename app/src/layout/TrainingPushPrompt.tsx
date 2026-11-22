"use client";

import { BellRing } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useLocalStorage } from "@/hooks/localstorage";
import { useNativePushPermission } from "@/hooks/useNativePush";

/**
 * Offered in the native apps once the player has queued training: the moment a
 * notification is most obviously useful, so the one system prompt iOS allows is spent
 * on a deliberate yes. Renders nothing on the web, once permission is settled, or after
 * the player declined it here.
 */
export const TrainingPushPrompt = () => {
  const { isSupported, permission, requestPermission } = useNativePushPermission();
  const [dismissed, setDismissed] = useLocalStorage(
    "training-push-prompt-dismissed",
    false,
  );
  const [isAsking, setIsAsking] = useState(false);
  const canAsk = permission === "prompt" || permission === "prompt-with-rationale";
  if (!isSupported || !canAsk || dismissed) return null;
  return (
    <div className="flex flex-col gap-2 rounded border border-violet-500/40 bg-violet-500/10 p-3 text-sm sm:flex-row sm:items-center">
      <BellRing className="hidden h-5 w-5 shrink-0 text-violet-500 sm:block" />
      <p className="grow">
        Training keeps going while you&apos;re away. Want a notification when it
        finishes?
      </p>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
          Not now
        </Button>
        <Button
          size="sm"
          disabled={isAsking}
          onClick={() => {
            setIsAsking(true);
            void requestPermission().finally(() => {
              setIsAsking(false);
              setDismissed(true);
            });
          }}
        >
          Tell me when training finishes
        </Button>
      </div>
    </div>
  );
};
