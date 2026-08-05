import { DISCORD_INVITE_URL, IMG_LOGO_FULL } from "@/drizzle/constants";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/libs/seo";

// Profiles Google can use to connect the site to its social presence in the knowledge
// panel. Mirrors the links surfaced in MenuBoxProfile.
const SOCIAL_PROFILES = [
  DISCORD_INVITE_URL,
  "https://twitter.com/RealTheNinjaRPG",
  "https://www.facebook.com/profile.php?id=61554961626034",
  "https://www.instagram.com/theninjarpg/",
  "https://www.tiktok.com/@theninjarpg",
  "https://www.youtube.com/@fullstackscientist",
  "https://www.reddit.com/r/theninjarpg/",
  "https://github.com/studie-tech/TheNinjaRPG",
];

const GRAPH = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "VideoGame",
      "@id": `${SITE_URL}/#game`,
      name: SITE_NAME,
      alternateName: ["The Ninja RPG", "TheNinjaRPG", "Ninja RPG"],
      url: SITE_URL,
      description: SITE_DESCRIPTION,
      image: IMG_LOGO_FULL,
      genre: ["MMORPG", "Role-playing game", "Strategy"],
      gamePlatform: ["Web browser", "PC", "Android", "iOS"],
      applicationCategory: "Game",
      operatingSystem: "Any (browser-based)",
      playMode: "MultiPlayer",
      inLanguage: "en",
      publisher: { "@id": `${SITE_URL}/#organization` },
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
      },
    },
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "Studie-Tech ApS",
      url: SITE_URL,
      logo: IMG_LOGO_FULL,
      sameAs: SOCIAL_PROFILES,
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: SITE_NAME,
      url: SITE_URL,
      description: SITE_DESCRIPTION,
      inLanguage: "en",
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
  ],
};

/**
 * StructuredData
 * - Emits the site-wide schema.org graph. The site previously had no structured data at
 *   all, so Google had nothing to build a knowledge panel or rich result from.
 */
export const StructuredData: React.FC = () => {
  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD has to be injected as raw script content, and GRAPH is a module-level constant with no user input.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(GRAPH) }}
    />
  );
};

export default StructuredData;
