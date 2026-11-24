import { ItemDetailScreen } from "@/screens/manual/item/ItemDetailScreen";

type Props = { params: Promise<{ itemid: string }> };

export { generateMetadata } from "@/screens/manual/item/ItemDetailScreen.metadata";

export default async function ItemDetail(props: Props) {
  return <ItemDetailScreen params={await props.params} />;
}
