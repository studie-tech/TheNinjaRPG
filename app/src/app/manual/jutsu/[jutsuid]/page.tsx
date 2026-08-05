import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import ContentDetail from "@/layout/ContentDetail";
import { buildMetadata, metaDescription } from "@/libs/seo";
import { fetchJutsu } from "@/server/api/routers/jutsu";
import { drizzleDB } from "@/server/db";
import { capitalizeFirstLetter } from "@/utils/sanitize";

type Props = { params: Promise<{ jutsuid: string }> };

// Shared between generateMetadata and the render so each request hits the DB once.
const getJutsu = cache(async (id: string) => fetchJutsu(drizzleDB, id));

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { jutsuid } = await props.params;
  const jutsu = await getJutsu(jutsuid);
  if (!jutsu) return { title: "Jutsu Not Found" };
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

export default async function JutsuDetail(props: Props) {
  const { jutsuid } = await props.params;
  const jutsu = await getJutsu(jutsuid);
  if (!jutsu) notFound();
  return (
    <ContentDetail
      item={jutsu}
      title={jutsu.name}
      subtitle={`${jutsu.jutsuRank} rank ${jutsu.jutsuType.toLowerCase()} jutsu`}
      backHref="/manual/jutsu"
      showEdit="jutsu"
    />
  );
}
