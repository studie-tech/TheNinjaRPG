import { GITHUB_REPO_URL, IMG_LOGO_FULL, SOCIAL_LINKS } from "@/drizzle/constants";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/libs/seo";

// Profiles Google can use to connect the site to its social presence in the knowledge panel.
const SOCIAL_PROFILES = [...SOCIAL_LINKS.map((link) => link.url), GITHUB_REPO_URL];

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
 * Emits the shared schema.org graph so search engines can identify the game,
 * publisher and website for knowledge panels and rich results.
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
