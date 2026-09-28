"use client";

import { PlayCircle } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useCookieConsent } from "@/hooks/useCookieConsent";
import Link from "@/layout/Link";
import { openCookieConsentDialog } from "@/libs/cookieConsent";
import { getIframeProviderName } from "@/utils/audio";

type IframeProps = React.IframeHTMLAttributes<HTMLIFrameElement> & {
  src: string;
  "data-user-iframe"?: string;
};

/**
 * User-embedded players (YouTube and the other providers `isAllowedIframeUrl` permits)
 * set the provider's tracking cookies as soon as the iframe loads. The iframe is only
 * mounted once the visitor has accepted marketing cookies, or clicks to load this one
 * embed; until then a placeholder of the same size explains why.
 */
export const ConsentGatedIframe = (props: IframeProps) => {
  const hasMarketingConsent = useCookieConsent("marketing");
  const [isLoadRequested, setIsLoadRequested] = useState(false);

  if (hasMarketingConsent || isLoadRequested) return <iframe {...props} />;

  const provider = getIframeProviderName(props.src);
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-md border border-border bg-muted p-4 text-center text-muted-foreground text-sm"
      style={getPlaceholderStyle(props.width, props.height)}
    >
      <p>
        This content is hosted by {provider}, which may set cookies on your device when
        it loads.
      </p>
      <Button type="button" size="sm" onClick={() => setIsLoadRequested(true)}>
        <PlayCircle className="mr-2 h-4 w-4" />
        Load content
      </Button>
      <Link
        href="/consent"
        className="text-xs underline"
        onClick={(event) => {
          if (openCookieConsentDialog()) event.preventDefault();
        }}
      >
        Cookie settings
      </Link>
    </div>
  );
};

/**
 * Reserve the embed's authored footprint so loading it does not shift the page
 */
const getPlaceholderStyle = (
  width: IframeProps["width"],
  height: IframeProps["height"],
): React.CSSProperties => {
  const numericWidth = Number(width);
  const numericHeight = Number(height);
  const hasPixelSize = numericWidth > 0 && numericHeight > 0;
  return {
    width: hasPixelSize ? `${numericWidth}px` : "100%",
    maxWidth: "100%",
    aspectRatio: hasPixelSize ? `${numericWidth} / ${numericHeight}` : "16 / 9",
  };
};
