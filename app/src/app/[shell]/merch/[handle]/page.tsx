import { ProductScreen } from "@/screens/merch/ProductScreen";

export { generateMetadata } from "@/screens/merch/ProductScreen.metadata";

export default async function ProductPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  return <ProductScreen params={await params} />;
}
