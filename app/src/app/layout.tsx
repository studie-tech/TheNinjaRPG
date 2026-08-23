import { ClerkProvider } from "@clerk/nextjs";
import { MultisessionAppSupport } from "@clerk/nextjs/internal";
import { auth } from "@clerk/nextjs/server";
import { GoogleTagManager } from "@next/third-parties/google";
import * as Sentry from "@sentry/nextjs";
import { NextSSRPlugin } from "@uploadthing/react/next-ssr-plugin";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { extractRouterConfig } from "uploadthing/server";
import TrpcClientProvider from "@/app/_trpc/Provider";
import { ourFileRouter } from "@/app/api/uploadthing/core";
import InstallPrompt from "@/components/pwa/InstallPrompt";
import PWAManager from "@/components/pwa/PWAManager";
import { Toaster } from "@/components/ui/toaster";
import { IMG_LOGO_FULL } from "@/drizzle/constants";
import { env } from "@/env/client.mjs";
import { InstallPromptProvider } from "@/hooks/useInstallPrompt";
import AcceptWarning from "@/layout/AcceptWarning";
import ActivityStreakPopup from "@/layout/ActivityStreakPopup";
import LayoutSwitcher from "@/layout/LayoutSwitcher";
import StructuredData from "@/layout/StructuredData";
import {
  AB_PIXEL_LAYOUT_COOKIE,
  cookieValueToLayout,
  DEFAULT_FONT_SCALE,
  FONT_SCALE_COOKIE,
  LAYOUT_PREFERENCE_COOKIE,
  toFontScale,
} from "@/libs/layoutPreference";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL } from "@/libs/seo";
import { UserContextProvider } from "@/utils/UserContext";

import "../styles/globals.css";
import "sonner/dist/styles.css";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const readCookies = await cookies();
  // A path the proxy matcher misses reaches here without Clerk context and auth()
  // throws. Fall back to the signed-out shell so ClerkProvider can still hydrate the
  // session on the client instead of the whole render failing - but keep reporting it,
  // because a genuine Clerk outage would otherwise silently sign everyone out.
  const authResult = await auth().catch((error: unknown) => {
    Sentry.captureException(error, {
      level: "warning",
      tags: { source: "rootLayoutAuth" },
    });
    return null;
  });
  const initialIsSignedIn = !!authResult?.userId;
  const initialLayout =
    cookieValueToLayout(readCookies.get(LAYOUT_PREFERENCE_COOKIE)?.value) ??
    cookieValueToLayout(readCookies.get(AB_PIXEL_LAYOUT_COOKIE)?.value) ??
    "default";
  // Inlined here rather than applied from localStorage after hydration: --font-scale
  // feeds the root font-size, so changing it client-side re-flows the entire document.
  const initialFontScale =
    toFontScale(readCookies.get(FONT_SCALE_COOKIE)?.value) ?? DEFAULT_FONT_SCALE;

  return (
    <html
      lang="en"
      className={initialLayout === "pixel" ? "dark" : undefined}
      style={{ "--font-scale": initialFontScale } as React.CSSProperties}
      suppressHydrationWarning
    >
      <body className="h-full">
        <StructuredData />
        <NextSSRPlugin
          /** https://docs.uploadthing.com/getting-started/appdir */
          routerConfig={extractRouterConfig(ourFileRouter)}
        />
        <ClerkProvider
          telemetry={false}
          appearance={{
            variables: {
              colorPrimary: "#ce7e00",
              colorForeground: "black",
            },
          }}
        >
          <MultisessionAppSupport>
            <TrpcClientProvider>
              <UserContextProvider>
                <InstallPromptProvider>
                  {env.NEXT_PUBLIC_MEASUREMENT_ID &&
                    process.env.NODE_ENV === "production" && (
                      <GoogleTagManager gtmId={env.NEXT_PUBLIC_MEASUREMENT_ID} />
                    )}
                  <LayoutSwitcher
                    initialIsSignedIn={initialIsSignedIn}
                    initialLayout={initialLayout}
                  >
                    {children}
                  </LayoutSwitcher>
                  <Toaster />
                  <AcceptWarning />
                  <ActivityStreakPopup />
                  <PWAManager />
                  <InstallPrompt />
                  <SpeedInsights sampleRate={0.03} />
                </InstallPromptProvider>
              </UserContextProvider>
            </TrpcClientProvider>
          </MultisessionAppSupport>
        </ClerkProvider>
      </body>
    </html>
  );
}

// Reused variables
const title = SITE_TITLE;
const description = SITE_DESCRIPTION;

// Metadata
export const metadata: Metadata = {
  // Without this Next resolves relative metadata URLs against localhost, and every
  // page-level canonical below would point at the wrong origin.
  metadataBase: new URL(SITE_URL),
  title: {
    default: title,
    // Pages built with buildMetadata pass a short title and get the brand appended.
    template: `%s | ${SITE_NAME}`,
  },
  description: description,
  keywords: [
    "anime",
    "browser game",
    "community",
    "free",
    "game",
    "manga",
    "mmorpg",
    "multiplayer",
    "naruto",
    "ninja",
    "online",
    "rpg",
    "strategy",
    "theninja-rpg",
  ],
  authors: [
    {
      name: "Mathias F. Gruber",
      url: "https://github.com/studie-tech/TheNinjaRPG",
    },
  ],
  creator: "Mathias F. Gruber",
  publisher: "Studie-Tech ApS",
  openGraph: {
    title: title,
    description: description,
    url: SITE_URL,
    siteName: SITE_NAME,
    images: [
      {
        url: IMG_LOGO_FULL,
        width: 512,
        height: 768,
        alt: "TheNinja-RPG Logo",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: title,
    description: description,
    siteId: "137431404",
    creator: "@RealTheNinjaRPG",
    creatorId: "137431404",
    images: [IMG_LOGO_FULL], // Must be an absolute URL
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/icons/icon-192x192.png",
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "TheNinja-RPG",
  },
  // `other` would emit <meta name="googleSiteVerification">, which Google ignores; the
  // dedicated field emits the hyphenated name that Search Console actually looks for.
  verification: {
    google: "0yl4KCd6udl9DAo_TMf8esN6snWH0_gqwf2EShlogRU",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: "#ce7e00",
  colorScheme: "dark light",
  viewportFit: "cover",
};
