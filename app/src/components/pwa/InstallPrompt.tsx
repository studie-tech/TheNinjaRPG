"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { X, Download, Smartphone } from "lucide-react";
import { useTutorialStep } from "@/hooks/tutorial";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  // Tutorial mode
  const { currentStep } = useTutorialStep();

  useEffect(() => {
    // Detect iOS
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    setIsIOS(iOS);

    // Detect mobile devices (iOS or Android)
    const mobile =
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent,
      );
    setIsMobile(mobile);

    // Check if app is already installed (standalone mode)
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as { standalone?: boolean }).standalone === true;
    setIsStandalone(standalone);

    // Listen for beforeinstallprompt event
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);

      // Show install prompt after a delay if not already installed and on mobile
      if (!standalone && mobile) {
        setTimeout(() => setShowInstallPrompt(true), 3000);
      }
    };

    // Listen for app installed event
    const handleAppInstalled = () => {
      console.log("PWA was installed");
      setIsInstalled(true);
      setShowInstallPrompt(false);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

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

      setDeferredPrompt(null);
      setShowInstallPrompt(false);
    } catch (error) {
      console.error("Install prompt failed:", error);
    }
  };

  const handleDismiss = () => {
    setShowInstallPrompt(false);
    // Remember user dismissed (you might want to store this in localStorage)
    localStorage.setItem("pwa-install-dismissed", Date.now().toString());
  };

  // Don't show if already installed, if user recently dismissed, or if not on mobile
  if (isStandalone || isInstalled || !isMobile) return null;

  if (typeof window !== "undefined" && localStorage) {
    const dismissedTime = localStorage.getItem("pwa-install-dismissed");
    if (
      dismissedTime &&
      Date.now() - parseInt(dismissedTime) < 7 * 24 * 60 * 60 * 1000
    ) {
      return null; // Don't show for 7 days after dismissal
    }
  }

  if (!showInstallPrompt) return null;

  if (currentStep) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-sm">
      <div className="rounded-lg bg-white p-4 shadow-lg border border-gray-200 dark:bg-gray-800 dark:border-gray-700">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center mb-2">
              <div className="text-2xl mr-2">🥷</div>
              <h3 className="font-semibold text-gray-900 dark:text-white">
                Install TheNinja-RPG
              </h3>
            </div>

            {isIOS ? (
              <div className="text-sm text-gray-600 dark:text-gray-300 mb-3">
                <p className="mb-2">To install this app on your iOS device:</p>
                <ol className="list-decimal list-inside space-y-1 text-xs">
                  <li>
                    Tap the Share button <span className="font-mono">⬆️</span>
                  </li>
                  <li>Scroll down and tap &quot;Add to Home Screen&quot;</li>
                  <li>Tap &quot;Add&quot; to install</li>
                </ol>
              </div>
            ) : (
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
                Install TheNinja-RPG on your device for a better gaming experience.
              </p>
            )}

            <div className="grid grid-cols-2 gap-2">
              {!isIOS && deferredPrompt && (
                <Button
                  onClick={handleInstallClick}
                  size="sm"
                  className="bg-orange-600 hover:bg-orange-700 text-white"
                >
                  <Download className="w-4 h-4 mr-1" />
                  Install App
                </Button>
              )}

              <Button
                onClick={handleDismiss}
                variant="outline"
                size="sm"
                className="w-full col-span-2"
              >
                Maybe Later
              </Button>
            </div>
          </div>

          <Button
            onClick={handleDismiss}
            variant="ghost"
            size="sm"
            className="p-1 h-auto"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex items-center justify-center gap-4 mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
          <div className="flex items-center text-xs text-gray-500">
            <Smartphone className="w-3 h-3 mr-1" />
            Mobile Optimized
          </div>
        </div>
      </div>
    </div>
  );
}
