import { ManualAssetsFolderScreen } from "@/screens/manual/asset/ManualAssetsFolderScreen";

export default async function ManualAssetsFolderPage({
  params,
}: {
  params: Promise<{ folder: string }>;
}) {
  return <ManualAssetsFolderScreen params={await params} />;
}
