import React from "react";
import Image from "next/image";
import { isInArray } from "@/utils/array";
import { Grab, Swords, HeartPulse, Eraser, Sparkles, Rabbit } from "lucide-react";
import { Zap } from "lucide-react";
import { BrainCog } from "lucide-react";
import { Sword } from "lucide-react";
import { LoaderPinwheel } from "lucide-react";
import { SquarePlus } from "lucide-react";
import { BicepsFlexed } from "lucide-react";
import { Brain } from "lucide-react";
import { Flame } from "lucide-react";
import { Footprints } from "lucide-react";
import { Heart } from "lucide-react";
import { BatteryMedium } from "lucide-react";
import { Atom } from "lucide-react";
import { cn } from "src/libs/shadui";
import {
  IMG_ELEMENT_YINYANG,
  IMG_ELEMENT_SHADOW,
  IMG_ELEMENT_NONE,
  IMG_ELEMENT_EXPLOSION,
  IMG_ELEMENT_WIND,
  IMG_ELEMENT_WATER,
  IMG_ELEMENT_LAVA,
  IMG_ELEMENT_ICE,
  IMG_ELEMENT_WOOD,
  IMG_ELEMENT_STORM,
  IMG_ELEMENT_CRYSTAL,
  IMG_ELEMENT_MAGNET,
  IMG_ELEMENT_FIRE,
  IMG_ELEMENT_LIGHT,
  IMG_ELEMENT_EARTH,
  IMG_ELEMENT_SCORCH,
  IMG_ELEMENT_DUST,
  IMG_ELEMENT_SAND,
  IMG_ELEMENT_LIGHTNING,
  IMG_ELEMENT_BOIL,
  IMG_ELEMENT_METAL,
} from "@/drizzle/constants";

import {
  GeneralTypes,
  StatTypes,
  PoolTypes,
  ElementNames,
  AdjustableBasicActions,
} from "@/drizzle/constants";
import type {
  GeneralType,
  StatType,
  PoolType,
  ElementName,
  AdjustableBasicAction,
} from "@/drizzle/constants";
import type { ZodAllTags } from "@/libs/combat/types";

interface ElementImageProps {
  element:
    | GeneralType
    | StatType
    | ElementName
    | PoolType
    | AdjustableBasicAction
    | "All"
    | ZodAllTags["type"];
  hoverText?: string;
  className?: string;
}

export const getElementImg = (element: ElementName): string => {
  switch (element) {
    case "Yin-Yang":
      return IMG_ELEMENT_YINYANG;
    case "Shadow":
      return IMG_ELEMENT_SHADOW;
    case "None":
      return IMG_ELEMENT_NONE;
    case "Explosion":
      return IMG_ELEMENT_EXPLOSION;
    case "Wind":
      return IMG_ELEMENT_WIND;
    case "Water":
      return IMG_ELEMENT_WATER;
    case "Lava":
      return IMG_ELEMENT_LAVA;
    case "Ice":
      return IMG_ELEMENT_ICE;
    case "Wood":
      return IMG_ELEMENT_WOOD;
    case "Storm":
      return IMG_ELEMENT_STORM;
    case "Crystal":
      return IMG_ELEMENT_CRYSTAL;
    case "Magnet":
      return IMG_ELEMENT_MAGNET;
    case "Fire":
      return IMG_ELEMENT_FIRE;
    case "Light":
      return IMG_ELEMENT_LIGHT;
    case "Earth":
      return IMG_ELEMENT_EARTH;
    case "Scorch":
      return IMG_ELEMENT_SCORCH;
    case "Dust":
      return IMG_ELEMENT_DUST;
    case "Sand":
      return IMG_ELEMENT_SAND;
    case "Lightning":
      return IMG_ELEMENT_LIGHTNING;
    case "Boil":
      return IMG_ELEMENT_BOIL;
    case "Metal":
      return IMG_ELEMENT_METAL;
  }
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
  } else if (
    isInArray(element, [
      ...StatTypes,
      ...GeneralTypes,
      ...PoolTypes,
      ...AdjustableBasicActions,
      "All",
    ])
  ) {
    const base = "rounded-full p-1 text-white";
    switch (element) {
      case "basicAttack":
        image = (
          <Swords
            strokeWidth={3}
            className={cn(base, props.className, "bg-blue-600")}
          />
        );
        break;
      case "basicHeal":
        image = (
          <HeartPulse
            strokeWidth={3}
            className={cn(base, props.className, "bg-green-600")}
          />
        );
        break;
      case "clear":
        image = (
          <Eraser
            strokeWidth={3}
            className={cn(base, props.className, "bg-stone-500")}
          />
        );
        break;
      case "cleanse":
        image = (
          <Sparkles
            strokeWidth={3}
            className={cn(base, props.className, "bg-yellow-400")}
          />
        );
        break;
      case "flee":
        image = (
          <Rabbit
            strokeWidth={3}
            className={cn(base, props.className, "bg-pink-400")}
          />
        );
        break;
      case "move":
        image = (
          <Footprints
            strokeWidth={3}
            className={cn(base, props.className, "bg-cyan-600")}
          />
        );
        break;
      case "Highest":
        return (
          <SquarePlus
            strokeWidth={3}
            className={cn(base, props.className, "bg-stone-500")}
          />
        );
        break;
      case "Taijutsu":
        image = (
          <Grab strokeWidth={3} className={cn(base, props.className, "bg-green-600")} />
        );
        break;
      case "Ninjutsu":
        image = (
          <Zap strokeWidth={3} className={cn(base, props.className, "bg-amber-500")} />
        );
        break;
      case "Genjutsu":
        image = (
          <BrainCog
            strokeWidth={3}
            className={cn(base, props.className, "bg-purple-600")}
          />
        );
        break;
      case "Bukijutsu":
        image = (
          <Sword strokeWidth={3} className={cn(base, props.className, "bg-red-600")} />
        );
        break;
      case "Strength":
        image = (
          <BicepsFlexed
            strokeWidth={3}
            className={cn(base, props.className, "bg-blue-800")}
          />
        );
        break;
      case "Intelligence":
        image = (
          <Brain strokeWidth={3} className={cn(base, props.className, "bg-teal-600")} />
        );
        break;
      case "Speed":
        image = (
          <Footprints
            strokeWidth={3}
            className={cn(base, props.className, "bg-cyan-600")}
          />
        );
        break;
      case "Willpower":
        image = (
          <Flame
            strokeWidth={3}
            className={cn(base, props.className, "bg-orange-600")}
          />
        );
        break;
      case "Health":
        image = (
          <Heart strokeWidth={3} className={cn(base, props.className, "bg-red-600")} />
        );
        break;
      case "Chakra":
        image = (
          <Atom strokeWidth={3} className={cn(base, props.className, "bg-blue-600")} />
        );
        break;
      case "Stamina":
        image = (
          <BatteryMedium
            strokeWidth={3}
            className={cn(base, props.className, "bg-green-600")}
          />
        );
        break;
      case "All":
        image = (
          <LoaderPinwheel
            className={cn(props.className, "bg-gray-600 rounded-full p-1 text-white")}
          />
        );
        break;
    }
  }

  return (
    <div key={element} className="relative">
      {image}
      <span className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-50 rounded-md bg-gray-800 p-2 text-sm font-bold text-gray-100 opacity-0 transition-opacity hover:opacity-100 whitespace-nowrap">
        {hoverText || element}
      </span>
    </div>
  );
};

export default ElementImage;
