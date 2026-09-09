import {
  BLOODLINE_COST,
  COST_SWAP_BLOODLINE,
  CoreVillages,
  FARM_PLOT_PURCHASE_COST,
  FARMING_MAX_LEVEL,
  type GuideCategory,
  HOSPITAL_BASE_HEAL_SECONDS,
  IMG_MANUAL_BLOODLINE,
  IMG_MANUAL_COMBAT,
  IMG_MANUAL_ITEM,
  IMG_MANUAL_JUTSU,
  IMG_MANUAL_TRAVEL,
  MAP_WAKE_ISLAND_SECTOR,
  RANKS_RESTRICTED_FROM_PVP,
  REGEN_SECONDS,
  REMOVAL_COST,
  ROLL_CHANCE_PERCENTAGE,
} from "@/drizzle/constants";
import { COMBAT_SECONDS } from "@/libs/combat/constants";
import { GUIDE_SYSTEM_COVERS } from "@/libs/guide/covers";
import type { GuideFaqItem } from "@/validators/guide";

const cover = (slug: string, fallback?: string) =>
  GUIDE_SYSTEM_COVERS[slug] ?? fallback;

export interface GuideSeedArticle {
  slug: string;
  title: string;
  subtitle: string;
  excerpt: string;
  seoTitle: string;
  seoDescription: string;
  category: GuideCategory;
  content: string;
  image?: string;
  faq?: GuideFaqItem[];
  sortOrder: number;
  published: boolean;
  sourceUrl?: string;
  reviewNotes?: string;
}

const p = (...paragraphs: string[]) =>
  paragraphs.map((text) => `<p>${text}</p>`).join("");
const h2 = (text: string) => `<h2>${text}</h2>`;
const h3 = (text: string) => `<h3>${text}</h3>`;
const ul = (items: string[]) =>
  `<ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>`;
const link = (href: string, label: string) => `<a href="${href}">${label}</a>`;

const villageList = CoreVillages.join(", ");
const pvpRestricted = RANKS_RESTRICTED_FROM_PVP.join(" and ");
const rollPct = `S ${ROLL_CHANCE_PERCENTAGE.S * 100}%, A ${ROLL_CHANCE_PERCENTAGE.A * 100}%, B ${ROLL_CHANCE_PERCENTAGE.B * 100}%, C ${ROLL_CHANCE_PERCENTAGE.C * 100}%`;

