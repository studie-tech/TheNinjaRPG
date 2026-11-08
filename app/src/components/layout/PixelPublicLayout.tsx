"use client";

import { Music } from "lucide-react";
import type React from "react";
import { GlobalAudioProvider } from "@/layout/GlobalAudioProvider";
import LowerRightHelpBtn from "@/layout/LowerRightHelpBtn";

interface LayoutProps {
  children: React.ReactNode;
}

const PixelPublicLayout: React.FC<LayoutProps> = ({ children }) => {
  return (
    <GlobalAudioProvider>
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

export default PixelPublicLayout;
