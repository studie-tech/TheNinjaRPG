import type { CookieConsentConfig } from "vanilla-cookieconsent";

export const CONSENT_REVISION = 2;
export const CONSENT_COOKIE = "tnr_consent";

/** First-party settings remain available even when the audit service is offline. */
export const consentConfig: CookieConsentConfig = {
  revision: CONSENT_REVISION,
  mode: "opt-in",
  hideFromBots: false,
  cookie: { name: CONSENT_COOKIE, expiresAfterDays: 180, domain: "" },
  guiOptions: {
    consentModal: {
      layout: "box inline",
      position: "bottom center",
      equalWeightButtons: true,
    },
    preferencesModal: { layout: "box", equalWeightButtons: true },
  },
  categories: {
    necessary: { enabled: true, readOnly: true },
    preferences: {},
    statistics: { autoClear: { cookies: [{ name: /^_ga/ }, { name: "_gid" }] } },
    marketing: {
      autoClear: {
        cookies: [
          { name: /^_gcl/ },
          { name: /^_rdt/ },
          { name: /^_tt/ },
          { name: /^ttcsid/ },
          { name: /^_fb/ },
        ],
      },
    },
  },
  language: {
    default: "en",
    translations: {
      en: {
        consentModal: {
          title: "Your privacy, your choice",
          description:
            "We use essential storage to keep your ninja signed in and the game working. With your permission, we also remember optional preferences, measure visits and run marketing tools. You can change your choice at any time.",
          acceptAllBtn: "Accept all",
          acceptNecessaryBtn: "Essential only",
          showPreferencesBtn: "Choose cookies",
          footer:
            '<a href="/consent">Cookie details</a><a href="https://app.termly.io/document/privacy-policy/9fea0bba-1061-47c0-8f28-0f724f06cc0e">Privacy policy</a>',
        },
        preferencesModal: {
          title: "Cookie preferences",
          acceptAllBtn: "Accept all",
          acceptNecessaryBtn: "Essential only",
          savePreferencesBtn: "Save my choices",
          closeIconLabel: "Close cookie preferences",
          sections: [
            {
              title: "You are in control",
              description:
                "Optional categories start off. You can withdraw consent here or through Cookie Consent in the footer. External players can also be loaded individually when you choose to play them.",
            },
            {
              title: "Essential",
              description:
                "Authentication and security (Clerk and Cloudflare), consent choices, and storage needed for game features. These are always enabled.",
              linkedCategory: "necessary",
            },
            {
              title: "Preferences",
              description:
                "Optional settings that remember how you want to use the site.",
              linkedCategory: "preferences",
            },
            {
              title: "Statistics",
              description:
                "Google Analytics and campaign attribution help us understand visits and improve the game. Analytics cookies such as _ga can last up to two years.",
              linkedCategory: "statistics",
            },
            {
              title: "Marketing and external content",
              description:
                "Google advertising, Reddit and TikTok pixels measure campaigns. With marketing consent, Meta Pixel and the server-side Meta Conversions API measure visits, character registrations and tutorial completions to assess ads and find new players. Meta receives event identifiers, event times, browser information, page URLs/referrers and IP addresses through the Pixel, and consented Facebook click/browser identifiers (_fbc and _fbp, retained for up to 90 days). We link consented advertising attribution to your game account to verify conversions and keep withdrawal decisions for the 180-day consent period. We send opaque event IDs instead of account IDs to Meta. Withdrawing marketing consent stops future reports and cancels queued reports; it cannot recall reports already sent. Embedded YouTube, Vimeo, SoundCloud and Spotify players may contact their providers and set storage. User-authored content may also load external images. Marketing cookies have provider-specific lifetimes, commonly three months to one year.",
              linkedCategory: "marketing",
            },
            {
              title: "Consent record",
              description:
                "Your choice is kept in the tnr_consent cookie for 180 days. Our separate consent audit collector records a browser consent identifier, choices and policy revision; no account ID, full browsing URL or IP address is stored in that record.",
            },
          ],
        },
      },
    },
  },
};

/** Establish denied defaults and block the container's hosted CMP before GTM executes. */
export const CONSENT_BOOTSTRAP = `(function(){window.dataLayer=window.dataLayer||[];window.gtag=window.gtag||function(){window.dataLayer.push(arguments)};window.gtag('consent','default',{analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',functionality_storage:'denied',personalization_storage:'denied',security_storage:'granted'});window.gtag('policy','inject_script',function(c,p,d){try{return !/(^|\\.)cookiebot\\.com$/i.test(new URL(d.url,location.href).hostname)}catch(e){return false}})})();`;
