import { IMG_BUILDING_NEWS } from "@/drizzle/constants";
import { FancyForumThreadsSkeleton } from "@/layout/FancyForumThreads";

export default function NewsLoading() {
  return <FancyForumThreadsSkeleton board_name="News" image={IMG_BUILDING_NEWS} />;
}
