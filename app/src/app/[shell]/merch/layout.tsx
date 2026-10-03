import { MerchProvider } from "@/components/merch/MerchProvider";
import { buildMetadata } from "@/libs/seo";

export const metadata = buildMetadata({
  title: "Merch",
  path: "/merch",
  description:
    "Wear your village. Carry the lore. Discover The Ninja RPG collection, inspired by Seichi, legendary bloodlines and our community.",
});

export default function MerchLayout({ children }: { children: React.ReactNode }) {
  return <MerchProvider>{children}</MerchProvider>;
}
