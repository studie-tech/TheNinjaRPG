"use client";

import { BellRing } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
    <Alert role="status">
      <BellRing aria-hidden="true" />
      <AlertTitle>Training keeps going while you&apos;re away</AlertTitle>
      <AlertDescription>
        <p>Want a notification when it finishes?</p>
        <div className="flex flex-wrap gap-2">
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
      </AlertDescription>
    </Alert>
  );
};
