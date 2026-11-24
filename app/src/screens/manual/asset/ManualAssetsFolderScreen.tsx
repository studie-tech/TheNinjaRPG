import { redirect } from "next/navigation";

/** Keep bookmarked folder links in the unified, searchable library. */
export async function ManualAssetsFolderScreen({
  params,
}: {
  params: { folder: string };
}): Promise<never> {
  const { folder } = params;
  // Route parameters are re-encoded by Next; decode once before encoding the query value.
  return redirect(
    `/manual/asset?${new URLSearchParams({ folder: decodeURIComponent(folder) })}`,
  );
}
