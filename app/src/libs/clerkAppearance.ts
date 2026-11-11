import type { SignIn } from "@clerk/nextjs";
import type { ComponentProps } from "react";

const CARD_TEXT = { color: "hsl(var(--card-foreground))" };

/** Provider and alternative-method buttons keep a light face against the page's surface. */
const LIGHT_BUTTON = { background: "white", color: "black" };

/**
 * Clerk card styling for the login and signup pages. The card blends into the page's
 * ContentBox, whose title replaces Clerk's header on the entry step (`hideHeader`);
 * verification and recovery steps keep Clerk's instructions. In the native shell the card
 * also drops Clerk's OAuth buttons in favour of `NativeSignIn`.
 */
export const clerkAuthAppearance = ({
  isNativeShell,
  hideHeader,
}: {
  isNativeShell: boolean;
  hideHeader: boolean;
}): ComponentProps<typeof SignIn>["appearance"] => ({
  // Clerk sizes its text in rem; pixels keep it readable against the game's 12px root.
  variables: { fontSize: "13px" },
  elements: {
    rootBox: "!w-full [color-scheme:light]",
    // Use Clerk style overrides: its generated display rules can override
    // Tailwind utilities and expose duplicate WebView OAuth buttons.
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
    formFieldHintText: CARD_TEXT,
    identityPreviewText: CARD_TEXT,
    dividerText: CARD_TEXT,
    footer: { background: "transparent", backgroundImage: "none" },
    footerActionText: CARD_TEXT,
    ...(isNativeShell
      ? {
          socialButtons: { display: "none" },
          dividerRow: { display: "none" },
        }
      : {
          socialButtonsBlockButton: LIGHT_BUTTON,
          socialButtonsIconButton: LIGHT_BUTTON,
          alternativeMethodsBlockButton: LIGHT_BUTTON,
        }),
  },
});
