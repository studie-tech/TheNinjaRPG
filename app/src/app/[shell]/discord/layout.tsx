import type { Metadata } from "next";
import { DISCORD_MAX_CHARACTERS_PER_ACCOUNT } from "@/drizzle/constants";
import { absoluteUrl, noindexMetadata, SITE_NAME } from "@/libs/seo";

const TITLE = "Link your Discord account";
const FULL_TITLE = `${TITLE} | ${SITE_NAME}`;
const DESCRIPTION = `Link your TheNinja-RPG character to Discord to unlock the server: Verified Ninja role, village and rank roles, and your character name as nickname. Up to ${DISCORD_MAX_CHARACTERS_PER_ACCOUNT} accounts per Discord.`;

/** Static 1200x630 card shown when /discord/link is shared (e.g. in Discord itself). */
const DISCORD_LINK_OG_IMAGE = {
  url: absoluteUrl("/images/discord-link-og.png"),
  width: 1200,
  height: 630,
  alt: "Link your TheNinja-RPG character to Discord",
};

// Still a utility page that stays out of the index, but it gets shared as a link, so
// it needs its own card instead of inheriting the homepage's title and image.
export const metadata: Metadata = {
  ...noindexMetadata(TITLE),
  description: DESCRIPTION,
  openGraph: {
    title: FULL_TITLE,
    description: DESCRIPTION,
    url: absoluteUrl("/discord/link"),
    siteName: SITE_NAME,
    images: [DISCORD_LINK_OG_IMAGE],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: FULL_TITLE,
    description: DESCRIPTION,
    images: [DISCORD_LINK_OG_IMAGE],
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
