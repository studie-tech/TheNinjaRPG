"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useCookieConsent, useCookieConsentKnown } from "@/hooks/useCookieConsent";
import ContentBox from "@/layout/ContentBox";
import { CONSENT_REVISION } from "@/libs/consentConfig";
import { openCookieConsentDialog } from "@/libs/cookieConsent";

export default function CookieConsent() {
  const isKnown = useCookieConsentKnown();
  const preferences = useCookieConsent("preferences");
  const statistics = useCookieConsent("statistics");
  const marketing = useCookieConsent("marketing");
  const [hasFailed, setHasFailed] = useState(false);
  return (
    <ContentBox title="Cookie Consent" subtitle="View, edit, or withdraw consent!">
      <div className="space-y-4">
        <p>
          Essential storage keeps sign-in, security and game features working. Optional
          categories stay off until you accept them. Your browser remembers your choice
          for 180 days.
        </p>
        <dl className="border-border bg-muted grid grid-cols-2 gap-3 rounded-md border p-4">
          <dt>Essential</dt>
          <dd>Always enabled</dd>
          <dt>Preferences</dt>
          <dd>{preferences ? "Enabled" : "Off"}</dd>
          <dt>Statistics</dt>
          <dd>{statistics ? "Enabled" : "Off"}</dd>
          <dt>Marketing and external content</dt>
          <dd>{marketing ? "Enabled" : "Off"}</dd>
        </dl>
        <Button
          variant="outline"
          onClick={() => setHasFailed(!openCookieConsentDialog())}
        >
          Change or withdraw consent
        </Button>
        {(!isKnown || hasFailed) && (
          <p role="status">
            {!isKnown
              ? "Optional tracking is off while cookie settings load. If settings do not open, reload the page to try again."
              : "Cookie settings could not open. Try again, or reload the page."}
          </p>
        )}
        <h3 className="font-bold">What uses browser storage?</h3>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Essential:</strong> Clerk authentication, Cloudflare security, your
            consent choice and storage required by game features.
          </li>
          <li>
            <strong>Preferences:</strong> optional saved settings.
          </li>
          <li>
            <strong>Statistics:</strong> Google Analytics (_ga cookies, up to two years)
            and consented campaign attribution.
          </li>
          <li>
            <strong>Marketing:</strong> Google advertising, Reddit (_rdt cookies) and
            TikTok (_ttp and ttcsid cookies), commonly retained for three months to one
            year. Meta Pixel and the server-side Meta Conversions API measure visits,
            character registrations and tutorial completions to assess ads and find new
            players. With marketing consent, Meta receives event identifiers, event
            times, browser information, page URLs/referrers and IP addresses through the
            Pixel, and Facebook click/browser identifiers (_fbc and _fbp, up to 90
            days). Withdrawing marketing consent stops future reports and cancels queued
            reports; reports already sent cannot be recalled.
          </li>
          <li>
            <strong>External content:</strong> user-authored images and embedded
            YouTube, Vimeo, SoundCloud and Spotify players can contact their providers.
            Players wait for marketing consent or your individual Load content action.
          </li>
        </ul>
        <p className="text-muted-foreground text-sm">
          Consent policy revision {CONSENT_REVISION}. Our separate consent audit
          collector records a browser consent identifier, choices, timestamp and policy
          revision for up to 13 months. It does not store your account ID, IP address or
          full page URL. Changing your choice updates this record. Declining tracking
          does not prevent playing.
        </p>
      </div>
    </ContentBox>
  );
}
