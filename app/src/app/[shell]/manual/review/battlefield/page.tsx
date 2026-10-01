"use client";

import { useEffect } from "react";
import { api } from "@/app/_trpc/client";
import ContentBox from "@/layout/ContentBox";
import { captureBattlefieldSheets } from "@/libs/threejs/battlefieldPreview";
import { battlefieldSheetsSchema } from "@/validators/contentReview";

/**
 * Draws content on the battlefield for the content audit, which opens this page in
 * headless Chrome and calls `window.tnrBattlefield.renderSheets` (see
 * .github/scripts/render-battlefield.mjs). It reads only public asset rows.
 */
export default function BattlefieldCapturePage() {
  const utils = api.useUtils();

  useEffect(() => {
    window.tnrBattlefield = {
      renderSheets: (input) =>
        captureBattlefieldSheets(battlefieldSheetsSchema.parse(input), (ids) =>
          utils.misc.getAllGameAssetNames.fetch({ ids }),
        ),
    };
    return () => {
      delete window.tnrBattlefield;
    };
  }, [utils]);

  return (
    <ContentBox title="Battlefield renders" subtitle="Used by the content audit">
      <p className="text-sm">
        The content audit draws jutsu, item and asset effects here with the combat
        renderer, so it can judge them the way players see them in battle. Staff see the
        same preview on each suggestion in the content review desk.
      </p>
    </ContentBox>
  );
}

declare global {
  interface Window {
    tnrBattlefield?: {
      renderSheets: (input: unknown) => ReturnType<typeof captureBattlefieldSheets>;
    };
  }
}
