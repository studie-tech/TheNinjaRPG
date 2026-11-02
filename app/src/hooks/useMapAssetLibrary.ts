import { api } from "@/app/_trpc/client";

/** Keep player artwork cached between content notifications, with foreground recovery for missed edits. */
export const useMapAssetLibrary = (enabled: boolean) =>
  api.mapAsset.getAll.useQuery(undefined, {
    enabled,
    // The map-content subscription refreshes edits; authoring views also invalidate this key on save.
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    gcTime: Infinity,
    // Dates defeat structural sharing; scenes consume only the asset content.
    select: (rows) => rows.map(({ createdAt, updatedAt, ...rest }) => rest),
    notifyOnChangeProps: ["data"],
  });
