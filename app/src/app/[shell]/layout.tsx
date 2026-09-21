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
import {
  absoluteUrl,
  OG_IMAGE_PATH,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
  SITE_URL,
} from "@/libs/seo";
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
 * after hydration it re-flows the entire document. A prerendered document cannot carry
 * the visitor's value, so this runs in <head> and reads it from the cookie the settings
 * dialog writes. Only the values that dialog can write are honoured. A remount of the
 * shell strips the attribute again; LayoutSwitcher re-applies it on mount.
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
  // Unreachable in practice: dynamicParams above already 404s unknown values. Kept for
  // the type narrowing, and as the last line of defence should that ever change.
  if (!variant) notFound();
  const initialIsSignedIn = variant.signedIn;
  const initialLayout = variant.layout;
  const isNativeShell = variant.client !== "web";

  return (
    <html
      lang="en"
      className={initialLayout === "pixel" ? "dark" : undefined}
      suppressHydrationWarning
    >
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: the script is a module-level constant assembled from three other constants, with no input from anywhere. */}
        <script dangerouslySetInnerHTML={{ __html: FONT_SCALE_SCRIPT }} />
      </head>
      <body className="h-full">
        <StructuredData />
        <NextSSRPlugin
          /** https://docs.uploadthing.com/getting-started/appdir */
          routerConfig={extractRouterConfig(ourFileRouter)}
        />
        <ClerkProvider
          proxyUrl={
            isNativeShell && env.NATIVE_CLERK_PROXY_ENABLED === "true"
              ? "/__clerk"
              : undefined
          }
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
// The generated 1200x630 card at the app root, which the file convention would attach on
// its own if this layout lived in the same segment; it does not, so it is named here.
const card = {
  url: absoluteUrl(OG_IMAGE_PATH),
  width: 1200,
  height: 630,
  alt: SITE_NAME,
};

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
    images: [card],
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
    images: [card],
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

export async function generateViewport({
  params,
}: {
  params: Promise<{ shell: string }>;
}): Promise<Viewport> {
  const client = parseShellParam((await params).shell)?.client;
  return {
    width: "device-width",
    initialScale: 1,
    maximumScale: 5,
    userScalable: true,
    themeColor: "#ce7e00",
    colorScheme: "dark light",
    // Android's fixed game controls need native insets; iOS PWAs need cover for CSS safe areas.
    viewportFit: client === "android" ? "contain" : "cover",
  };
}
