"use client";

import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";

export default function CookieConsent() {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const mountPoint = document.getElementById("cookie-consent-mount");
    if (!mountPoint) return;

    const container = document.createElement("div");
    container.id = "CookiebotDeclaration";
    mountPoint.replaceChildren(container);

    const finish = (next: "ready" | "error") => {
      observer.disconnect();
      clearTimeout(timeout);
      setStatus(next);
    };
    const observer = new MutationObserver(() => {
      if (
        container.querySelector("#CookieDeclarationUserStatusPanel") &&
        container.getBoundingClientRect().height > 100
      ) {
        finish("ready");
      }
    });
    observer.observe(container, { attributes: true, childList: true, subtree: true });

    // The declaration loads additional scripts; its first load event is not completion.
    const timeout = setTimeout(() => finish("error"), 30_000);
    const script = document.createElement("script");
    script.id = "CookieDeclaration";
    script.async = true;
    script.src =
      "https://consent.cookiebot.com/c578fa10-0990-4928-aa4b-5f44629c7067/cd.js";
    script.onerror = () => finish("error");
    container.appendChild(script);

    return () => {
      observer.disconnect();
      clearTimeout(timeout);
      script.onerror = null;
      container.remove();
    };
  }, []);

  return (
    <ContentBox title="Cookie Consent" subtitle="View, edit, or withdraw consent!">
      {status === "loading" && <CookieConsentSkeleton />}
      {status === "error" && (
        <Alert>
          <AlertTitle>Cookie settings unavailable</AlertTitle>
          <AlertDescription>
            <p>Check your connection or content blocker, then reload to try again.</p>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Reload page
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <div
        id="cookie-consent-mount"
        className={
          status === "ready"
            ? "transition-opacity duration-200"
            : status === "error"
              ? "hidden"
              : "opacity-0"
        }
      />
    </ContentBox>
  );
}

export const CookieConsentSkeleton: React.FC = () => (
  <Skeleton className="flex h-[2000px] w-full items-start justify-center">
    <Loader explanation="Loading consent data" />
  </Skeleton>
);
