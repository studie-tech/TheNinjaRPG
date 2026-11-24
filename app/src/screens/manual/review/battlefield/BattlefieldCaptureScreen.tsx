"use client";

import { useEffect } from "react";
import { api } from "@/app/_trpc/client";
import ContentBox from "@/layout/ContentBox";
import { getDefaultBattleSizes } from "@/libs/combat/util";
import {
  battlefieldSceneOf,
  sceneAssetIds,
  sceneSoundIds,
} from "@/libs/contentReview/battlefield";
import {
  captureBattlefieldSheets,
  createBattlefieldPreview,
} from "@/libs/rendering/scenes/battlefieldPreview";
import { battlefieldSheetsSchema } from "@/validators/contentReview";

/**
 * Draws content on the battlefield for the content audit, which opens this page in
 * headless Chrome and calls `window.tnrBattlefield.renderSheets` (see
 * .github/scripts/render-battlefield.mjs). It reads only public asset rows.
 */
export function BattlefieldCaptureScreen() {
  const utils = api.useUtils();

  useEffect(() => {
    window.tnrBattlefield = {
      renderSheets: (input) =>
        captureBattlefieldSheets(battlefieldSheetsSchema.parse(input), (ids) =>
          utils.misc.getAllGameAssetNames.fetch({ ids }),
        ),
      createPreview: async (input, viewport = "desktop", reverse = false) => {
        const parsed = battlefieldSheetsSchema.parse(input);
        const request = parsed.requests[0];
        const variant = request?.variants[0];
        if (!request || !variant) throw new Error("A battlefield variant is required");
        const scene = battlefieldSceneOf(
          request.entityType,
          request.entityId,
          variant.fields,
        );
        if (!scene) throw new Error("This content has no battlefield scene");
        const assets = await utils.misc.getAllGameAssetNames.fetch({
          ids: [...new Set([...sceneAssetIds(scene), ...sceneSoundIds(scene)])],
        });
        return createBattlefieldPreview({
          scene,
          assets,
          viewport,
          background: parsed.background,
          holdMs: 700,
          targeting: reverse
            ? {
                ...getDefaultBattleSizes("COMBAT", Number.MAX_SAFE_INTEGER),
                caster: { col: 9, row: 5 },
                target: { col: 2, row: 5 },
              }
            : undefined,
        });
      },
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
      /** A caller-owned live canvas for motion review and browser video recording. */
      createPreview: (
        input: unknown,
        viewport?: "desktop" | "phone",
        reverse?: boolean,
      ) => ReturnType<typeof createBattlefieldPreview>;
    };
  }
}
