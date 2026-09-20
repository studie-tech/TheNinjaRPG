"use client";

import { useState } from "react";
import { IMG_BUILDING_ACADEMY } from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import Image from "@/layout/Image";
import QuestPicker from "@/layout/QuestPicker";

export default function Academy() {
  // State
  const [activeElement, setActiveElement] = useState<string>("");

  // Show board
  return (
    <>
      {activeElement === "" && (
        <ContentBox
          title="Academy"
          subtitle="Learning the ropes"
          defaultBackHref="/village"
          padding={false}
        >
          <Image
            alt="academy-image"
            src={IMG_BUILDING_ACADEMY}
            width={512}
            height={195}
            className="w-full"
            priority={true}
          />
        </ContentBox>
      )}
      <QuestPicker
        questType="starter"
        title={activeElement === "" ? "Lessons" : "Academy"}
        subtitle="Learning the ropes"
        initialBreak={activeElement === ""}
        activeQuestId={activeElement}
        setActiveQuestId={setActiveElement}
        defaultBackHref={activeElement === "" ? undefined : "/village"}
      />
    </>
  );
}
