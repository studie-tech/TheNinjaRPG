"use client";

import { createContext, type ReactNode, use, useEffect, useState } from "react";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/hooks/localstorage";
import { isNative } from "@/libs/native";

/** Delay before the prompt appears, so it never lands on top of a page still loading. */
const AUTO_SHOW_DELAY_MS = 3000;
const SHORT_DISMISSAL_MS = 7 * 24 * 60 * 60 * 1000;
const LONG_DISMISSAL_MS = 60 * 24 * 60 * 60 * 1000;

const isRecentlyDismissed = (): boolean => {
  const longTerm = safeLocalStorageGetItem("pwa-install-dismissed-long");
  if (longTerm && Date.now() - parseInt(longTerm, 10) < LONG_DISMISSAL_MS) return true;
  const shortTerm = safeLocalStorageGetItem("pwa-install-dismissed");
  return Boolean(
    shortTerm && Date.now() - parseInt(shortTerm, 10) < SHORT_DISMISSAL_MS,
  );
};

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

    // Already inside the native app: there is nothing to add to a home screen.
    if (isNative()) return;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const scheduleAutoShow = () => {
      if (standalone || !mobile || timeoutId !== undefined) return;
      timeoutId = setTimeout(() => {
        if (isRecentlyDismissed()) return;
        setIsVisible(true);
      }, AUTO_SHOW_DELAY_MS);
    };

    // Listen for beforeinstallprompt event
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      scheduleAutoShow();
    };

    // Listen for app installed event
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setIsVisible(false);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    // Safari never fires beforeinstallprompt, so without its own trigger the iOS
    // "Add to Home Screen" instructions in InstallPrompt were unreachable.
    if (iOS) scheduleAutoShow();

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const showPrompt = () => {
    if (isMobile && !isStandalone && !isInstalled && !isNative()) {
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
