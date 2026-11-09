import { buildJutsuEquipCaps } from "@/libs/jutsu";
export const equipLimitFixture = [
  { category: "residual", unrankedMaxEquipped: 4, rankedMaxEquipped: 4 },
  { category: "event", unrankedMaxEquipped: 2, rankedMaxEquipped: 2 },
  { category: "forbidden", unrankedMaxEquipped: 1, rankedMaxEquipped: 1 },
  { category: "barrier", unrankedMaxEquipped: 1, rankedMaxEquipped: 1 },
  { category: "stun", unrankedMaxEquipped: 2, rankedMaxEquipped: 2 },
  { category: "shield", unrankedMaxEquipped: 2, rankedMaxEquipped: 2 },
  { category: "heal", unrankedMaxEquipped: 3, rankedMaxEquipped: 3 },
  { category: "parry", unrankedMaxEquipped: 1, rankedMaxEquipped: 1 },
  { category: "poison", unrankedMaxEquipped: null, rankedMaxEquipped: 1 },
  { category: "increasepoolcost", unrankedMaxEquipped: null, rankedMaxEquipped: 1 },
  { category: "summon", unrankedMaxEquipped: null, rankedMaxEquipped: 0 },
];
export const unrankedCaps = buildJutsuEquipCaps(equipLimitFixture, "unranked");
export const rankedCaps = buildJutsuEquipCaps(equipLimitFixture, "ranked");
