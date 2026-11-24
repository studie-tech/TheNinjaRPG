import { notFound } from "next/navigation";
import ContentDetail from "@/layout/ContentDetail";
import { getItem } from "@/screens/manual/item/ItemDetailScreen.metadata";

/** Render the manual item screen independently of its route adapter. */
export async function ItemDetailScreen(props: Props) {
  const { itemid } = props.params;
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

type Props = { params: { itemid: string } };
