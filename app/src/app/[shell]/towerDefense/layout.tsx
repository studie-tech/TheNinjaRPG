import type { Metadata } from "next";
import { absoluteUrl, buildMetadata, SITE_URL } from "@/libs/seo";
import {
  TD_LANDING_DESCRIPTION,
  TD_LANDING_FAQ,
  TD_LANDING_TITLE,
} from "@/libs/towerDefense/landing";

export const metadata: Metadata = buildMetadata({
  title: TD_LANDING_TITLE,
  description: TD_LANDING_DESCRIPTION,
  path: "/towerDefense",
});

/** The minigame and its FAQ as schema.org data, in the prerendered HTML crawlers read. */
const JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "VideoGame",
      "@id": `${absoluteUrl("/towerDefense")}#game`,
      name: "Ninja Tower Defense",
      url: absoluteUrl("/towerDefense"),
      description: TD_LANDING_DESCRIPTION,
      genre: ["Tower defense", "Strategy"],
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
      mainEntity: TD_LANDING_FAQ.map((item) => ({
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
