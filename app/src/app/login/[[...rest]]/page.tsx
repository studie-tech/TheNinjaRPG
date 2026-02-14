"use client";

import { SignIn } from "@clerk/nextjs";
import { useState } from "react";
import { useWebGL2Detection } from "@/hooks/webgl";
import ContentBox from "@/layout/ContentBox";
import WebGL2Warning, { WebGL2WarningBanner } from "@/layout/WebGL2Warning";

export default function LoginUser() {
  const { webglError, isChecking } = useWebGL2Detection();
  const [proceedAnyway, setProceedAnyway] = useState<boolean>(false);

  if (isChecking) {
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
      <div className="flex flex-row items-center justify-center">
        <SignIn
          path="/login"
          routing="path"
          signUpUrl="/signup"
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
