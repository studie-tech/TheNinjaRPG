import { ClerkProvider } from "@clerk/nextjs";
import { MultisessionAppSupport } from "@clerk/nextjs/internal";
import { NextSSRPlugin } from "@uploadthing/react/next-ssr-plugin";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { extractRouterConfig } from "uploadthing/server";
import TrpcClientProvider from "@/app/_trpc/Provider";
import { ourFileRouter } from "@/app/api/uploadthing/core";
import NativeBridge from "@/components/native/NativeBridge";
import InstallPrompt from "@/components/pwa/InstallPrompt";
import PWAManager from "@/components/pwa/PWAManager";
import { Toaster } from "@/components/ui/toaster";
import { IMG_LOGO_FULL } from "@/drizzle/constants";
import { env } from "@/env/server.mjs";
import { InstallPromptProvider } from "@/hooks/useInstallPrompt";
import AcceptWarning from "@/layout/AcceptWarning";
import ActivityStreakPopup from "@/layout/ActivityStreakPopup";
import LayoutSwitcher from "@/layout/LayoutSwitcher";
import StructuredData from "@/layout/StructuredData";
import { WebAnalytics } from "@/layout/WebAnalytics";
import {
  DEFAULT_FONT_SCALE,
  FONT_SCALE_COOKIE,
  FONT_SCALE_VALUES,
} from "@/libs/layoutPreference";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL } from "@/libs/seo";
import { parseShellParam, SHELL_PARAMS } from "@/libs/shell";
import { UserContextProvider } from "@/utils/UserContext";

import "../../styles/globals.css";
import "sonner/dist/styles.css";

/**
 * Every variant is built at deploy time and the segment is closed to anything else, so
 * an unknown value is a 404 without a render; see SHELL_PARAMS for what that guards.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return SHELL_PARAMS.map((shell) => ({ shell }));
}

/**
 * --font-scale feeds the root font-size, so it has to be set before first paint: applied
 * after hydration it re-flows the entire document. It used to be inlined from the cookie
 * on the server; a prerendered document cannot do that, so this runs in <head> instead
 * and reads the same cookie. Only the values the settings dialog can write are honoured.
 */
const FONT_SCALE_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )${FONT_SCALE_COOKIE}=([^;]*)/);var v=m&&parseFloat(decodeURIComponent(m[1]));if(v!==${DEFAULT_FONT_SCALE}&&${JSON.stringify(FONT_SCALE_VALUES)}.indexOf(v)>=0)document.documentElement.style.setProperty("--font-scale",String(v))}catch(e){}})()`;

export default async function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ shell: string }>;
}) {
  const variant = parseShellParam((await params).shell);
  if (!variant) notFound();
  const initialIsSignedIn = variant.signedIn;
  const initialLayout = variant.layout;
  const isNativeShell = variant.client === "native";

  return (
    <html
      lang="en"
      className={initialLayout === "pixel" ? "dark" : undefined}
      suppressHydrationWarning
    >
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: the script is a module-level constant assembled from two other constants, with no input from anywhere. */}
        <script dangerouslySetInnerHTML={{ __html: FONT_SCALE_SCRIPT }} />
      </head>
      <body className="h-full">
        <StructuredData />
        <NextSSRPlugin
          /** https://docs.uploadthing.com/getting-started/appdir */
          routerConfig={extractRouterConfig(ourFileRouter)}
        />
        <ClerkProvider
          proxyUrl={isNativeShell ? "/__clerk" : undefined}
          telemetry={false}
          appearance={{
            elements: {
              // Clerk’s mobile rule uses rem units against the game’s smaller root font.
              // Override it to prevent iOS focus zoom without disabling pinch zoom.
              formFieldInput: { fontSize: "16px !important" },
            },
            variables: {
              colorPrimary: "#ce7e00",
              colorForeground: "black",
            },
          }}
        >
          <MultisessionAppSupport>
            <TrpcClientProvider>
              <UserContextProvider initialIsSignedIn={initialIsSignedIn}>
                <InstallPromptProvider>
                  {/* The web marketing container includes advertising pixels; never load it in the native shell. */}
                  {!isNativeShell &&
                    env.NEXT_PUBLIC_MEASUREMENT_ID &&
                    process.env.NODE_ENV === "production" && (
                      <WebAnalytics gtmId={env.NEXT_PUBLIC_MEASUREMENT_ID} />
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
                  <NativeBridge />
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
    // iOS wants 180x180 and paints transparent corners black, so this one is flattened.
    apple: { url: "/icons/icon-180x180.png", sizes: "180x180" },
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
