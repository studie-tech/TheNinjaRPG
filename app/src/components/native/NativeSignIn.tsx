"use client";

import { useSession } from "@clerk/nextjs";
import {
  SiApple,
  SiDiscord,
  SiFacebook,
  SiGoogle,
} from "@icons-pack/react-simple-icons";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { type NativeAuthResult, useNativeAuth } from "@/hooks/useNativeAuth";
import { useNativeShell } from "@/hooks/useNativeShell";
import { appleAuth, haptics, type oauthBrowser } from "@/libs/native";

/**
 * Providers offered in the app. Must match what is enabled in the Clerk dashboard — an
 * option here that Clerk does not have configured fails only once the player taps it.
 */
const PROVIDERS: {
  id: oauthBrowser.ExternalOAuthProvider;
  label: string;
  Icon: typeof SiGoogle;
}[] = [
  { id: "google", label: "Google", Icon: SiGoogle },
  { id: "discord", label: "Discord", Icon: SiDiscord },
  { id: "facebook", label: "Facebook", Icon: SiFacebook },
];

/**
 * Sign-in buttons for the native shell.
 *
 * Rendered instead of Clerk's own social buttons, which cannot work here: Google refuses
 * OAuth from a WebView, and Apple requires its system sheet. Renders nothing in a browser.
 */
export default function NativeSignIn() {
  const isNativeShell = useNativeShell();
  const { isLoaded, isSignedIn } = useSession();
  const router = useRouter();
  const { isPending, signInWithApple, signInWithProvider } = useNativeAuth();
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Activating an account rebuilds the session boundary and can retire the original
  // sign-in callback. Observe the live session so the replacement login also leaves.
  useEffect(() => {
    if (isNativeShell && isLoaded && isSignedIn) router.replace("/");
  }, [isNativeShell, isLoaded, isSignedIn, router]);

  if (!isNativeShell) return null;

  const handle = async (id: string, run: () => Promise<NativeAuthResult>) => {
    setError(null);
    setActiveProvider(id);
    const result = await run();
    setActiveProvider(null);
    // A dismissed sheet is the player changing their mind, not something to report.
    if (result.status === "error") {
      void haptics.notify("ERROR");
      setError(result.message);
    }
  };

  return (
    <div className="flex w-full flex-col gap-3 rounded-lg border border-primary/25 bg-background p-4 shadow-xs">
      {appleAuth.isSupported() && (
        <Button
          className="h-auto min-h-[48px] w-full bg-black text-[14px] text-white hover:bg-neutral-800"
          disabled={isPending}
          onClick={() => void handle("apple", signInWithApple)}
        >
          {activeProvider === "apple" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <SiApple className="mr-2 h-4 w-4" />
          )}
          Continue with Apple
        </Button>
      )}

      {PROVIDERS.map(({ id, label, Icon }) => (
        <Button
          key={id}
          variant="outline"
          className="h-auto min-h-[48px] w-full text-[14px]"
          disabled={isPending}
          onClick={() => void handle(id, () => signInWithProvider(id))}
        >
          {activeProvider === id ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Icon className="mr-2 h-4 w-4" />
          )}
          Continue with {label}
        </Button>
      ))}

      {error && (
        <p role="alert" className="text-[14px] text-destructive">
          {error}
        </p>
      )}

      <p className="mt-1 text-pretty text-center text-muted-foreground text-xs">
        Sign in securely, then return to the game.
      </p>
    </div>
  );
}
