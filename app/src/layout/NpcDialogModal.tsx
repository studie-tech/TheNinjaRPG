"use client";

import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { IMG_SCENE_BACKGROUND } from "@/drizzle/constants";
import { QuestDialogScene } from "@/layout/Logbook";
import Modal from "@/layout/Modal";

/**
 * A conversation with a character on the map: the scene with their words, over the map they
 * stand on, and the answers the player can give.
 */
export const NpcDialogModal = ({
  title = "NPC Dialog",
  dialog,
  characters,
  answers,
  isPending,
  onClose,
}: {
  title?: string;
  /** The words and the game assets of the scene. */
  dialog: {
    description?: string | null;
    sceneBackground?: string;
    sceneCharacters?: string[];
  };
  /** Pictures of who speaks, in place of the scene's own characters. */
  characters?: string[];
  answers: { text: string; choose: () => void }[];
  isPending: boolean;
  onClose: () => void;
}) => {
  const assetIds = [
    dialog.sceneBackground ?? "",
    ...(dialog.sceneCharacters ?? []),
  ].filter(Boolean);
  const { data: assets } = api.gameAsset.getSceneAssets.useQuery(
    { assetIds },
    { enabled: assetIds.length > 0 },
  );
  return (
    <Modal
      isOpen
      setIsOpen={(open) => {
        if (!open) onClose();
      }}
      title={title}
    >
      <div className="flex flex-col gap-3 p-2">
        <QuestDialogScene
          background={
            assets?.find((asset) => asset.type === "SCENE_BACKGROUND")?.image ??
            IMG_SCENE_BACKGROUND
          }
          characters={
            characters ??
            assets
              ?.filter((asset) => asset.type === "SCENE_CHARACTER")
              .map((asset) => asset.image) ??
            []
          }
          description={dialog.description}
        />
        <div id="tutorial-npc-answers" className="flex flex-col gap-3">
          {answers.map((answer, index) => (
            <Button
              key={`${index}-${answer.text}`}
              type="button"
              variant="info"
              disabled={isPending}
              className="h-auto w-full justify-start text-left whitespace-normal"
              onClick={answer.choose}
            >
              {answer.text}
            </Button>
          ))}
        </div>
      </div>
    </Modal>
  );
};
