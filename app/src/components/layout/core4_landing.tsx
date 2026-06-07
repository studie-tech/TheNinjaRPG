"use client";

import { Music } from "lucide-react";
import type React from "react";
import { useEffect } from "react";
import ReactDOM from "react-dom";
import { IMG_PIXEL_HERO_POSTER_OPTIMIZED } from "@/drizzle/constants";
import { GlobalAudioProvider } from "@/layout/GameSettings";
import LowerRightHelpBtn from "@/layout/LowerRightHelpBtn";
import { useUserData } from "@/utils/UserContext";

export interface LayoutProps {
  children: React.ReactNode;
}

const LayoutCore4Landing: React.FC<LayoutProps> = ({ children }) => {
  ReactDOM.prefetchDNS("https://o4507797256601600.ingest.de.sentry.io");
  ReactDOM.prefetchDNS("https://consentcdn.cookiebot.com");
  ReactDOM.preload(IMG_PIXEL_HERO_POSTER_OPTIMIZED, { as: "image" });

  const { data: userData } = useUserData();

  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <GlobalAudioProvider userData={userData}>
      <div
        className="min-h-screen bg-[#09111d] text-slate-50"
        data-layout-variant="pixel"
        data-pixel-landing
      >
        <div className="fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-50 md:right-6 md:bottom-6">
          <LowerRightHelpBtn ariaLabel="Audio settings">
            <span
              className="tnr-ink-mobile-icon-btn"
              style={{ width: "3.5rem", height: "3.5rem" }}
            >
              <Music className="h-6 w-6 md:h-7 md:w-7" aria-hidden="true" />
            </span>
          </LowerRightHelpBtn>
        </div>
        {children}
      </div>
    </GlobalAudioProvider>
  );
};

export default LayoutCore4Landing;
