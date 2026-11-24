import type { Metadata } from "next";
import { cache } from "react";
import { buildMetadata, metaDescription, noindexMetadata } from "@/libs/seo";
import { fetchJutsu } from "@/queries/jutsu";
import { drizzleDB } from "@/server/db";
import { capitalizeFirstLetter } from "@/utils/string";

type Props = { params: Promise<{ jutsuid: string }> };

/**
 * Shared between generateMetadata and the render so each request hits the DB once.
 * Hidden entries are treated as missing: `hidden` gates unreleased content to staff
 * (see the canChangeContent check in libs/jutsu.ts), and this route is public, so
 * serving one would disclose it to anyone who guessed the id.
 */
export const getJutsu = cache(async (id: string) => {
  const jutsu = await fetchJutsu(drizzleDB, id);
  return jutsu && !jutsu.hidden ? jutsu : undefined;
});

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { jutsuid } = await props.params;
  const jutsu = await getJutsu(jutsuid);
  if (!jutsu) return noindexMetadata("Jutsu Not Found");
  const name = jutsu.name.trim();
  const type = capitalizeFirstLetter(jutsu.jutsuType);
  return buildMetadata({
    title: `${name} - ${jutsu.jutsuRank} Rank ${type} Jutsu`,
    description: metaDescription(
      jutsu.description,
      `${name} is a ${jutsu.jutsuRank}-rank ${type.toLowerCase()} jutsu in TheNinja-RPG.`,
    ),
    path: `/manual/jutsu/${jutsuid}`,
    image: jutsu.image || undefined,
    type: "article",
  });
}
