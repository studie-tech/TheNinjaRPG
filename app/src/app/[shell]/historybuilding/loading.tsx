import { IMG_BUILDING_ARCHIVE } from "@/drizzle/constants";
import { FancyForumThreadsSkeleton } from "@/layout/FancyForumThreads";

export default function HistoryBuildingLoading() {
  return (
    <FancyForumThreadsSkeleton
      board_name="History"
      defaultBackHref="/village"
      image={IMG_BUILDING_ARCHIVE}
    />
  );
}
