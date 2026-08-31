"use client";

import { SignUp } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import NativeSignIn from "@/components/native/NativeSignIn";
import { useNativeShell } from "@/hooks/useNativeShell";
import ContentBox from "@/layout/ContentBox";
import WebGlError from "@/layout/WebGLError";

export default function SignupUser() {
  const [webglError, setWebglError] = useState<boolean>(false);
  const [isChecking, setIsChecking] = useState<boolean>(true);
  const isNativeShell = useNativeShell();

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
      subtitle="To create please use one of below providers"
      alreadyHasH1
      defaultBackHref="/"
    >
      <NativeSignIn />
      <div className="flex flex-row items-center justify-center">
        <SignUp
          path="/signup"
          routing="path"
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
