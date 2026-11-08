"use client";

import {
  AuthenticateWithRedirectCallback,
  SignIn,
  SignUp,
  useClerk,
  useUser,
} from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import ContentBox from "@/layout/ContentBox";
import { nativeAuthFlowSchema } from "@/validators/nativeAuth";

/** OAuth runs entirely in this browser's Clerk client, including MFA and sign-up. */
export default function NativeBrowserSignIn() {
  const params = useSearchParams();
  const parsed = nativeAuthFlowSchema.safeParse({ flowId: params.get("flow") });
  const flowId = parsed.success ? parsed.data.flowId : "";
  const step = params.get("step");
  const clerk = useClerk();
  const { user, isLoaded } = useUser();
  const started = useRef(false);
  const [error, setError] = useState("");
  const [callback, setCallback] = useState("");
  const flow = api.nativeAuth.describe.useQuery(
    { flowId },
    {
      enabled: Boolean(flowId),
      retry: false,
      staleTime: 0,
    },
  );
  const approve = api.nativeAuth.approve.useMutation();
  const base = `/native-sign-in?flow=${encodeURIComponent(flowId)}`;

  useEffect(() => {
    if (!isLoaded || user || !flow.data || step || started.current) return;
    started.current = true;
    // Starting a new attempt inside the browser gives its callback the same cookie
    // store. A sign-in created inside the shell cannot be completed by this browser.
    if (!clerk.client?.signIn) {
      setError("Sign-in could not start. Try again below.");
      return;
    }
    void clerk.client.signIn
      .authenticateWithRedirect({
        strategy: `oauth_${flow.data.provider}`,
        redirectUrl: `${window.location.origin}${base}&step=callback`,
        redirectUrlComplete: `${window.location.origin}${base}`,
      })
      .catch(() => setError("Sign-in could not start. Try again below."));
  }, [base, clerk, flow.data, isLoaded, step, user]);

  const returnToApp = async () => {
    setError("");
    try {
      const result = await approve.mutateAsync({ flowId });
      if (!result.success) {
        setError(result.message);
        return;
      }
      setCallback(result.callbackUrl);
      window.location.assign(result.callbackUrl);
    } catch {
      setError("Sign-in expired. Return to the app and try again.");
    }
  };

  const switchAccount = async () => {
    try {
      await clerk.signOut({ redirectUrl: base });
    } catch {
      setError("Unable to switch accounts. Check your connection and try again.");
    }
  };

  return (
    <ContentBox title="Sign in to the app" subtitle="TheNinja-RPG">
      {!flowId || flow.error ? (
        <p role="alert">
          Sign-in expired. Close this browser and try again in the app.
        </p>
      ) : !isLoaded || !flow.data ? (
        <p role="status">Loading sign-in…</p>
      ) : user ? (
        <div className="space-y-4">
          <p>
            Continue to TheNinja-RPG app as{" "}
            <strong className="break-words">
              {user.primaryEmailAddress?.emailAddress ??
                user.username ??
                "your signed-in account"}
            </strong>
            ?
          </p>
          <div
            className={`grid items-stretch gap-3 ${callback ? "grid-cols-1" : "grid-cols-2"}`}
          >
            {!callback && (
              <Button
                className="h-auto min-h-[48px] w-full whitespace-normal px-3 py-3 text-[14px] leading-snug"
                disabled={approve.isPending}
                onClick={() => void returnToApp()}
              >
                {approve.isPending ? "Returning…" : "Continue to the app"}
              </Button>
            )}
            {callback ? (
              <Button
                asChild
                variant="outline"
                className="h-auto min-h-[48px] w-full whitespace-normal px-3 py-3 text-[14px] leading-snug"
              >
                <a href={callback}>Open the app</a>
              </Button>
            ) : (
              <Button
                variant="outline"
                className="h-auto min-h-[48px] w-full whitespace-normal px-3 py-3 text-[14px] leading-snug"
                disabled={approve.isPending}
                onClick={() => void switchAccount()}
              >
                Use another account
              </Button>
            )}
          </div>
        </div>
      ) : step === "callback" ? (
        <AuthenticateWithRedirectCallback
          signInUrl={`${base}&step=continue`}
          signUpUrl={`${base}&step=signup`}
          signInForceRedirectUrl={base}
          signUpForceRedirectUrl={base}
        />
      ) : step === "signup" ? (
        <SignUp
          routing="hash"
          signInUrl={`${base}&step=continue`}
          forceRedirectUrl={base}
        />
      ) : step === "continue" || error ? (
        <SignIn
          routing="hash"
          signUpUrl={`${base}&step=signup`}
          forceRedirectUrl={base}
        />
      ) : (
        <p role="status">Opening {flow.data.provider} sign-in…</p>
      )}
      {error && (
        <p role="alert" className="mt-4">
          {error}
        </p>
      )}
    </ContentBox>
  );
}
