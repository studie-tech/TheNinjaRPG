import { MerchCollection } from "@/components/merch/MerchCollection";
import { buildMetadata } from "@/libs/seo";

export const metadata = buildMetadata({
  title: "Your merch bag",
  description: "Review your selected merchandise and quantities.",
  path: "/merch/cart",
  noindex: true,
});

export default function MerchCartPage() {
  return <MerchCollection />;
}
