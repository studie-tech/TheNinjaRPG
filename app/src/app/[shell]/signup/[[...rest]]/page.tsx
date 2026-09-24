"use client";

import { SignUp } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import NativeSignIn from "@/components/native/NativeSignIn";
import { useNativeShell } from "@/hooks/useNativeShell";
import ContentBox from "@/layout/ContentBox";
import WebGlError from "@/layout/WebGLError";
import { usePublicPathname } from "@/utils/routing";

export default function SignupUser() {
  const [webglError, setWebglError] = useState<boolean>(false);
  const [isChecking, setIsChecking] = useState<boolean>(true);
  const isNativeShell = useNativeShell();
  const pathname = usePublicPathname();

  useEffect(() => {
    // Detect WebGL2 support on mount
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");

    if (!gl) {
      setWebglError(true);
    }

    setIsChecking(false);
  }, []);

  if (isChecking || isNativeShell === undefined) {
    return null; // Or a loading spinner if preferred
  }

  if (webglError) {
    return (
      <ContentBox
        title="Browser Not Supported"
        subtitle="WebGL2 is required to play this game"
        alreadyHasH1
        defaultBackHref="/"
      >
        <WebGlError />
      </ContentBox>
    );
  }

  return (
    <ContentBox
      title="Create Account"
      subtitle="Choose how you want to join the ninja world."
      alreadyHasH1
      defaultBackHref="/"
    >
      {pathname === "/signup" && <NativeSignIn />}
      {/* Clerk mounts its root without the rootBox class for a frame; stretching it here
          keeps the card from painting shrink-wrapped and then widening. */}
      <div className="flex flex-row items-center justify-center [color-scheme:light] *:w-full">
        <SignUp
          path="/signup"
          routing="path"
          appearance={{
            elements: {
              rootBox: "!w-full [color-scheme:light]",
              cardBox: "!w-full",
              // Use Clerk style overrides: its generated display rules can override
              // Tailwind utilities and expose duplicate WebView OAuth buttons.
              ...(isNativeShell
                ? {
                    // Keep Clerk's instructions on verification and recovery steps.
                    ...(pathname === "/signup" ? { header: { display: "none" } } : {}),
                    card: {
                      background: "transparent",
                      boxShadow: "none",
                      padding: "16px 0",
                    },
                    cardBox: { width: "100%", boxShadow: "none" },
                    footer: { background: "transparent", backgroundImage: "none" },
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
