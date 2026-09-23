"use client";

import type React from "react";
import { Button } from "@/components/ui/button";
import { IMG_LOGO_SHORT } from "@/drizzle/constants";
import { GameSettingsPopover } from "@/layout/GameSettings";
import Image from "@/layout/Image";
import Link from "@/layout/Link";
import PixelPublicMenuDropdown from "@/layout/PixelPublicMenuDropdown";
import { cn } from "@/libs/shadui";

export interface PixelPublicHeaderLink {
  href: string;
  name: string;
}

interface PixelPublicHeaderProps {
  showLogo?: boolean;
  navLinks: PixelPublicHeaderLink[];
}

const PixelPublicHeader: React.FC<PixelPublicHeaderProps> = ({
  showLogo = true,
  navLinks,
}) => {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-sky-100/10 border-b bg-slate-950">
      <div className="mx-auto grid min-h-[64px] w-[min(100%_-_32px,1180px)] grid-cols-[minmax(0,1fr)_auto] items-center gap-[8px] md:grid-cols-[auto_1fr_auto] md:gap-4">
        <Link
          href="/"
          aria-label="The Ninja RPG home"
          className={cn(
            "col-start-1 flex min-h-[48px] items-center transition-[opacity,transform,filter] duration-300 ease-out",
            showLogo
              ? "translate-y-0 scale-100 opacity-100"
              : "pointer-events-none -translate-y-2 scale-95 opacity-0",
          )}
          aria-hidden={!showLogo}
          tabIndex={showLogo ? undefined : -1}
        >
          <Image
            src={IMG_LOGO_SHORT}
            width={250}
            height={63}
            alt="The Ninja RPG"
            priority
            className="h-auto w-36 max-w-full sm:w-44"
          />
        </Link>
        <nav className="col-start-2 hidden justify-center gap-3 text-sm md:flex">
          <PixelPublicMenuDropdown />
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="tnr-ink-nav-link min-h-[48px]"
            >
              {link.name}
            </a>
          ))}
        </nav>
        <div className="col-start-2 flex items-center gap-[8px] justify-self-end md:col-start-3 md:gap-3">
          <Link href="/login">
            <Button
              variant="outline"
              size="sm"
              className="tnr-ink-btn tnr-ink-btn-secondary min-h-[48px]"
              style={{ minWidth: 64 }}
            >
              Log In
            </Button>
          </Link>
          <Link href="/signup">
            <Button
              size="sm"
              className="tnr-ink-btn tnr-ink-btn-primary tnr-ink-register min-h-[48px]"
              style={{ minWidth: 64 }}
            >
              Register
            </Button>
          </Link>
          <GameSettingsPopover
            trigger="settings"
            triggerClassName="tnr-ink-settings-btn min-h-[48px] min-w-[48px]"
          />
        </div>
      </div>
    </header>
  );
};

export default PixelPublicHeader;