export const SYSTEM_GUIDE_ARTICLES: GuideSeedArticle[] = [
  {
    slug: "getting-started",
    title: "Getting Started in TheNinja-RPG",
    subtitle: "Your first hour in Seichi",
    excerpt:
      "Create your ninja, finish the academy tutorial, train, buy a starter weapon and take the Genin exam.",
    seoTitle: "TheNinja-RPG Getting Started",
    seoDescription:
      "How to play TheNinja-RPG: create a ninja, finish the academy tutorial, train stats, buy gear and rank up to Genin in Seichi.",
    category: "getting-started",
    image: cover("getting-started", IMG_MANUAL_COMBAT),
    sortOrder: 1,
    published: true,
    sourceUrl: "https://the-ninja-rpg.fandom.com/wiki/Getting_Started",
    faq: [
      {
        question: "Is TheNinja-RPG free to play?",
        answer:
          "Yes. TheNinja-RPG is a free browser game. Reputation points and federal support are optional.",
      },
      {
        question: "Where do I roll a bloodline?",
        answer:
          "Travel the globe to Wake Island and use the science building. You get free rolls as a new character.",
      },
      {
        question: "When can I fight other players?",
        answer: `${pvpRestricted} ranks are restricted from PvP. Rank up to Chunin before open PvP matters.`,
      },
    ],
    content: [
      p(
        `TheNinja-RPG is a free ninja browser game set in the world of Seichi. This getting started guide is the official first-party walkthrough: create a character, finish the in-game tutorial, then take the Genin exam.`,
      ),
      h2("Create your ninja"),
      p(
        `Register and pick a name, appearance and starter village. The five core villages are ${villageList}. You begin as a Student in Horizon's academy; the tutorial will walk you through profile, stats, the arena and travel before the Genin exam.`,
      ),
      h2("The academy tutorial"),
      p(
        `Lemu guides you through your profile, assigning experience, a dummy fight in the ${link("/battlearena", "battle arena")}, ${link("/traininggrounds", "training grounds")}, the item shop, a practise mission on the globe, and a tour of village buildings. You can skip steps, but finishing the flow unlocks the Genin exam in the academy.`,
      ),
      h2("Train and spend ryo"),
      ul([
        `Train offensive taijutsu (or another offence) in short 15-minute bouts when you can.`,
        `Train a first jutsu from the training grounds list. Rank and elements gate later techniques.`,
        `Buy starter weapons such as shuriken in the village item shop.`,
        `Bank spare ryo so it is not lost if you are defeated.`,
      ]),
      h2("Wake Island and bloodlines"),
      p(
        `Use ${link("/travel", "Travel")} to open the globe and visit Wake Island (sector ${MAP_WAKE_ISLAND_SECTOR}). The science building lets you roll or buy a bloodline. See ${link("/guide/bloodlines", "bloodlines")} and ${link("/guide/wake-island", "Wake Island")} for costs and ranks.`,
      ),
      h2("Rank up to Genin"),
      p(
        `When the academy offers the Genin exam, take it. Genin unlocks more missions, jutsu and the option to join one of the major villages. ${pvpRestricted} cannot start open PvP; focus on training, missions and the arena until Chunin.`,
      ),
      h2("Where to go next"),
      ul([
        `${link("/guide/combat", "Combat guide")} — rounds, action points and loadouts.`,
        `${link("/guide/ranks", "Ranks")} — what each rank unlocks.`,
        `${link("/guide/farming", "Farming")} — plots, seeds and herbs.`,
        `${link("/manual", "Game data")} — jutsu, items and bloodline stats.`,
      ]),
    ].join(""),
  },
  {
    slug: "combat",
    title: "Combat in TheNinja-RPG",
    subtitle: "Rounds, action points and initiative",
    excerpt:
      "Hex-based turn combat: 60-second rounds, action points, initiative and how to fight on the battlefield.",
    seoTitle: "TheNinja-RPG Combat Guide",
    seoDescription:
      "How combat works in TheNinja-RPG: 60-second rounds, action points, initiative, movement and basic attacks on the hex battlefield.",
    category: "combat",
    image: cover("combat", IMG_MANUAL_COMBAT),
    sortOrder: 10,
    published: true,
    sourceUrl: "https://the-ninja-rpg.fandom.com/wiki/Combat",
    faq: [
      {
        question: "How long is a combat round?",
        answer: `Each combatant has ${COMBAT_SECONDS} seconds to spend action points on their turn.`,
      },
      {
        question: "Where can I test damage formulas?",
        answer:
          "Use the damage calculator in the game data manual. It is a tool, not this how-to guide.",
      },
    ],
    content: [
      p(
        `Combat in TheNinja-RPG is turn-based on a hex battlefield. The highest initiative acts first. Each action costs action points, so a single round can include a move, an attack and a wait.`,
      ),
      h2("Rounds and action points"),
      p(
        `You have ${COMBAT_SECONDS} seconds on your turn. Spend action points on movement, basic attacks, equipped jutsu and items, or end the turn. If you run out of points to attack, use End Turn and click your own character.`,
      ),
      h2("Initiative"),
      p(`Initiative starts as a roll from 1 to 20, then these modifiers apply:`),
      ul([
        "About 3% bonus for each level you are above the defender.",
        "10% bonus in your own village territory.",
        "10% penalty outside your territory.",
        "A decaying bonus for consecutive PvP kills.",
      ]),
      h2("The battlefield"),
      p(
        `Move adjacent to an opponent before a melee basic attack. Select Move, click a hex, then select Basic Attack and click the enemy. Jutsu and items have their own range, cost and tags — see ${link("/guide/combat-tags", "game tags")} and ${link("/manual/combat", "combat data")}.`,
      ),
      h2("Practice safely"),
      ul([
        `${link("/battlearena", "Battle arena")} — dummies, NPC arena, pyramids and ranked PvP.`,
        `${link("/guide/loadout-building", "Loadout building")} — what to equip before a fight.`,
        `${link("/manual/damage_calcs", "Damage calculator")} — theory-craft without risking a hospital stay.`,
      ]),
      h2("After the fight"),
      p(
        `If you are hospitalized, wait or pay for treatment. Base hospital time is ${HOSPITAL_BASE_HEAL_SECONDS} seconds before medical ninjas and boosts. Regen ticks every ${REGEN_SECONDS} seconds when you are out of combat. Sleep at ${link("/home", "home")} to stay safe from PvP.`,
      ),
    ].join(""),
  },
  {
    slug: "combat-tags",
    title: "Game Tags in TheNinja-RPG",
    subtitle: "What jutsu and items actually do",
    excerpt:
      "A player-facing glossary of combat tags: damage, shields, heals, prevents, cleanses and more.",
    seoTitle: "TheNinja-RPG Game Tags",
    seoDescription:
      "Every combat tag in TheNinja-RPG explained: damage, pierce, stun, cleanse, shield and the prevent family. Link through to live jutsu data.",
    category: "combat",
    image: cover("combat-tags", IMG_MANUAL_JUTSU),
    sortOrder: 11,
    published: true,
    sourceUrl: "https://the-ninja-rpg.fandom.com/wiki/Game_Tags",
    content: [
      p(
        `Tags are the effects on jutsu, items, bloodlines and skill-tree nodes. The encyclopedia pages under ${link("/manual/jutsu", "jutsu")} and ${link("/manual/item", "items")} list the live numbers. This guide explains what the names mean.`,
      ),
      h2("Offence and defence"),
      ul([
        "<strong>damage</strong> — hit-point loss, scaled by stats, elements and advantages.",
        "<strong>pierce</strong> — damage that ignores some mitigation.",
        "<strong>shield</strong> — a temporary HP pool that absorbs hits.",
        "<strong>heal</strong> — restore health (or other pools when specified).",
        "<strong>lifesteal / vamp</strong> — return a share of damage as health, with a shared leech cap.",
      ]),
      h2("Control"),
      ul([
        "<strong>stun</strong> — skip or restrict actions.",
        "<strong>seal</strong> — block jutsu of matching types.",
        "<strong>move / moveprevent</strong> — force or freeze hex movement.",
        "<strong>disarm</strong> — stop weapon attacks.",
      ]),
      h2("Prevents, cleanse and clear"),
      p(
        `Prevent tags stop a family of effects from applying. Cleanse removes negative effects; clear removes positive ones. See ${link("/guide/prevent-tags", "prevent tags")}, ${link("/guide/cleansable-tags", "cleansable tags")} and ${link("/guide/clearable-tags", "clearable tags")}.`,
      ),
      h2("Look up live data"),
      p(
        `Do not trust old wiki damage tables. Open the matching ${link("/manual/jutsu", "jutsu")} or ${link("/manual/item", "item")} page for current power, rounds and costs.`,
      ),
    ].join(""),
  },
  {
    slug: "prevent-tags",
    title: "Prevent Tags",
    subtitle: "Stopping buffs, heals, movement and more",
    excerpt: "Prevent tags block a family of combat effects for a number of rounds.",
    seoTitle: "TheNinja-RPG Prevent Tags",
    seoDescription:
      "Prevent tags in TheNinja-RPG stop buffs, debuffs, heals, movement, seals and summons. Use them to shut down a loadout.",
    category: "combat",
    sortOrder: 12,
    published: true,
    sourceUrl: "https://the-ninja-rpg.fandom.com/wiki/Prevent_Tags",
    content: [
      p(
        `A prevent tag stops one family of effects from applying while it lasts. Power and rounds come from the jutsu or item — always check ${link("/manual/jutsu", "game data")}.`,
      ),
      h2("Prevent families"),
      ul([
        "buffprevent, debuffprevent",
        "healprevent, moveprevent, fleeprevent",
        "stunprevent, sealprevent, summonprevent",
        "cleanseprevent, clearprevent",
        "robprevent, onehitkillprevent, disarm",
      ]),
      p(
        `Immunity and absorb are related but not the same: they reduce or convert incoming damage instead of blocking a tag type. Pair prevents with ${link("/guide/loadout-building", "loadout building")} so you are not locked out of your own win condition.`,
      ),
    ].join(""),
  },
  {
    slug: "cleansable-tags",
    title: "Cleansable Tags",
    subtitle: "What cleanse can remove",
    excerpt:
      "Cleanse strips harmful effects. Use it when poisons, stuns and stat drops would lose the round.",
    seoTitle: "TheNinja-RPG Cleansable Tags",
    seoDescription:
      "What the cleanse tag removes in TheNinja-RPG combat, and when to press it instead of attacking.",
    category: "combat",
    sortOrder: 13,
    published: true,
    sourceUrl: "https://the-ninja-rpg.fandom.com/wiki/Cleansable_Tags",
    content: [
      p(
        `Cleanse removes harmful effects from the target (usually yourself). It does not restore health on its own and it does not remove shields or buffs — that is ${link("/guide/clearable-tags", "clear")}.`,
      ),
      h2("When to cleanse"),
      ul([
        "A poison or wound will out-damage your next hit.",
        "A stun or seal would skip the jutsu you need this round.",
        "A stat drop has collapsed your damage below a kill threshold.",
      ]),
      p(
        `Cleanseprevent stops this. If the enemy stacked prevent, attacking through the debuff can be better than wasting the action. Live jutsu that cleanse are listed under ${link("/manual/jutsu", "jutsu data")}.`,
      ),
    ].join(""),
  },
  {
    slug: "clearable-tags",
    title: "Clearable Tags",
    subtitle: "What clear can remove",
    excerpt:
      "Clear strips helpful effects from an opponent: buffs, shields and regeneration.",
    seoTitle: "TheNinja-RPG Clearable Tags",
    seoDescription:
      "What the clear tag removes in TheNinja-RPG: enemy buffs, shields and other helpful combat effects.",
    category: "combat",
    sortOrder: 14,
    published: true,
    sourceUrl: "https://the-ninja-rpg.fandom.com/wiki/Clearable_Tags",
    content: [
      p(
        `Clear removes helpful effects from the opponent. Use it against stacked stat buffs, shields and heal-over-time. It is the opposite of ${link("/guide/cleansable-tags", "cleanse")}.`,
      ),
      h2("When to clear"),
      ul([
        "The opponent just shielded and your next hit would only tickle the barrier.",
        "A damage-given buff will let them one-round you.",
        "You already applied your own win-condition tags and need their mitigation gone.",
      ]),
      p(
        `Clearprevent blocks this. Check ${link("/manual/jutsu", "jutsu data")} for current clear power and rounds rather than old wiki tables.`,
      ),
    ].join(""),
  },
  {
    slug: "combat-tag-priority",
    title: "Combat Tag Priority",
    subtitle: "Why order of effects matters",
    excerpt:
      "Effects apply in a defined order each round. Priority decides shields, damage ramps and prevents.",
    seoTitle: "TheNinja-RPG Tag Priority",
    seoDescription:
      "How TheNinja-RPG applies combat tags in order: shields, damage modifiers, prevents and residual effects.",
    category: "combat",
    sortOrder: 15,
    published: true,
    sourceUrl: "https://the-ninja-rpg.fandom.com/wiki/Combat_Tag_Priority_List",
    content: [
      p(
        `Every round, TheNinja-RPG applies ground and user effects in a stable order. That order is why a shield can eat a hit that a later heal cannot save, and why a prevent might land before the buff it was meant to stop.`,
      ),
      h2("How to use this as a player"),
      ul([
        "Apply your own setup tags (buffs, binds, weakness) before the big damage jutsu.",
        "Expect enemy shields and absorbs to resolve against the hit that triggers them.",
        `Do not theory-craft from a copied wiki table — open ${link("/manual/damage_calcs", "the damage calculator")} and ${link("/manual/combat", "combat data")}.`,
      ]),
      p(
        `Copy and mirror jutsu use their own priority tiers so stolen tags do not outrun the original kit. Those lists live in game constants and change with balance patches.`,
      ),
    ].join(""),
  },
  {
    slug: "loadout-building",
    title: "Combat Fundamentals: Loadout Building",
    subtitle: "What to equip before you queue",
    excerpt:
      "Build a loadout around one win condition: offence, control or sustain — then fill gaps with items.",
    seoTitle: "TheNinja-RPG Loadout Guide",
    seoDescription:
      "How to build a TheNinja-RPG combat loadout: pick a win condition, fill jutsu slots, and add items that cover your gaps.",
    category: "combat",
    sortOrder: 16,
    published: true,
    sourceUrl:
      "https://the-ninja-rpg.fandom.com/wiki/Combat_Fundamentals:_Loadout_Building",
    content: [
      p(
        `A loadout is the jutsu, items and bloodline you take into a fight. Start from one sentence: “I win by bursting”, “I win by locking them down”, or “I win by outlasting”. Everything else is support.`,
      ),
      h2("Pick a win condition"),
      ul([
        "Burst — high damage and pierce; accept a weak late round.",
        "Control — stun, seal, move and prevent so their kit never fires.",
        "Sustain — heal, shield, cleanse and lifesteal to win the last exchange.",
      ]),
      h2("Fill the gaps"),
      p(
        `Every kit needs a way to close distance, a way to survive a bad initiative roll, and a way to spend leftover action points. Items cover what jutsu do not. Browse ${link("/manual/item", "items")} and ${link("/manual/jutsu", "jutsu")} after you pick the bloodline from ${link("/guide/bloodlines", "bloodlines")}.`,
      ),
      h2("Test before ranked"),
      p(
        `Use the arena dummy and ${link("/manual/damage_calcs", "damage calculator")} before you spend a ranked ticket. ${link("/guide/ai-rules", "AI rules")} can fight for you once the loadout is stable.`,
      ),
    ].join(""),
  },
  {
    slug: "ai-rules",
    title: "AI Rule Set",
    subtitle: "Let your profile fight for you",
    excerpt:
      "Custom AI rules pick jutsu from conditions such as range, health and combo order.",
    seoTitle: "TheNinja-RPG AI Rules",
    seoDescription:
      "How TheNinja-RPG combat AI rules work: distance checks, self-heal conditions, combo order and when to take control.",
    category: "combat",
    sortOrder: 17,
    published: true,
    sourceUrl: "https://the-ninja-rpg.fandom.com/wiki/AI_Rule_Set",
    content: [
      p(
        `Every character has an AI profile that can fight automatically. Rules are condition → action pairs evaluated in order. The default set already moves you into range; custom rules are for potions, pierce, heals and combo order.`,
      ),
      h2("Write rules the way you play"),
      ul([
        "First: if distance is higher than your melee range, move toward the closest opponent.",
        "Then: if your health is low, use a self-targeted heal or potion (set the target to self).",
        "Then: fire tagged jutsu in the order you would click them.",
      ]),
      p(
        `The AI cannot break targeting rules. A ground or self jutsu will not fire on an opponent-targeted action. During the tutorial you can press Take control to fight manually — see ${link("/guide/combat", "combat")}.`,
      ),
    ].join(""),
  },
  {
    slug: "raids",
    title: "Raid Guidelines",
    subtitle: "Multiplayer PvE in Seichi",
    excerpt: "Open and exclusive raids, tailed-beast hunts and how to show up ready.",
    seoTitle: "TheNinja-RPG Raid Guide",
    seoDescription:
      "How raids work in TheNinja-RPG: open versus exclusive raids, preparing a loadout, and fighting tailed beasts with your village.",
    category: "combat",
    sortOrder: 18,
    published: true,
    sourceUrl: "https://the-ninja-rpg.fandom.com/wiki/Raid_Guidelines",
    content: [
      p(
        `Raids are multiplayer PvE encounters on the globe. Open raids let anyone join; exclusive raids are gated. Rewards and spawn rules change with events — treat this page as the how-to, not a loot table.`,
      ),
      h2("Before you join"),
      ul([
        `Bring a ${link("/guide/loadout-building", "loadout")} that can survive a long fight, not only a PvP opener.`,
        "Stock ramen and hospital money. A wipe still sends you to the hospital.",
        "Read the village notice board so you are not late to a timed spawn.",
      ]),
      p(
        `Show up on the correct sector, accept the encounter, and follow the same ${link("/guide/combat", "combat")} rules as any other battle. Staff post current raid windows in ${link("/news", "news")}.`,
      ),
    ].join(""),
  },
  {
    slug: "bracket-system",
    title: "Bracket System",
    subtitle: "XP brackets and PvP protection",
    excerpt:
      "Experience brackets gate PvP matchups. Attacking lifts your immunity for a few minutes.",
    seoTitle: "TheNinja-RPG Bracket System",
    seoDescription:
      "How TheNinja-RPG XP brackets work: PvP protection by experience, war flags, and what happens when you initiate an attack.",
    category: "combat",
    sortOrder: 19,
    published: true,
    sourceUrl: "https://the-ninja-rpg.fandom.com/wiki/Bracket_System",
    content: [
      p(
        `Open PvP uses experience brackets so a late-game ninja cannot farm brand-new accounts. ${pvpRestricted} sit outside normal PvP. Higher ranks are grouped by total experience.`,
      ),
      h2("Immunity and initiating"),
      p(
        `If you start an attack, your bracket immunity lifts for a few minutes. War participation also flags you for a longer window. Sleep at ${link("/home", "home")} or stay in protected buildings when you do not want the fight.`,
      ),
      p(
        `Ranked PvP and tournaments have their own queues — see ${link("/manual/pvp_rank", "ranked standings")} and ${link("/guide/combat", "combat")}.`,
      ),
    ].join(""),
  },
  {
    slug: "farming",
    title: "Farming in TheNinja-RPG",
    subtitle: "Plots, seeds, water and extractors",
    excerpt:
      "Level farming to 100, buy extra plots, water crops and extract seeds from harvests.",
    seoTitle: "TheNinja-RPG Farming Guide",
    seoDescription:
      "How farming works in TheNinja-RPG: plots, watering, seed extractors, crop tiers and the level 100 cap.",
    category: "farming",
    image: cover("farming", IMG_MANUAL_ITEM),
    sortOrder: 20,
    published: true,
    sourceUrl: "https://the-ninja-rpg.fandom.com/wiki/Farming",
    faq: [
      {
        question: "What is the farming level cap?",
        answer: `Farming levels to ${FARMING_MAX_LEVEL}. Extra plots unlock on a level interval after level 10.`,
      },
      {
        question: "How much is an extra plot?",
        answer: `An extra plot costs ${FARM_PLOT_PURCHASE_COST} ryo once you meet the level requirement.`,
      },
    ],
    content: [
      p(
        `Farming is a gathering occupation on your homestead. Plant seeds, water them through four growth stages, harvest herbs, and optionally extract more seeds. Numbers below come from live game constants and will change if staff rebalance the activity.`,
      ),
      h2("Plots and level"),
      ul([
        `Farming levels to ${FARMING_MAX_LEVEL}.`,
        `Extra plots cost ${FARM_PLOT_PURCHASE_COST} ryo and require at least level 10, then more plots on a level interval.`,
        `Seed extractors unlock at levels 10, 55 and 100 (up to three).`,
      ]),
      h2("The loop"),
      ul([
        "Buy or extract seeds from the farm shop.",
        "Plant, water (watering grants experience), and wait out the growth stages.",
        "Harvest herbs. Sell extras or use them in crafting.",
        "Run harvests through an extractor when you want more seeds instead of raw crops.",
      ]),
      p(
        `Herb names and rarities live on ${link("/manual/item", "item data")} and in ${link("/guide", "this guide")} when a plant has its own page. Open ${link("/occupation", "Jobs")} to start farming.`,
      ),
    ].join(""),
  },
  {
    slug: "villages",
    title: "Villages of Seichi",
    subtitle: "The five core villages and later settlements",
    excerpt:
      "Shirohana, Tsukimori, Hyorin, Akasumi and Akikaze are the core villages. Join one after the Genin exam.",
    seoTitle: "TheNinja-RPG Villages",
    seoDescription:
      "TheNinja-RPG villages in Seichi: Shirohana, Tsukimori, Hyorin, Akasumi, Akikaze and later settlements. How joining a village works.",
    category: "villages",
    image: cover("villages", IMG_MANUAL_TRAVEL),
    sortOrder: 30,
    published: true,
    sourceUrl: "https://the-ninja-rpg.fandom.com/wiki/Villages",
    content: [
      p(
        `After the Genin exam you can join a major village. The five core villages are <strong>${villageList}</strong>. Treat leftover wiki names for retired or renamed settlements as lore, not the live roster.`,
      ),
      h2("What a village gives you"),
      ul([
        "A walled sector on the globe, town hall, arena, shops and hospital.",
        "Alliances and wars decided by the kage and elders.",
        "Village-specific quests, notices and sometimes exclusive bloodlines.",
      ]),
      h2("How to join"),
      p(
        `Finish ${link("/guide/getting-started", "getting started")} and the Genin exam in the academy. Village choice is part of ranking up. You can later become an outlaw or change allegiance through game systems — check ${link("/townhall", "Town Hall")} for the current alliance map.`,
      ),
      p(
        `Lore pages for each village will appear under this category as they are rewritten. Mechanical buildings are covered in the in-game tutorial and on ${link("/village", "the village map")}.`,
      ),
    ].join(""),
  },
  {
    slug: "world",
    title: "Travel and the World of Seichi",
    subtitle: "Sectors, the globe and Wake Island",
    excerpt:
      "Move hex by hex on a sector, or open the globe to travel between countries and villages.",
    seoTitle: "TheNinja-RPG Travel Guide",
    seoDescription:
      "How travel works in TheNinja-RPG: sector hexes, the global map of Seichi, Wake Island and staying safe in the wild.",
    category: "world",
    image: cover("world", IMG_MANUAL_TRAVEL),
    sortOrder: 31,
    published: true,
    content: [
      p(
        `Seichi is a hex world. Local travel moves you tile by tile inside a sector. Global travel opens the globe so you can tap another sector — including other villages and ${link("/guide/wake-island", "Wake Island")}.`,
      ),
      h2("Local sector"),
      p(
        `Players, quest markers and patrols share the same sector view. Sleeping or sitting in your ${link("/home", "home")} keeps you off the PvP list. ${pvpRestricted} are already PvP-restricted; higher ranks should scout before training in the open.`,
      ),
      h2("Global map"),
      p(
        "Open Travel → Global to see countries and village markers. Quest markers on the globe are the same ones the academy tutorial uses.",
      ),
    ].join(""),
  },
  {
    slug: "wake-island",
    title: "Wake Island",
    subtitle: "Where bloodlines are rolled",
    excerpt:
      "Travel to Wake Island to roll or buy a bloodline at the science building.",
    seoTitle: "TheNinja-RPG Wake Island",
    seoDescription:
      "Wake Island in TheNinja-RPG is where you roll or buy a bloodline. Free starter rolls, prices by rank, and how to get there.",
    category: "world",
    image: cover("wake-island", IMG_MANUAL_BLOODLINE),
    sortOrder: 32,
    published: true,
    content: [
      p(
        `Wake Island is the bloodline clinic. On the globe it is sector ${MAP_WAKE_ISLAND_SECTOR}. New characters receive free rolls; extra rolls and instant purchases spend reputation.`,
      ),
      h2("Ranks and prices"),
      p(
        `Bloodlines are letter-ranked D through S (plus H in data). Purchase prices in reputation are D ${BLOODLINE_COST.D}, C ${BLOODLINE_COST.C}, B ${BLOODLINE_COST.B}, A ${BLOODLINE_COST.A}. S-rank lines are event-gated, not a shop item. Removal costs ${REMOVAL_COST} reputation. A later swap costs ${COST_SWAP_BLOODLINE} reputation subject to cooldown.`,
      ),
      h2("Roll odds"),
      p(
        `A random roll uses weighted chances (${rollPct}; the remainder is D). Pity can apply. Full names and effects are on ${link("/guide/bloodlines", "bloodlines")} and ${link("/manual/bloodline", "bloodline data")}.`,
      ),
    ].join(""),
  },
  {
    slug: "bloodlines",
    title: "Bloodlines in TheNinja-RPG",
    subtitle: "D-rank starters to S-rank event lines",
    excerpt:
      "Bloodlines add jutsu, elements and combat tags. Roll them on Wake Island or buy most ranks with reputation.",
    seoTitle: "TheNinja-RPG Bloodlines",
    seoDescription:
      "TheNinja-RPG bloodlines by rank: how to roll on Wake Island, reputation prices, and where to read each line's jutsu.",
    category: "bloodlines",
    image: cover("bloodlines", IMG_MANUAL_BLOODLINE),
    sortOrder: 40,
    published: true,
    sourceUrl: "https://the-ninja-rpg.fandom.com/wiki/Bloodlines",
    faq: [
      {
        question: "Can I buy an S-rank bloodline?",
        answer:
          "No. S-rank bloodlines are event-limited. D through A can be purchased for reputation on Wake Island.",
      },
    ],
    content: [
      p(
        `A bloodline is a inherited kit: extra jutsu, elements and passive tags. You can play without one, but most endgame loadouts assume you have rolled or bought a line on ${link("/guide/wake-island", "Wake Island")}.`,
      ),
      h2("Ranks"),
      ul([
        "D — starter-friendly offence lines.",
        "C — often elemental specialists.",
        "B and A — the competitive default; some A lines are village-flavoured.",
        "S — event only, no shop price that matters.",
      ]),
      h2("How to get one"),
      p(
        `Travel to Wake Island, then roll or buy. Prices: D ${BLOODLINE_COST.D}, C ${BLOODLINE_COST.C}, B ${BLOODLINE_COST.B}, A ${BLOODLINE_COST.A} reputation. Removing a line costs ${REMOVAL_COST}. Swapping later costs ${COST_SWAP_BLOODLINE} subject to cooldown. Each line's stats stay on ${link("/manual/bloodline", "bloodline data")}; this guide adds how-to and playstyle pages per line when they exist.`,
      ),
    ].join(""),
  },
  {
    slug: "ranks",
    title: "Ranks and Progression",
    subtitle: "Student to Elite Jonin",
    excerpt:
      "Student, Genin, Chunin, Jonin and Elite Jonin gate missions, PvP and village politics.",
    seoTitle: "TheNinja-RPG Ranks",
    seoDescription:
      "TheNinja-RPG ranks explained: Student, Genin, Chunin, Jonin and Elite Jonin — what each rank unlocks and who can PvP.",
    category: "ranks",
    sortOrder: 50,
    published: true,
    faq: [
      {
        question: "Who is locked out of PvP?",
        answer: `${pvpRestricted} cannot participate in open PvP.`,
      },
    ],
    content: [
      p(
        `Rank is not the same as level. Level comes from experience; rank is an exam (or equivalent) that unlocks systems. The live rank list is Student, Genin, Chunin, Jonin, Elite Jonin, plus Elder and None for special accounts.`,
      ),
      h2("What changes at each rank"),
      ul([
        "<strong>Student</strong> — academy, tutorial, dummy fights. No open PvP.",
        "<strong>Genin</strong> — more missions and jutsu, village join, still no open PvP.",
        "<strong>Chunin</strong> — open PvP, clans, harder missions, leaving the village.",
        "<strong>Jonin / Elite Jonin</strong> — high-end PvP, politics, kage challenges.",
      ]),
      p(
        `Exam requirements are quest content and can change. Take them from the academy or mission hall when your logbook says you are ready. Old unofficial manuals that mention “150 defence and 6 intelligence” are Core 3 — ignore them.`,
      ),
    ].join(""),
  },
  {
    slug: "economy",
    title: "Ryo, Bank and Reputation",
    subtitle: "The two currencies you will actually use",
    excerpt:
      "Earn ryo from missions and combat, bank it for interest, and spend reputation on bloodlines and cosmetics.",
    seoTitle: "TheNinja-RPG Economy",
    seoDescription:
      "How money works in TheNinja-RPG: ryo, the village bank, reputation points and the ryo shop.",
    category: "economy",
    sortOrder: 60,
    published: true,
    content: [
      p(
        `Ryo is the everyday currency: shops, hospital, farm plots, clan costs. Reputation is the premium currency: bloodlines, some black-market goods and cosmetics. Federal support is a subscription tier, not a third wallet you farm.`,
      ),
      h2("Ryo"),
      ul([
        "Earn it from missions, arena, PvP, quests and selling loot.",
        `Keep a reserve for the hospital (about ${HOSPITAL_BASE_HEAL_SECONDS} seconds of base recovery if you cannot pay a medic).`,
        `Bank the rest. Interest accrues on deposited ryo; unbanked ryo is what you risk in the field.`,
      ]),
      h2("Reputation"),
      p(
        `Buy reputation, earn it from events, or trade ryo for it in the ${link("/blackmarket", "black market")} ryo shop. Bloodline prices are on ${link("/guide/wake-island", "Wake Island")}. ${link("/guide/auction-house", "Auction house guidelines")} cover community material prices — they are norms, not hard-coded.`,
      ),
    ].join(""),
  },
  {
    slug: "auction-house",
    title: "Auction House Guidelines",
    subtitle: "Community price norms",
    excerpt:
      "Suggested material price tiers. These are player norms, not server-enforced numbers.",
    seoTitle: "TheNinja-RPG Auction House",
    seoDescription:
      "TheNinja-RPG auction house guidelines: community material price tiers, not hard-coded shop prices.",
    category: "economy",
    sortOrder: 61,
    published: true,
    sourceUrl: "https://the-ninja-rpg.fandom.com/wiki/Auction_House_Guidelines",
    reviewNotes:
      "Price tiers are community norms and go stale. Keep published but expect staff to edit numbers.",
    content: [
      p(
        `The auction house is a player market. Recommended tiers on the old wiki were community etiquette, not a server price floor. Staff should update this page when the market shifts; do not treat any ryo figure here as a game constant.`,
      ),
      h2("How to use the market"),
      ul([
        "Compare recent sales before undercutting by an order of magnitude.",
        "Crafted and event materials swing harder than shop-bought consumables.",
        `${link("/guide/item-variants", "Item variants")} are cosmetics — price them like cosmetics.`,
      ]),
      p(`Look up official item stats on ${link("/manual/item", "item data")}.`),
    ].join(""),
  },
  {
    slug: "item-variants",
    title: "Item Variants",
    subtitle: "Cosmetic reskins of existing items",
    excerpt:
      "Variants change how an item looks. Stats stay on the base item in the encyclopedia.",
    seoTitle: "TheNinja-RPG Item Variants",
    seoDescription:
      "Item variants in TheNinja-RPG are cosmetic reskins. Stats stay on the base item; unlocks use variant tokens.",
    category: "economy",
    sortOrder: 62,
    published: true,
    sourceUrl: "https://the-ninja-rpg.fandom.com/wiki/Item_Variants",
    content: [
      p(
        `An item variant is a cosmetic skin. Combat tags, rank and cost stay on the base item. Unlocking a locked variant spends a variant token or the currency listed on that item.`,
      ),
      p(
        `Browse base items on ${link("/manual/item", "item data")}. Do not copy old wiki pages titled “Item Varients” — that spelling is a duplicate stub.`,
      ),
    ].join(""),
  },
];
