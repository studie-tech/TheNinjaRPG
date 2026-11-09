import {
  Atom,
  BatteryMedium,
  BicepsFlexed,
  Brain,
  BrainCog,
  Eraser,
  Flame,
  Footprints,
  Grab,
  Heart,
  HeartPulse,
  LoaderPinwheel,
  type LucideIcon,
  Shield,
  Sparkles,
  SquarePlus,
  Sword,
  Swords,
  Zap,
} from "lucide-react";
import type React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  AdjustableBasicAction,
  CombatStatType,
  ElementName,
  GeneralType,
  MasteryType,
  PoolType,
  StatType,
} from "@/drizzle/constants";
import {
  ElementNames,
  IMG_ELEMENT_BOIL,
  IMG_ELEMENT_CRYSTAL,
  IMG_ELEMENT_DUST,
  IMG_ELEMENT_EARTH,
  IMG_ELEMENT_EXPLOSION,
  IMG_ELEMENT_FIRE,
  IMG_ELEMENT_ICE,
  IMG_ELEMENT_LAVA,
  IMG_ELEMENT_LIGHT,
  IMG_ELEMENT_LIGHTNING,
  IMG_ELEMENT_MAGNET,
  IMG_ELEMENT_METAL,
  IMG_ELEMENT_NONE,
  IMG_ELEMENT_SAND,
  IMG_ELEMENT_SCORCH,
  IMG_ELEMENT_SHADOW,
  IMG_ELEMENT_STORM,
  IMG_ELEMENT_WATER,
  IMG_ELEMENT_WIND,
  IMG_ELEMENT_WOOD,
  IMG_ELEMENT_YINYANG,
} from "@/drizzle/constants";
import Image from "@/layout/Image";
import { cn } from "@/libs/shadui";
import { isInArray } from "@/utils/array";
import type { ZodAllTags } from "@/validators/combat";

interface ElementImageProps {
  element:
    | GeneralType
    | StatType
    | CombatStatType
    | MasteryType
    | ElementName
    | PoolType
    | AdjustableBasicAction
    | "None"
    | "All"
    | ZodAllTags["type"];
  hoverText?: string;
  className?: string;
}

const ELEMENT_IMAGES: Record<ElementName, string> = {
  "Yin-Yang": IMG_ELEMENT_YINYANG,
  Shadow: IMG_ELEMENT_SHADOW,
  None: IMG_ELEMENT_NONE,
  Explosion: IMG_ELEMENT_EXPLOSION,
  Wind: IMG_ELEMENT_WIND,
  Water: IMG_ELEMENT_WATER,
  Lava: IMG_ELEMENT_LAVA,
  Ice: IMG_ELEMENT_ICE,
  Wood: IMG_ELEMENT_WOOD,
  Storm: IMG_ELEMENT_STORM,
  Crystal: IMG_ELEMENT_CRYSTAL,
  Magnet: IMG_ELEMENT_MAGNET,
  Fire: IMG_ELEMENT_FIRE,
  Light: IMG_ELEMENT_LIGHT,
  Earth: IMG_ELEMENT_EARTH,
  Scorch: IMG_ELEMENT_SCORCH,
  Dust: IMG_ELEMENT_DUST,
  Sand: IMG_ELEMENT_SAND,
  Lightning: IMG_ELEMENT_LIGHTNING,
  Boil: IMG_ELEMENT_BOIL,
  Metal: IMG_ELEMENT_METAL,
};

/** Return the configured image URL for a supported element name, including None. */
export const getElementImg = (element: ElementName): string => ELEMENT_IMAGES[element];

/** Icon and background colour of each stat, pool, mastery and basic action badge. */
const ICON_BADGES: Partial<
  Record<ElementImageProps["element"], { Icon: LucideIcon; background: string }>
> = {
  basicAttack: { Icon: Swords, background: "bg-blue-600" },
  offensiveStance: { Icon: BicepsFlexed, background: "bg-red-600" },
  defensiveStance: { Icon: BrainCog, background: "bg-blue-600" },
  basicHeal: { Icon: HeartPulse, background: "bg-green-600" },
  meditate: { Icon: Brain, background: "bg-purple-600" },
  clear: { Icon: Eraser, background: "bg-stone-500" },
  cleanse: { Icon: Sparkles, background: "bg-yellow-400" },
  move: { Icon: Footprints, background: "bg-cyan-600" },
  replacementTechnique: { Icon: LoaderPinwheel, background: "bg-orange-500" },
  Taijutsu: { Icon: Grab, background: "bg-green-600" },
  Ninjutsu: { Icon: Zap, background: "bg-amber-500" },
  Genjutsu: { Icon: BrainCog, background: "bg-purple-600" },
  Bukijutsu: { Icon: Sword, background: "bg-red-600" },
  Offence: { Icon: Swords, background: "bg-red-700" },
  Defence: { Icon: Shield, background: "bg-sky-700" },
  Bloodline: { Icon: Heart, background: "bg-rose-600" },
  Sage: { Icon: Sparkles, background: "bg-emerald-600" },
  Strength: { Icon: BicepsFlexed, background: "bg-blue-800" },
  Intelligence: { Icon: Brain, background: "bg-teal-600" },
  Speed: { Icon: Footprints, background: "bg-cyan-600" },
  Willpower: { Icon: Flame, background: "bg-orange-600" },
  Health: { Icon: Heart, background: "bg-red-600" },
  Chakra: { Icon: Atom, background: "bg-blue-600" },
  Stamina: { Icon: BatteryMedium, background: "bg-green-600" },
};

const ElementImage: React.FC<ElementImageProps> = (props) => {
  // Destructure
  const { element, hoverText } = props;

  // Decide what image to show
  let image: React.ReactNode = null;
  if (isInArray(element, ElementNames)) {
    image = (
      <Image
        src={getElementImg(element)}
        width={32}
        height={32}
        alt={element}
        className={props.className}
      />
    );
  } else {
    const base = "rounded-full p-1 text-white";
    if (element === "Highest") {
      return (
        <SquarePlus
          strokeWidth={3}
          className={cn(base, props.className, "bg-stone-500")}
        />
      );
    }
    if (element === "All") {
      image = (
        <LoaderPinwheel
          className={cn(props.className, "rounded-full bg-gray-600 p-1 text-white")}
        />
      );
    } else {
      const badge = Object.hasOwn(ICON_BADGES, element)
        ? ICON_BADGES[element]
        : undefined;
      if (badge) {
        image = (
          <badge.Icon
            strokeWidth={3}
            className={cn(base, props.className, badge.background)}
          />
        );
      }
    }
  }

  // The label renders in a portal: icons sit at the edges of scrolling panels that would clip it.
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div key={element} className="relative">
            {image}
            <span className="sr-only">{hoverText || element}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent className="whitespace-nowrap bg-gray-800 font-bold text-gray-100 text-sm">
          {hoverText || element}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default ElementImage;
