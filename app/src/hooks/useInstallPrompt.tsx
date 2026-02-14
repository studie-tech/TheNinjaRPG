"use client";

import { createContext, type ReactNode, use, useEffect, useState } from "react";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/hooks/localstorage";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface InstallPromptContextType {
  showPrompt: () => void;
  hidePrompt: () => void;
  dismissPromptLongTerm: () => void;
  isVisible: boolean;
  deferredPrompt: BeforeInstallPromptEvent | null;
  isInstalled: boolean;
  isIOS: boolean;
  isMobile: boolean;
  isStandalone: boolean;
}

const InstallPromptContext = createContext<InstallPromptContextType | undefined>(
  undefined,
);

export function InstallPromptProvider({ children }: { children: ReactNode }) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [isVisible, setIsVisible] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

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

      // Auto-show install prompt after delay if not already installed and on mobile
      if (!standalone && mobile) {
        const timeoutId = setTimeout(() => {
          // Check for long-term dismissal (60 days)
          const dismissedLongTime = safeLocalStorageGetItem(
            "pwa-install-dismissed-long",
          );
          if (
            dismissedLongTime &&
            Date.now() - parseInt(dismissedLongTime, 10) < 60 * 24 * 60 * 60 * 1000
          ) {
            return; // Don't show for 60 days after long-term dismissal
          }

          // Check for short-term dismissal (7 days)
          const dismissedTime = safeLocalStorageGetItem("pwa-install-dismissed");
          if (
            dismissedTime &&
            Date.now() - parseInt(dismissedTime, 10) < 7 * 24 * 60 * 60 * 1000
          ) {
            return; // Don't show for 7 days after dismissal
          }

          setIsVisible(true);
        }, 3000);
        return () => clearTimeout(timeoutId);
      }
    };

    // Listen for app installed event
    const handleAppInstalled = () => {
      console.log("PWA was installed");
      setIsInstalled(true);
      setIsVisible(false);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const showPrompt = () => {
    if (isMobile && !isStandalone && !isInstalled) {
      setIsVisible(true);
    }
  };

  const hidePrompt = () => {
    setIsVisible(false);
    safeLocalStorageSetItem("pwa-install-dismissed", Date.now().toString());
  };

  const dismissPromptLongTerm = () => {
    setIsVisible(false);
    safeLocalStorageSetItem("pwa-install-dismissed-long", Date.now().toString());
  };

  return (
    <InstallPromptContext
      value={{
        showPrompt,
        hidePrompt,
        dismissPromptLongTerm,
        isVisible,
        deferredPrompt,
        isInstalled,
        isIOS,
        isMobile,
        isStandalone,
      }}
    >
      {children}
    </InstallPromptContext>
  );
}

export function useInstallPrompt() {
  const context = use(InstallPromptContext);
  if (context === undefined) {
    throw new Error("useInstallPrompt must be used within InstallPromptProvider");
  }
  return context;
}
