"use client";

import { SignIn } from "@clerk/nextjs";
import { useState } from "react";
import NativeSignIn from "@/components/native/NativeSignIn";
import { useNativeShell } from "@/hooks/useNativeShell";
import { useWebGL2Detection } from "@/hooks/webgl";
import ContentBox from "@/layout/ContentBox";
import WebGL2Warning, { WebGL2WarningBanner } from "@/layout/WebGL2Warning";
import { usePublicPathname } from "@/utils/routing";

export default function LoginUser() {
  const { webglError, isChecking } = useWebGL2Detection();
  const [proceedAnyway, setProceedAnyway] = useState<boolean>(false);
  const isNativeShell = useNativeShell();
  const pathname = usePublicPathname();

  if (isChecking || isNativeShell === undefined) {
    return null;
  }

  if (webglError && !proceedAnyway) {
    return <WebGL2Warning onProceed={() => setProceedAnyway(true)} />;
  }

  return (
    <ContentBox
      title="Login"
      subtitle="Welcome back. Continue your ninja’s journey."
      alreadyHasH1
      defaultBackHref="/"
    >
      {webglError && <WebGL2WarningBanner />}
      {pathname === "/login" && <NativeSignIn />}
      {/* Clerk mounts its root without the rootBox class for a frame; stretching it here
          keeps the card from painting shrink-wrapped and then widening. */}
      <div className="flex flex-row items-center justify-center [color-scheme:light] *:w-full">
        <SignIn
          path="/login"
          routing="path"
          signUpUrl="/signup"
          appearance={{
            elements: {
              rootBox: "!w-full [color-scheme:light]",
              cardBox: "!w-full",
              // Use Clerk style overrides: its generated display rules can override
              // Tailwind utilities and expose duplicate WebView OAuth buttons.
              ...(isNativeShell
                ? {
                    // Keep Clerk's instructions on verification and recovery steps.
                    ...(pathname === "/login" ? { header: { display: "none" } } : {}),
                    card: {
                      background: "transparent",
                      boxShadow: "none",
                      padding: "16px 0",
                    },
                    cardBox: { width: "100%", boxShadow: "none" },
                    headerTitle: { color: "hsl(var(--card-foreground))" },
                    headerSubtitle: { color: "hsl(var(--card-foreground))" },
                    formHeaderTitle: { color: "hsl(var(--card-foreground))" },
                    formHeaderSubtitle: { color: "hsl(var(--card-foreground))" },
                    formFieldLabel: { color: "hsl(var(--card-foreground))" },
                    identityPreviewText: { color: "hsl(var(--card-foreground))" },
                    footer: { background: "transparent", backgroundImage: "none" },
                    footerActionText: { color: "hsl(var(--card-foreground))" },
                    socialButtons: { display: "none" },
                    dividerRow: { display: "none" },
                  }
                : {}),
            },
          }}
        />
      </div>
    </ContentBox>
  );
}
