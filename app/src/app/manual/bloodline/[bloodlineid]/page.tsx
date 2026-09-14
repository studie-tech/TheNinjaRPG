import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import ContentDetail from "@/layout/ContentDetail";
import { buildMetadata, metaDescription } from "@/libs/seo";
import { fetchBloodline } from "@/server/api/routers/bloodline";
import { fetchGuideForBloodline } from "@/server/api/routers/guide";
import { drizzleDB } from "@/server/db";

type Props = { params: Promise<{ bloodlineid: string }> };

/**
 * Shared between generateMetadata and the render so each request hits the DB once.
 * Hidden entries are treated as missing: `hidden` gates unreleased content to staff,
 * and this route is public, so serving one would disclose it to anyone with the id.
 */
const getBloodline = cache(async (id: string) => {
  const bloodline = await fetchBloodline(drizzleDB, id);
  return bloodline && !bloodline.hidden ? bloodline : undefined;
});

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
  // The guide lookup keys on the id, not on the bloodline row, so it needs no result
  // from the first query and the two can share a round-trip.
  const [bloodline, guide] = await Promise.all([
    getBloodline(bloodlineid),
    fetchGuideForBloodline(drizzleDB, bloodlineid),
  ]);
  if (!bloodline) notFound();
  return (
    <ContentDetail
      item={bloodline}
      title={bloodline.name}
      subtitle={`${bloodline.rank} rank bloodline`}
      backHref="/manual/bloodline"
      showEdit="bloodline"
      guide={guide ? { href: `/guide/${guide.slug}`, title: guide.title } : undefined}
    />
  );
}
