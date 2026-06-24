import { ClerkProvider } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { GoogleTagManager } from "@next/third-parties/google";
import { NextSSRPlugin } from "@uploadthing/react/next-ssr-plugin";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { extractRouterConfig } from "uploadthing/server";
import TrpcClientProvider from "@/app/_trpc/Provider";
import { SessionPinProvider } from "@/app/_trpc/SessionPinProvider";
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
import {
  AB_PIXEL_LAYOUT_COOKIE,
  cookieValueToLayout,
  LAYOUT_PREFERENCE_COOKIE,
} from "@/libs/layoutPreference";
import { UserContextProvider } from "@/utils/UserContext";

import "../styles/globals.css";
import "sonner/dist/styles.css";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const readCookies = await cookies();
  const { userId } = await auth();
  const initialIsSignedIn = !!userId;
  const initialLayout =
    cookieValueToLayout(readCookies.get(LAYOUT_PREFERENCE_COOKIE)?.value) ??
    cookieValueToLayout(readCookies.get(AB_PIXEL_LAYOUT_COOKIE)?.value) ??
    "default";

  return (
    <html
      lang="en"
      className={initialLayout === "pixel" ? "dark" : undefined}
      suppressHydrationWarning
    >
      <body className="h-full">
        <NextSSRPlugin
          /** https://docs.uploadthing.com/getting-started/appdir */
          routerConfig={extractRouterConfig(ourFileRouter)}
        />
        <ClerkProvider
          telemetry={false}
          appearance={{
            variables: {
              colorPrimary: "#ce7e00",
              colorText: "black",
            },
          }}
        >
          <SessionPinProvider>
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
          </SessionPinProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}

// Reused variables
const title = "TheNinja-RPG - Online RPG - Free Online Game for Ninjas";
const description =
  "A free browser game with ninja set in the world of Seichi. A free online game";

// Metadata
export const metadata: Metadata = {
  title: title,
  description: description,
  keywords: [
    "anime",
    "community",
    "core 3",
    "core 4",
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
    url: "https://www.theninja-rpg.com",
    siteName: "TheNinja-RPG",
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
    creator: "@nextjs",
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
  other: {
    googleSiteVerification: "0yl4KCd6udl9DAo_TMf8esN6snWH0_gqwf2EShlogRU",
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
