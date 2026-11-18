import { IMG_BUILDING_GLOBALANBU } from "@/drizzle/constants";
import { FancyForumThreadsSkeleton } from "@/layout/FancyForumThreads";

export default function GlobalAnbuHQLoading() {
  return (
    <FancyForumThreadsSkeleton
      board_name="ANBU HQ"
      defaultBackHref="/village"
      image={IMG_BUILDING_GLOBALANBU}
    />
  );
}
