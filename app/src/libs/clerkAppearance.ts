import type { SignIn } from "@clerk/nextjs";
import type { ComponentProps } from "react";

const CARD_TEXT = { color: "hsl(var(--card-foreground))" };

/**
 * Clerk card styling for the login and signup pages. In the native shell the card blends
 * into the page and drops Clerk's OAuth buttons in favour of `NativeSignIn`; `hideHeader`
 * marks the page's entry step, since verification and recovery steps keep Clerk's
 * instructions.
 */
export const clerkAuthAppearance = ({
  isNativeShell,
  hideHeader,
}: {
  isNativeShell: boolean;
  hideHeader: boolean;
}): ComponentProps<typeof SignIn>["appearance"] => ({
  elements: {
    rootBox: "!w-full [color-scheme:light]",
    cardBox: "!w-full",
    // Use Clerk style overrides: its generated display rules can override
    // Tailwind utilities and expose duplicate WebView OAuth buttons.
    ...(isNativeShell
      ? {
          ...(hideHeader ? { header: { display: "none" } } : {}),
          card: {
            background: "transparent",
            boxShadow: "none",
            padding: "16px 0",
          },
          cardBox: { width: "100%", boxShadow: "none" },
          headerTitle: CARD_TEXT,
          headerSubtitle: CARD_TEXT,
          formHeaderTitle: CARD_TEXT,
          formHeaderSubtitle: CARD_TEXT,
          formFieldLabel: CARD_TEXT,
          identityPreviewText: CARD_TEXT,
          footer: { background: "transparent", backgroundImage: "none" },
          footerActionText: CARD_TEXT,
          socialButtons: { display: "none" },
          dividerRow: { display: "none" },
        }
      : {}),
  },
});
