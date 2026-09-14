import Link from "next/link";
import type {
  fetchBloodlineCatalog,
  fetchFarmCatalog,
} from "@/server/api/routers/guide";
import { formatSecondsToTimeDisplay } from "@/utils/time";

type FarmRow = Awaited<ReturnType<typeof fetchFarmCatalog>>[number];
type BloodlineRow = Awaited<ReturnType<typeof fetchBloodlineCatalog>>[number];

const TABLE = "w-full border-collapse text-sm";
const TH = "border-b px-2 py-1 text-left font-bold";
const TD = "border-b px-2 py-1 align-top";
const LINK = "font-bold text-orange-500 hover:text-orange-700";

/**
 * Server-rendered tables that give a guide hub the content its category's individual
 * pages used to spread across dozens of stubs. Rendered by the guide route and handed
 * into the client view as a node, so the rows are in the HTML Googlebot receives.
 */
export const FarmCatalog: React.FC<{ rows: FarmRow[] }> = ({ rows }) => {
  if (rows.length === 0) return null;
  return (
    <section className="mt-6">
      <h2 className="font-bold text-xl">Every seed and what it grows</h2>
      <p className="mt-1 text-muted-foreground text-sm">
        From live item data. Level is the farming level needed to plant; cost is the
        shop price of one seed.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className={TABLE}>
          <thead>
            <tr>
              <th className={TH}>Seed</th>
              <th className={TH}>Grows into</th>
              <th className={TH}>Level</th>
              <th className={TH}>Grow time</th>
              <th className={TH}>Seed cost</th>
              <th className={TH}>Rarity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className={TD}>
                  <Link href={`/manual/item/${row.id}`} className={LINK}>
                    {row.name}
                  </Link>
                </td>
                <td className={TD}>
                  {row.yield ? (
                    <Link href={`/manual/item/${row.yield.id}`} className={LINK}>
                      {row.yield.name}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className={TD}>{row.farmMinLevel}</td>
                <td className={TD}>
                  {formatSecondsToTimeDisplay(row.farmGrowTimeSeconds)}
                </td>
                <td className={TD}>{row.cost.toLocaleString("en-US")} ryo</td>
                <td className={TD}>{row.rarity.toLowerCase()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export const BloodlineCatalog: React.FC<{ rows: BloodlineRow[] }> = ({ rows }) => {
  if (rows.length === 0) return null;
  return (
    <section className="mt-6">
      <h2 className="font-bold text-xl">Every bloodline by rank</h2>
      <p className="mt-1 text-muted-foreground text-sm">
        Game data has the numbers for each line; a guide, where one exists, has the
        how-to.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className={TABLE}>
          <thead>
            <tr>
              <th className={TH}>Bloodline</th>
              <th className={TH}>Rank</th>
              <th className={TH}>Guide</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td className={TD}>
                  <Link href={`/manual/bloodline/${row.id}`} className={LINK}>
                    {row.name}
                  </Link>
                </td>
                <td className={TD}>{row.rank}</td>
                <td className={TD}>
                  {row.guideSlug ? (
                    <Link href={`/guide/${row.guideSlug}`} className={LINK}>
                      Read the guide
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};
