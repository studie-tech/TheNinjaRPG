"use client";

import { useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";

export const CookieConsentSkeleton: React.FC = () => {
  return (
    <Skeleton className="flex h-[2000px] w-full items-start justify-center">
      <Loader explanation="Loading consent data" />
    </Skeleton>
  );
};

export default function CookieConsent() {
  const [isLoading, setIsLoading] = useState(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Create container div
    const containerDiv = document.createElement("div");
    containerDiv.id = "CookiebotDeclaration";
    containerDiv.style.opacity = "0"; // Hide initially to prevent flashing

    // Get the parent element where we'll mount our elements
    const mountPoint = document.getElementById("cookie-consent-mount");
    if (!mountPoint) return;

    // Clear any existing content
    mountPoint.innerHTML = "";
    mountPoint.appendChild(containerDiv);

    // Function to check if content is meaningful
    const hasMeaningfulContent = () => {
      // Check for specific Cookiebot elements that indicate full content load
      return (
        containerDiv.querySelector("#CookieDeclarationUserStatusPanel") !== null &&
        containerDiv.getBoundingClientRect().height > 100
      );
    };

    // Mutation observer
    const config = { attributes: true, childList: true, subtree: true };
    const observer = new MutationObserver((_mutationList, observer) => {
      if (hasMeaningfulContent()) {
        // Add a small delay to ensure content is fully rendered
        timeoutRef.current = setTimeout(() => {
          containerDiv.style.opacity = "1";
          setIsLoading(false);
          observer.disconnect();
        }, 100);
      }
    });

    // Start observing before adding the script
    observer.observe(containerDiv, config);

    // Create and add script element
    const script = document.createElement("script");
    script.id = "CookieDeclaration";
    script.type = "text/javascript";
    script.async = true;
    script.src = `https://consent.cookiebot.com/c578fa10-0990-4928-aa4b-5f44629c7067/cd.js`;
    containerDiv.appendChild(script);

    // Cleanup
    return () => {
      observer.disconnect();
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <ContentBox title="Cookie Consent" subtitle="View, edit, or withdraw consent!">
      {isLoading && <CookieConsentSkeleton />}
      <div
        id="cookie-consent-mount"
        className={`transition-opacity duration-200 ${isLoading ? "opacity-0" : "opacity-100"}`}
      />
    </ContentBox>
  );
}
