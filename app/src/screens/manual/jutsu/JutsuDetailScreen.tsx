import { notFound } from "next/navigation";
import ContentDetail from "@/layout/ContentDetail";
import { getJutsu } from "@/screens/manual/jutsu/JutsuDetailScreen.metadata";

/** Render the manual jutsu screen independently of its route adapter. */
export async function JutsuDetailScreen(props: Props) {
  const { jutsuid } = props.params;
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

type Props = { params: { jutsuid: string } };
