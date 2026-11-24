import { MAP_WAR_TORN_BATTLEGROUND_SECTOR } from "@/drizzle/constants";
import { useCachedTerritoryWar } from "@/hooks/useTerritoryWarNotice";
import Link from "@/layout/Link";
import { useUserInfo } from "@/utils/UserContext";

/**
 * Where wins advance the `pvp_kills` objectives of `pvp` quests, as
 * `killObjectiveCountsForQuest` enforces it. Other quest types count wins anywhere or only
 * in wars. Inline content, so it fits both objective cards and dialog descriptions.
 */
export const PvpWinLocations = () => {
  const { timeDiff } = useUserInfo();
  const war = useCachedTerritoryWar(timeDiff);
  return (
    <>
      Wins only count in the War-Torn Battleground (
      <SectorLink sector={MAP_WAR_TORN_BATTLEGROUND_SECTOR} />) or against players in
      {war ? " the active " : " an active "}
      <Link className={LINK_CLASSES} href="/territory-war">
        Territory War
      </Link>
      {war ? (
        <>
          {" "}
          (<SectorLink sector={war.sector} />)
        </>
      ) : (
        " sector"
      )}
      .
    </>
  );
};

const SectorLink = ({ sector }: { sector: number }) => (
  <Link
    className={`${LINK_CLASSES} whitespace-nowrap`}
    href={`/travel?sector=${sector}`}
    aria-label={`Auto travel to sector ${sector}`}
  >
    sector {sector}
  </Link>
);

const LINK_CLASSES = "text-orange-600 underline dark:text-orange-400";
