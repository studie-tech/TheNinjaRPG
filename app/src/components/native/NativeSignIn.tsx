"use client";

import {
  SiApple,
  SiDiscord,
  SiFacebook,
  SiGoogle,
} from "@icons-pack/react-simple-icons";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { type NativeAuthResult, useNativeAuth } from "@/hooks/useNativeAuth";
import { useNativeShell } from "@/hooks/useNativeShell";
import { appleAuth, type oauthBrowser } from "@/libs/native";
import { showMutationToast } from "@/libs/toast";

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
  const { isPending, signInWithApple, signInWithProvider } = useNativeAuth();
  const [activeProvider, setActiveProvider] = useState<string | null>(null);

  if (!isNativeShell) return null;

  const handle = async (id: string, run: () => Promise<NativeAuthResult>) => {
    setActiveProvider(id);
    const result = await run();
    setActiveProvider(null);
    // A dismissed sheet is the player changing their mind, not something to report.
    if (result.status === "error") {
      showMutationToast({ success: false, message: result.message });
    }
  };

  return (
    <div className="flex w-full flex-col gap-2">
      {appleAuth.isSupported() && (
        <Button
          className="w-full bg-black text-white hover:bg-neutral-800"
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
          className="w-full"
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

      <p className="mt-1 text-center text-muted-foreground text-xs">
        Opens your browser to sign in securely, then returns to the app.
      </p>
    </div>
  );
}
