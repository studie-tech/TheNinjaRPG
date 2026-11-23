"use client";

import {
  IMG_BUILDING_PET_SANCTUARY,
  PET_SANCTUARY_LORE,
  PET_SANCTUARY_NAME,
} from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import Image from "@/layout/Image";
import Loader from "@/layout/Loader";
import { PageStoryScene } from "@/layout/PageStoryScene";
import { PetAcquisition } from "@/layout/PetAcquisition";
import { SystemIntroBanner } from "@/layout/SystemIntroBanner";
import { useRequireInVillage } from "@/utils/UserContext";

/** Village-gated sanctuary entry point, pairing its lore with the adoption workflow. */
export function PetSanctuaryScreen() {
  const { userData, access } = useRequireInVillage("/pets");
  if (!userData) return <Loader explanation="Loading your character..." />;
  if (!access) return <Loader explanation={`Accessing ${PET_SANCTUARY_NAME}...`} />;

  return (
    <>
      <ContentBox
        title={PET_SANCTUARY_NAME}
        subtitle="Form a bond on Wake Island"
        padding={false}
        defaultBackHref="/village"
      >
        <SystemIntroBanner system="pets" className="m-3" />
        <Image
          src={IMG_BUILDING_PET_SANCTUARY}
          alt="The Bondkeeper Sanctuary beneath Wake Island's cedars"
          width={1536}
          height={572}
          className="w-full"
          priority
        />
        <PageStoryScene />
        <details className="p-3 text-sm">
          <summary className="cursor-pointer font-semibold">
            About the sanctuary
          </summary>
          <p className="mt-2 leading-relaxed">{PET_SANCTUARY_LORE}</p>
        </details>
      </ContentBox>
      <PetAcquisition />
    </>
  );
}
