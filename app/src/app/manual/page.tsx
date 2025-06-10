import Image from "next/image";
import Link from "next/link";
import {
  IMG_MANUAL_COMBAT,
  IMG_MANUAL_TRAVEL,
  IMG_MANUAL_BLOODLINE,
  IMG_MANUAL_JUTSU,
  IMG_MANUAL_ITEM,
  IMG_MANUAL_AI,
  IMG_MANUAL_QUEST,
  IMG_MANUAL_LOGS,
  IMG_MANUAL_DAM_CALCS,
  IMG_MANUAL_BADGE,
  IMG_MANUAL_ASSET,
  IMG_MANUAL_OPINION,
  IMG_MANUAL_AWARDS,
  IMG_MANUAL_POLLS,
  IMG_MANUAL_RANKED,
} from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";

export default function ManualMain() {
  const entries = [
    { name: "combat", img: IMG_MANUAL_COMBAT },
    { name: "travel", img: IMG_MANUAL_TRAVEL },
    { name: "bloodline", img: IMG_MANUAL_BLOODLINE },
    { name: "jutsu", img: IMG_MANUAL_JUTSU },
    { name: "item", img: IMG_MANUAL_ITEM },
    { name: "ai", img: IMG_MANUAL_AI },
    { name: "quest", img: IMG_MANUAL_QUEST },
    { name: "logs", img: IMG_MANUAL_LOGS },
    { name: "damage_calcs", img: IMG_MANUAL_DAM_CALCS },
    { name: "badge", img: IMG_MANUAL_BADGE },
    { name: "asset", img: IMG_MANUAL_ASSET },
    { name: "opinions", img: IMG_MANUAL_OPINION },
    { name: "awards", img: IMG_MANUAL_AWARDS },
    { name: "polls", img: IMG_MANUAL_POLLS },
    { name: "ranked", img: IMG_MANUAL_RANKED },
  ];
  return (
    <ContentBox
      title="Game Data & Manual"
      subtitle="Learn about the game & look up data"
    >
      <div className="grid grid-cols-4 gap-4 text-center font-bold">
        {entries.map((page) => (
          <Link
            key={page.name}
            href={`/manual/${page.name}`}
            className="flex flex-col items-center"
          >
            <Image
              className="rounded-2xl border-2 border-black hover:cursor-pointer hover:opacity-50"
              src={page.img}
              alt={page.name}
              width={125}
              height={125}
              priority={true}
            />
            <p>{page.name}</p>
          </Link>
        ))}
      </div>
    </ContentBox>
  );
}
