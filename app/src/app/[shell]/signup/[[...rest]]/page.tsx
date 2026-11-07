"use client";

import { SignUp } from "@clerk/nextjs";
import NativeSignIn from "@/components/native/NativeSignIn";
import { useNativeShell } from "@/hooks/useNativeShell";
import { useWebGLDetection } from "@/hooks/webgl";
import ContentBox from "@/layout/ContentBox";
import { WebGLUnsupported } from "@/layout/WebGLWarning";
import { clerkAuthAppearance } from "@/libs/clerkAppearance";
import { usePublicPathname } from "@/utils/routing";

export default function SignupUser() {
  const { webglError, isChecking } = useWebGLDetection();
  const isNativeShell = useNativeShell();
  const pathname = usePublicPathname();

  if (isChecking || isNativeShell === undefined) {
    return null; // Or a loading spinner if preferred
  }

  if (webglError) {
    return (
      <ContentBox
        title="Browser Not Supported"
        subtitle="WebGL is required to play this game"
        alreadyHasH1
        defaultBackHref="/"
      >
        <WebGLUnsupported />
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
          signInUrl="/login"
          appearance={clerkAuthAppearance({
            isNativeShell,
            hideHeader: pathname === "/signup",
          })}
        />
      </div>
    </ContentBox>
  );
}
