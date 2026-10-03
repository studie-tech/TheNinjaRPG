import { MerchProductPage } from "@/components/merch/MerchProductPage";
import { MERCH_DESIGNS } from "@/libs/merch/catalog";
import { absoluteUrl, buildMetadata, metaDescription } from "@/libs/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const design = MERCH_DESIGNS.find(
    (d) =>
      handle.startsWith(`${d.key}-`) ||
      handle.includes(d.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")),
  );
  return buildMetadata({
    title: design ? `${design.name} merch` : "Merch collection",
    description: design
      ? metaDescription(design.graphic.split(/(?<=[.!?])\s+/)[0] ?? design.name)
      : "Discover The Ninja RPG merch collection.",
    path: `/merch/${encodeURIComponent(handle)}`,
    image: design ? absoluteUrl(design.art) : undefined,
    noindex: !design,
  });
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  return <MerchProductPage key={handle} handle={handle} />;
}
