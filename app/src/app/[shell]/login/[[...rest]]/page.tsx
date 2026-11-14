"use client";

import { SignIn } from "@clerk/nextjs";
import { useState } from "react";
import NativeSignIn from "@/components/native/NativeSignIn";
import { useNativeShell } from "@/hooks/useNativeShell";
import { useWebGLDetection } from "@/hooks/webgl";
import { AuthCardSkeleton } from "@/layout/AuthCardSkeleton";
import ContentBox from "@/layout/ContentBox";
import WebGLWarning, { WebGLWarningBanner } from "@/layout/WebGLWarning";
import { clerkAuthAppearance } from "@/libs/clerkAppearance";
import { usePublicPathname } from "@/utils/routing";

export default function LoginUser() {
  // Optimistic: the form renders while the probe runs, and a failed probe replaces it.
  const { webglError } = useWebGLDetection();
  const [proceedAnyway, setProceedAnyway] = useState<boolean>(false);
  const isNativeShell = useNativeShell();
  const pathname = usePublicPathname();

  if (webglError && !proceedAnyway) {
    return <WebGLWarning onProceed={() => setProceedAnyway(true)} />;
  }

  return (
    <ContentBox
      title="Login"
      subtitle="Welcome back. Continue your ninja’s journey."
      alreadyHasH1
      defaultBackHref="/"
    >
      {webglError && <WebGLWarningBanner />}
      {pathname === "/login" && <NativeSignIn />}
      {/* The Clerk card waits for the shell check so native shells never show its
          WebView OAuth buttons; the skeleton holds its place in the prerendered page. */}
      {isNativeShell === undefined ? (
        <AuthCardSkeleton />
      ) : (
        <>
          {/* Clerk mounts its root without the rootBox class for a frame; stretching it here
          keeps the card from painting shrink-wrapped and then widening. */}
          <div className="flex flex-row items-center justify-center [color-scheme:light] *:w-full">
            <SignIn
              path="/login"
              routing="path"
              signUpUrl="/signup"
              appearance={clerkAuthAppearance({
                isNativeShell,
                hideHeader: pathname === "/login",
              })}
            />
          </div>
        </>
      )}
    </ContentBox>
  );
}
