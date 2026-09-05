"use client";

import { SignIn } from "@clerk/nextjs";
import { useState } from "react";
import NativeSignIn from "@/components/native/NativeSignIn";
import { useNativeShell } from "@/hooks/useNativeShell";
import { useWebGL2Detection } from "@/hooks/webgl";
import ContentBox from "@/layout/ContentBox";
import WebGL2Warning, { WebGL2WarningBanner } from "@/layout/WebGL2Warning";

export default function LoginUser() {
  const { webglError, isChecking } = useWebGL2Detection();
  const [proceedAnyway, setProceedAnyway] = useState<boolean>(false);
  const isNativeShell = useNativeShell();

  if (isChecking || isNativeShell === undefined) {
    return null;
  }

  if (webglError && !proceedAnyway) {
    return <WebGL2Warning onProceed={() => setProceedAnyway(true)} />;
  }

  return (
    <ContentBox
      title="Login"
      subtitle="To login please use one of below providers"
      alreadyHasH1
      defaultBackHref="/"
    >
      {webglError && <WebGL2WarningBanner />}
      <NativeSignIn />
      <div className="flex flex-row items-center justify-center">
        <SignIn
          path="/login"
          routing="path"
          signUpUrl="/signup"
          appearance={{
            elements: {
              rootBox: "!w-full",
              cardBox: "!w-full",
              // Clerk's social buttons open in the WebView, which Google rejects and
              // Apple will not accept. NativeSignIn replaces them in the shell.
              ...(isNativeShell
                ? { socialButtons: "hidden", dividerRow: "hidden" }
                : {}),
            },
          }}
        />
      </div>
    </ContentBox>
  );
}
