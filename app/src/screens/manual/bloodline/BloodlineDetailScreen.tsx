import { notFound } from "next/navigation";
import ContentDetail from "@/layout/ContentDetail";
import { fetchGuideForBloodline } from "@/queries/guide";
import { getBloodline } from "@/screens/manual/bloodline/BloodlineDetailScreen.metadata";
import { drizzleDB } from "@/server/db";

/** Render the manual bloodline screen independently of its route adapter. */
export async function BloodlineDetailScreen(props: Props) {
  const { bloodlineid } = props.params;
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

type Props = { params: { bloodlineid: string } };
