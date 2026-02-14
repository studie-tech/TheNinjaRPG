"use client";

import { ChevronsLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import type React from "react";
import { useCallback, useEffect, useState } from "react";

export interface ContentBoxProps {
  children: React.ReactNode;
  title?: string;
  defaultBackHref?: string;
  subtitle?: string | React.ReactNode;
  topRightCorntentBreakpoint?: "sm" | "md" | "lg" | "xl" | "2xl";
  topRightContent?: React.ReactNode;
  bottomRightContent?: React.ReactNode;
  padding?: boolean;
  noBorder?: boolean;
  initialBreak?: boolean;
  noRightAlign?: boolean;
  alreadyHasH1?: boolean;
  id?: string;
  onBack?: () => void;
}

const ContentBox: React.FC<ContentBoxProps> = (props) => {
  // State for browser-based back functionality
  const router = useRouter();
  const [canGoBack, setCanGoBack] = useState(false);

  // Handle back navigation
  useEffect(() => {
    if (typeof window !== "undefined") {
      setCanGoBack(history.length > 1);
    }
  }, []);

  // Handle back navigation
  const handleBack = useCallback(() => {
    if (canGoBack) {
      router.back();
    } else if (props.defaultBackHref) {
      router.push(props.defaultBackHref);
    }
  }, [canGoBack, router, props]);

  // Title to be shown
  const title = props.defaultBackHref ? (
    <button
      type="button"
      className="ml-1 flex cursor-pointer flex-row items-center hover:text-orange-700"
      onClick={() => {
        handleBack();
        if (props.onBack) props.onBack();
      }}
      suppressHydrationWarning
    >
      <ChevronsLeft className="h-6 w-6" />
      {props.title}
    </button>
  ) : (
    <div suppressHydrationWarning>{props.title}</div>
  );
  // Show the content box
  return (
    <>
      {props.initialBreak && <div className="h-4"></div>}
      <div className="sm:container" id={props.id}>
        <div
          className={`flex ${props.topRightCorntentBreakpoint ? `flex-col ${props.topRightCorntentBreakpoint}:flex-row ${props.topRightCorntentBreakpoint}:items-center` : "flex-row items-center"}`}
        >
          {props.title && (
            <div className="self-start">
              {props.initialBreak || props.alreadyHasH1 ? (
                <h2 className="font-bold text-2xl text-background-foreground">
                  {title}
                </h2>
              ) : (
                <h1 className="font-bold text-2xl text-background-foreground">
                  {title}
                </h1>
              )}
              {props.subtitle && !props.initialBreak && !props.alreadyHasH1 && (
                <h2 className="text-background-foreground" suppressHydrationWarning>
                  {props.subtitle}
                </h2>
              )}
              {props.subtitle && (props.initialBreak || props.alreadyHasH1) && (
                <h3 className="text-background-foreground" suppressHydrationWarning>
                  {props.subtitle}
                </h3>
              )}
            </div>
          )}
          <div className="flex grow flex-row">
            {!props.noRightAlign && <div className="grow"></div>}
            <div className={props.noRightAlign ? "grow" : ""}>
              {props.topRightContent}
            </div>
          </div>
        </div>

        <div
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
