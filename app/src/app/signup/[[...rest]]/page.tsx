"use client";

import { useState, useEffect } from "react";
import ContentBox from "@/layout/ContentBox";
import WebGlError from "@/layout/WebGLError";
import { SignUp } from "@clerk/nextjs";

export default function SignupUser() {
  const [webglError, setWebglError] = useState<boolean>(false);
  const [isChecking, setIsChecking] = useState<boolean>(true);

  useEffect(() => {
    // Detect WebGL2 support on mount
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");

    if (!gl) {
      setWebglError(true);
    }

    setIsChecking(false);
  }, []);

  if (isChecking) {
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
      <div className="flex flex-row items-center justify-center">
        <SignUp
          path="/signup"
          routing="path"
          appearance={{
            elements: {
              rootBox: "!w-full",
              cardBox: "!w-full",
              socialButtons: "!grid-cols-5",
            },
          }}
        />
      </div>
    </ContentBox>
  );
}
