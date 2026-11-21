import type { Metadata } from "next";
import { CS_OG_IMAGE_URL } from "@/drizzle/constants";
import {
  CS_LANDING_DESCRIPTION,
  CS_LANDING_FAQ,
  CS_LANDING_TITLE,
} from "@/libs/chakraStorm/landing";
import { absoluteUrl, buildMetadata, SITE_URL } from "@/libs/seo";

export const metadata: Metadata = buildMetadata({
  title: CS_LANDING_TITLE,
  description: CS_LANDING_DESCRIPTION,
  path: "/chakraStorm",
  image: CS_OG_IMAGE_URL,
});

/** The minigame and its FAQ as schema.org data, in the prerendered HTML crawlers read. */
const JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "VideoGame",
      "@id": `${absoluteUrl("/chakraStorm")}#game`,
      name: "Chakra Storm",
      url: absoluteUrl("/chakraStorm"),
      description: CS_LANDING_DESCRIPTION,
      image: CS_OG_IMAGE_URL,
      genre: ["Survivors-like", "Action", "Roguelite"],
      gamePlatform: ["Web browser"],
      applicationCategory: "Game",
      operatingSystem: "Any (browser-based)",
      playMode: "SinglePlayer",
      inLanguage: "en",
      isPartOf: { "@id": `${SITE_URL}/#game` },
      publisher: { "@id": `${SITE_URL}/#organization` },
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
      },
    },
    {
      "@type": "FAQPage",
      mainEntity: CS_LANDING_FAQ.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: { "@type": "Answer", text: item.answer },
      })),
    },
  ],
}).replace(/</g, "\\u003c");

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD is escaped so `<` cannot close the script tag.
        dangerouslySetInnerHTML={{ __html: JSON_LD }}
      />
      {children}
    </>
  );
}
