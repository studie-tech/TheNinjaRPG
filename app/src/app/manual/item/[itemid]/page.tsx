import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import ContentDetail from "@/layout/ContentDetail";
import { buildMetadata, metaDescription } from "@/libs/seo";
import { fetchItem } from "@/server/api/routers/item";
import { drizzleDB } from "@/server/db";
import { capitalizeFirstLetter } from "@/utils/sanitize";

type Props = { params: Promise<{ itemid: string }> };

// Shared between generateMetadata and the render so each request hits the DB once.
const getItem = cache(async (id: string) => fetchItem(drizzleDB, id));

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { itemid } = await props.params;
  const item = await getItem(itemid);
  if (!item) return { title: "Item Not Found" };
  const name = item.name.trim();
  const type = capitalizeFirstLetter(item.itemType);
  const rarity = capitalizeFirstLetter(item.rarity);
  return buildMetadata({
    title: `${name} - ${rarity} ${type}`,
    description: metaDescription(
      item.description,
      `${name} is a ${rarity.toLowerCase()} ${type.toLowerCase()} in TheNinja-RPG.`,
    ),
    path: `/manual/item/${itemid}`,
    image: item.image || undefined,
    type: "article",
  });
}

export default async function ItemDetail(props: Props) {
  const { itemid } = await props.params;
  const item = await getItem(itemid);
  if (!item) notFound();
  return (
    <ContentDetail
      item={item}
      title={item.name}
      subtitle={`${item.rarity.toLowerCase()} ${item.itemType.toLowerCase()}`}
      backHref="/manual/item"
      showEdit="item"
    />
  );
}
