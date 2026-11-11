"use client";

import { ChevronsLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import type React from "react";
import { useRef } from "react";
import { ContentBoxHeaderActions } from "@/layout/ContentBoxHeaderActions";
import { hasInAppPreviousEntry } from "@/utils/routing";

export interface ContentBoxProps {
  children: React.ReactNode;
  title?: string;
  defaultBackHref?: string;
  subtitle?: string | React.ReactNode;
  topRightContent?: React.ReactNode;
  bottomRightContent?: React.ReactNode;
  padding?: boolean;
  noBorder?: boolean;
  initialBreak?: boolean;
  noRightAlign?: boolean;
  alreadyHasH1?: boolean;
  id?: string;
  onBack?: () => void;
  backDisabled?: boolean;
}

const ContentBox: React.FC<ContentBoxProps> = (props) => {
  const headerRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);

  const router = useRouter();

  // Go back only when the previous page is part of the game, which keeps a list's scroll
  // and filters; a page opened from another site or a fresh tab goes to its parent page.
  const handleBack = () => {
    if (hasInAppPreviousEntry()) {
      router.back();
    } else if (props.defaultBackHref) {
      router.push(props.defaultBackHref);
    }
  };

  // Title to be shown
  // The 48px touch target is taller than the title line. The negative margin
  // returns that spare space so the subtitle stays against the title.
  const title = props.defaultBackHref ? (
    <button
      type="button"
      className="my-[min(0px,calc((2rem-48px)/2))] ml-1 flex min-h-[48px] min-w-[48px] max-w-full cursor-pointer flex-row items-center hover:text-orange-700 disabled:cursor-wait disabled:opacity-60"
      disabled={props.backDisabled}
      aria-busy={props.backDisabled}
      onClick={() => {
        // onBack owns in-page back navigation (a thread returning to its list). Navigating as
        // well would leave the page, or push the same route and hold the view change until
        // that navigation completes.
        if (props.onBack) props.onBack();
        else handleBack();
      }}
      suppressHydrationWarning
    >
      <ChevronsLeft className="h-6 w-6 shrink-0" />
      <span className="min-w-0 truncate" data-content-box-title-text>
        {props.title}
      </span>
    </button>
  ) : (
    <div className="truncate" data-content-box-title-text suppressHydrationWarning>
      {props.title}
    </div>
  );
  // Show the content box
  return (
    <>
      {props.initialBreak && <div className="h-4"></div>}
      <div className="sm:container" data-content-box id={props.id}>
        <div
          ref={headerRef}
          data-content-box-header
          className="flex min-w-0 flex-row items-center gap-2"
        >
          {props.title && (
            <div ref={titleRef} className="min-w-0">
              {props.initialBreak || props.alreadyHasH1 ? (
                <h2
                  className="truncate font-bold text-2xl text-background-foreground"
                  title={props.title}
                >
                  {title}
                </h2>
              ) : (
                <h1
                  className="truncate font-bold text-2xl text-background-foreground"
                  title={props.title}
                >
                  {title}
                </h1>
              )}
              {/* A subtitle describes its title rather than opening a section. */}
              {props.subtitle && (
                <div
                  className="truncate text-background-foreground"
                  data-content-box-subtitle
                  suppressHydrationWarning
                >
                  {props.subtitle}
                </div>
              )}
            </div>
          )}
          {props.topRightContent && (
            <ContentBoxHeaderActions
              headerRef={headerRef}
              titleRef={titleRef}
              label={props.title || "Page"}
              noRightAlign={props.noRightAlign}
            >
              {props.topRightContent}
            </ContentBoxHeaderActions>
          )}
        </div>

        <div
          data-content-box-inner
          className={`relative ${!props.noBorder ? "border-2 border-double" : ""} bg-card shadow-lg ${props.padding === undefined || props.padding ? "p-3" : ""} text-card-foreground`}
        >
          {props.children}
        </div>
      </div>
      {props.bottomRightContent && (
        <div className="mt-2">
          <div className="flex flex-row justify-end">{props.bottomRightContent}</div>
        </div>
      )}
    </>
  );
};

export default ContentBox;
