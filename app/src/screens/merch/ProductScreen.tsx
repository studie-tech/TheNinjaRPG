import { MerchProductPage } from "@/components/merch/MerchProductPage";

/** Render the merch screen independently of its route adapter. */
export async function ProductScreen({ params }: { params: { handle: string } }) {
  const { handle } = params;
  return <MerchProductPage key={handle} handle={handle} />;
}
