"use client";

import { Download, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTutorialStep } from "@/hooks/tutorial";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { useUserData } from "@/utils/UserContext";

export default function InstallPrompt() {
  const {
    isVisible,
    hidePrompt,
    dismissPromptLongTerm,
    deferredPrompt,
    isInstalled,
    isIOS,
    isMobile,
    isStandalone,
  } = useInstallPrompt();

  const { data: userData } = useUserData();

  // Tutorial mode
  const { currentStep } = useTutorialStep();

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    try {
      await deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;

      if (choiceResult.outcome === "accepted") {
        console.log("User accepted the install prompt");
      } else {
        console.log("User dismissed the install prompt");
      }

      hidePrompt();
    } catch (error) {
      console.error("Install prompt failed:", error);
    }
  };

  // Don't show if already installed, if user recently dismissed, or if not on mobile
  if (isStandalone || isInstalled || !isMobile || !isVisible) {
    return null;
  }

  if (!userData) return null;

  if (currentStep && userData) return null;

  return (
    <div className="fixed right-4 bottom-4 left-4 z-50 mx-auto max-w-sm">
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-lg dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="mb-2 flex items-center">
              <div className="mr-2 text-2xl">🥷</div>
              <h3 className="font-semibold text-gray-900 dark:text-white">
                Install TheNinja-RPG
              </h3>
            </div>

            {isIOS ? (
              <div className="mb-3 text-gray-600 text-sm dark:text-gray-300">
                <p className="mb-2">To install this app on your iOS device:</p>
                <ol className="list-inside list-decimal space-y-1 text-xs">
                  <li>
                    Tap the Share button <span className="font-mono">⬆️</span>
                  </li>
                  <li>Scroll down and tap &quot;Add to Home Screen&quot;</li>
                  <li>Tap &quot;Add&quot; to install</li>
                </ol>
              </div>
            ) : (
              <p className="mb-3 text-gray-600 text-sm dark:text-gray-300">
                Install TheNinja-RPG on your device for a better gaming experience.
              </p>
            )}

            <div className="flex flex-col gap-2">
              {!isIOS && deferredPrompt && (
                <Button
                  onClick={handleInstallClick}
                  size="sm"
                  className="bg-orange-600 text-white hover:bg-orange-700"
                >
                  <Download className="mr-1 h-4 w-4" />
                  Install App
                </Button>
              )}

              <div className="grid grid-cols-2 gap-2">
                <Button onClick={hidePrompt} variant="outline" size="sm">
                  Maybe Later
                </Button>
                <Button onClick={dismissPromptLongTerm} variant="ghost" size="sm">
                  No Thanks
                </Button>
              </div>
            </div>
          </div>

          <Button onClick={hidePrompt} variant="ghost" size="sm" className="h-auto p-1">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="mt-3 flex items-center justify-center gap-4 border-gray-100 border-t pt-3 dark:border-gray-700">
          <div className="flex items-center text-gray-500 text-xs">
            <Smartphone className="mr-1 h-3 w-3" />
            Mobile Optimized
          </div>
        </div>
      </div>
    </div>
  );
}
