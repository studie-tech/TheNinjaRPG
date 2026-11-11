"use client";

import { FilePlus, HelpCircle, Skull, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TowerDefenseCharacterDb } from "@/drizzle/schema";
import ContentBox from "@/layout/ContentBox";
import Image from "@/layout/Image";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { showMutationToast } from "@/libs/toast";
import { canChangeContent } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";

export default function ManualTowerDefenseCharacters() {
  const { data: userData } = useUserData();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"enemies" | "players">("enemies");

  // Fetch characters
  const {
    data: characters,
    isPending,
    refetch,
  } = api.towerDefense.getCharacters.useQuery();

  // Create mutation
  const { mutate: create, isPending: isCreating } =
    api.towerDefense.createCharacter.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success && data.id) {
          router.push(`/manual/towerDefense/characters/edit/${data.id}`);
        }
        await refetch();
      },
    });

  // Delete mutation
  const { mutate: remove, isPending: isDeleting } =
    api.towerDefense.deleteCharacter.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        await refetch();
      },
    });

  const isLoading = isPending || isCreating || isDeleting;
  const canEdit = !!userData && canChangeContent(userData.role);

  // Filter characters by type
  const enemies = characters?.filter((c) => !c.isPlayer) ?? [];
  const players = characters?.filter((c) => c.isPlayer) ?? [];

  return (
    <>
      <ContentBox
        title="Tower Defense Characters"
        subtitle="Character Configuration"
        defaultBackHref="/manual/towerDefense"
      >
        <p className="mb-4">
          Configure character types for the Tower Defense minigame. This includes both
          playable characters and enemy types. Each character can have unique stats,
          scaling factors, and visual assets including animated sprites for different
          movement states.
        </p>
      </ContentBox>

      <ContentBox
        title="Database"
        subtitle="All character definitions"
        initialBreak={true}
      >
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as "enemies" | "players")}
        >
          <div className="mb-4 flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="enemies" className="flex items-center gap-2">
                <Skull className="h-4 w-4" />
                Enemies ({enemies.length})
              </TabsTrigger>
              <TabsTrigger value="players" className="flex items-center gap-2">
                <User className="h-4 w-4" />
                Players ({players.length})
              </TabsTrigger>
            </TabsList>
            {canEdit && (
              <Button
                id="create-character"
                onClick={() => create({ isPlayer: activeTab === "players" })}
                disabled={isCreating}
                loading={isCreating}
              >
                <FilePlus className="mr-2 h-5 w-5" />
                New {activeTab === "players" ? "Player" : "Enemy"}
              </Button>
            )}
          </div>

          {isLoading && <Loader explanation="Loading data" />}

          <TabsContent value="enemies">
            {!isLoading && (
              <CharacterGrid
                characters={enemies}
                emptyText="No enemies configured yet."
                canEdit={canEdit}
                onDelete={(id) => remove({ id })}
              />
            )}
          </TabsContent>

          <TabsContent value="players">
            {!isLoading && (
              <CharacterGrid
                characters={players}
                emptyText="No player characters configured yet."
                canEdit={canEdit}
                onDelete={(id) => remove({ id })}
              />
            )}
          </TabsContent>
        </Tabs>
      </ContentBox>
    </>
  );
}

/** One tab's character cards, or its empty state. */
const CharacterGrid: React.FC<{
  characters: TowerDefenseCharacterDb[];
  emptyText: string;
  canEdit: boolean;
  onDelete: (id: string) => void;
}> = ({ characters, emptyText, canEdit, onDelete }) =>
  characters.length === 0 ? (
    <p className="text-muted-foreground">{emptyText}</p>
  ) : (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {characters.map((character) => (
        <CharacterCard
          key={character.id}
          character={character}
          canEdit={canEdit}
          onDelete={() => onDelete(character.id)}
        />
      ))}
    </div>
  );

interface CharacterCardProps {
  character: TowerDefenseCharacterDb;
  canEdit: boolean;
  onDelete: () => void;
}

const CharacterCard: React.FC<CharacterCardProps> = ({
  character,
  canEdit,
  onDelete,
}) => {
  const [showConfirm, setShowConfirm] = useState(false);

  // Get south-facing static rotation from assetConfig if available
  const southRotationImage = character.assetConfig?.rotations?.south;

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-start gap-3">
        {southRotationImage ? (
          <Image
            src={southRotationImage}
            alt={character.name}
            width={64}
            height={64}
            className="rounded"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded bg-muted text-muted-foreground">
            <HelpCircle className="h-8 w-8" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold">{character.name}</h3>
            {character.isPlayer ? (
              <User className="h-4 w-4 text-blue-500" />
            ) : (
              <Skull className="h-4 w-4 text-red-500" />
            )}
          </div>
        </div>
      </div>

      {!character.isPlayer && (
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-muted-foreground">Health:</span>{" "}
            {character.baseHealth}
          </div>
          <div>
            <span className="text-muted-foreground">Damage:</span>{" "}
            {character.baseDamage}
          </div>
          <div>
            <span className="text-muted-foreground">Speed:</span> {character.baseSpeed}
          </div>
          <div>
            <span className="text-muted-foreground">First Wave:</span>{" "}
            {character.firstAppearWave}
          </div>
        </div>
      )}

      <div className="mt-2 text-muted-foreground text-xs">
        Assets: {character.assetConfig ? "✓ Configured" : "✗ Not configured"}
      </div>

      {canEdit && (
        <div className="mt-3 flex gap-2">
          <Link
            href={`/manual/towerDefense/characters/edit/${character.id}`}
            className="flex-1"
          >
            <Button variant="outline" size="sm" className="w-full">
              Edit
            </Button>
          </Link>
          {showConfirm ? (
            <>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  onDelete();
                  setShowConfirm(false);
                }}
              >
                Confirm
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowConfirm(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setShowConfirm(true)}>
              Delete
            </Button>
          )}
        </div>
      )}
    </div>
  );
};
