import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import ContentDetail from "@/layout/ContentDetail";
import { buildMetadata, metaDescription } from "@/libs/seo";
import { fetchBloodline } from "@/server/api/routers/bloodline";
import { drizzleDB } from "@/server/db";

type Props = { params: Promise<{ bloodlineid: string }> };

// Shared between generateMetadata and the render so each request hits the DB once.
const getBloodline = cache(async (id: string) => fetchBloodline(drizzleDB, id));

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { bloodlineid } = await props.params;
  const bloodline = await getBloodline(bloodlineid);
  if (!bloodline) return { title: "Bloodline Not Found" };
  const name = bloodline.name.trim();
  return buildMetadata({
    title: `${name} - ${bloodline.rank} Rank Bloodline`,
    description: metaDescription(
      bloodline.description,
      `${name} is a ${bloodline.rank}-rank bloodline in TheNinja-RPG.`,
    ),
    path: `/manual/bloodline/${bloodlineid}`,
    image: bloodline.image || undefined,
    type: "article",
  });
}

export default async function BloodlineDetail(props: Props) {
  const { bloodlineid } = await props.params;
  const bloodline = await getBloodline(bloodlineid);
  if (!bloodline) notFound();
  return (
    <ContentDetail
      item={bloodline}
      title={bloodline.name}
      subtitle={`${bloodline.rank} rank bloodline`}
      backHref="/manual/bloodline"
      showEdit="bloodline"
    />
  );
}
