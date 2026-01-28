"use client";

import { useEffect, use, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import { EditContent } from "@/layout/EditContent";
import { api } from "@/app/_trpc/client";
import { useRequiredUserData } from "@/utils/UserContext";
import { canChangeContent } from "@/utils/permissions";
import { useTowerDefenseCharacterEditForm } from "@/hooks/towerDefenseCharacter";
import { insertTowerDefenseCharacterSchema } from "@/validators/towerDefense";
import { setNullsToEmptyStrings } from "@/utils/typeutils";
import { showMutationToast } from "@/libs/toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload, Image as ImageIcon } from "lucide-react";
import { useUploadThing } from "@/utils/uploadthing";
import Image from "@/layout/Image";
import type { TowerDefenseCharacterDb } from "@/drizzle/schema";
import type { CharacterAnimationState } from "@/validators/towerDefense";

export default function TowerDefenseCharacterEdit(props: {
  params: Promise<{ characterid: string }>;
}) {
  const params = use(props.params);
  const characterId = params.characterid;

  const router = useRouter();
  const { data: userData } = useRequiredUserData();

  // Queries
  const { data, isPending, refetch } = api.towerDefense.getCharacter.useQuery(
    { id: characterId },
    { retry: false, enabled: !!characterId },
  );

  // Convert key null values to empty strings
  setNullsToEmptyStrings(data);

  // Redirect if not content editor
  useEffect(() => {
    if (userData && !canChangeContent(userData.role)) {
      void router.push("/profile");
    }
  }, [userData, router]);

  if (isPending || !userData || !canChangeContent(userData.role) || !data) {
    return <Loader explanation="Loading data" />;
  }

  return <SingleEditCharacter character={data} refetch={refetch} />;
}

interface SingleEditCharacterProps {
  character: TowerDefenseCharacterDb;
  refetch: () => void;
}

const SingleEditCharacter: React.FC<SingleEditCharacterProps> = ({
  character,
  refetch,
}) => {
  const {
    form,
    formData,
    assetConfig,
    isPlayer,
    isUpdating,
    setAssetConfig,
    updateAnimationState,
    updateAnimationSettings,
    handleCharacterSubmit,
    characterAnimationStates,
  } = useTowerDefenseCharacterEditForm(character, refetch);

  const typeLabel = isPlayer ? "Player" : "Enemy";

  return (
    <>
      <ContentBox
        title="Content Panel"
        subtitle={`${typeLabel} Configuration`}
        defaultBackHref="/manual/towerDefense/characters"
      >
        <EditContent
          schema={insertTowerDefenseCharacterSchema}
          form={form}
          formData={formData}
          showSubmit={true}
          buttonTxt="Save to Database"
          type="towerDefenseCharacter"
          relationId={character.id}
          onAccept={handleCharacterSubmit}
        />
        {isUpdating && <Loader explanation="Saving..." />}
      </ContentBox>

      <ContentBox
        title="Character Assets"
        subtitle={`Animation sprites for the ${typeLabel.toLowerCase()}`}
        initialBreak={true}
      >
        <CharacterAssetManager
          characterId={character.id}
          assetConfig={assetConfig}
          setAssetConfig={setAssetConfig}
          updateAnimationState={updateAnimationState}
          updateAnimationSettings={updateAnimationSettings}
          characterAnimationStates={characterAnimationStates}
          onSave={handleCharacterSubmit}
        />
      </ContentBox>
    </>
  );
};

interface CharacterAssetManagerProps {
  characterId: string;
  assetConfig: TowerDefenseCharacterDb["assetConfig"];
  setAssetConfig: (config: TowerDefenseCharacterDb["assetConfig"]) => void;
  updateAnimationState: (index: number, state: CharacterAnimationState) => void;
  updateAnimationSettings: (
    index: number,
    settings: { frameDurationMs?: number; loop?: boolean },
  ) => void;
  characterAnimationStates: readonly CharacterAnimationState[];
  onSave: () => void;
}

const CharacterAssetManager: React.FC<CharacterAssetManagerProps> = ({
  characterId,
  assetConfig,
  setAssetConfig,
  updateAnimationState,
  updateAnimationSettings,
  characterAnimationStates,
  onSave,
}) => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Process zip mutation
  const { mutate: processZip, isPending: isProcessing } =
    api.towerDefense.processCharacterZip.useMutation({
      onSuccess: (data) => {
        showMutationToast(data);
        if (data.success && data.assetConfig) {
          setAssetConfig(data.assetConfig);
        }
      },
      onError: (error) => {
        setUploadError(error.message);
      },
    });

  // Upload handler using uploadthing
  const { startUpload } = useUploadThing("towerDefenseCharacterZip", {
    onClientUploadComplete: (res) => {
      if (res?.[0]?.ufsUrl) {
        processZip({ characterId, zipUrl: res[0].ufsUrl });
      }
      setIsUploading(false);
    },
    onUploadError: (error) => {
      setUploadError(error.message);
      setIsUploading(false);
    },
  });

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (!file.name.endsWith(".zip")) {
        setUploadError("Please select a ZIP file");
        return;
      }

      setUploadError(null);
      setIsUploading(true);
      await startUpload([file], { characterId });
    },
    [startUpload, characterId],
  );

  const isLoading = isUploading || isProcessing;

  return (
    <div className="space-y-6">
      {/* Upload Section */}
      <div className="border rounded-lg p-4 bg-muted/30">
        <h4 className="font-medium mb-2">Upload Character Animation Pack</h4>
        <p className="text-sm text-muted-foreground mb-4">
          Upload a ZIP file containing character sprites with a metadata.json file. The
          ZIP should have the structure:
        </p>
        <pre className="text-xs bg-muted p-2 rounded mb-4 overflow-x-auto">
          {`├── metadata.json
├── rotations/
│   ├── north.png, south.png, ...
└── animations/
    ├── running-6-frames/
    │   ├── north/
    │   │   └── frame_000.png, frame_001.png, ...
    │   └── ...
    └── lead-jab/
        └── ...`}
        </pre>

        <div className="flex items-center gap-4">
          <label className="cursor-pointer">
            <input
              type="file"
              accept=".zip"
              onChange={handleFileSelect}
              className="hidden"
              disabled={isLoading}
            />
            <Button variant="outline" disabled={isLoading} asChild>
              <span>
                <Upload className="mr-2 h-4 w-4" />
                {isLoading ? "Processing..." : "Upload ZIP"}
              </span>
            </Button>
          </label>
          {isLoading && <Loader explanation="Processing..." />}
        </div>

        {uploadError && <p className="text-destructive text-sm mt-2">{uploadError}</p>}
      </div>

      {/* Asset Config Display */}
      {assetConfig ? (
        <div className="space-y-4">
          {/* Rotations Preview */}
          <div>
            <h4 className="font-medium mb-2">Static Rotations</h4>
            <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
              {Object.entries(assetConfig.rotations).map(([direction, url]) => (
                <div key={direction} className="text-center">
                  <div className="aspect-square bg-muted rounded flex items-center justify-center overflow-hidden">
                    {url ? (
                      <Image
                        src={url}
                        alt={direction}
                        width={64}
                        height={64}
                        className="object-contain"
                      />
                    ) : (
                      <ImageIcon className="h-6 w-6 text-muted-foreground" />
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">{direction}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Animations Configuration */}
          <div>
            <h4 className="font-medium mb-2">Animations</h4>
            <div className="space-y-4">
              {assetConfig.animations.map((anim, index) => (
                <div key={anim.name} className="border rounded-lg p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h5 className="font-medium">{anim.name}</h5>
                      <p className="text-xs text-muted-foreground">
                        {Object.values(anim.frames)[0]?.length ?? 0} frames per
                        direction
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`state-${index}`} className="text-sm">
                          State:
                        </Label>
                        <Select
                          value={anim.state}
                          onValueChange={(v) =>
                            updateAnimationState(index, v as CharacterAnimationState)
                          }
                        >
                          <SelectTrigger className="w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {characterAnimationStates.map((state) => (
                              <SelectItem key={state} value={state}>
                                {state}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-4">
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`duration-${index}`} className="text-sm">
                        Frame Duration (ms):
                      </Label>
                      <Input
                        id={`duration-${index}`}
                        type="number"
                        value={anim.frameDurationMs}
                        onChange={(e) =>
                          updateAnimationSettings(index, {
                            frameDurationMs: parseInt(e.target.value) || 100,
                          })
                        }
                        className="w-24"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        id={`loop-${index}`}
                        checked={anim.loop}
                        onCheckedChange={(checked) =>
                          updateAnimationSettings(index, { loop: checked })
                        }
                      />
                      <Label htmlFor={`loop-${index}`} className="text-sm">
                        Loop
                      </Label>
                    </div>
                  </div>

                  {/* Frame preview */}
                  <div className="mt-3">
                    <p className="text-xs text-muted-foreground mb-1">
                      Preview (south):
                    </p>
                    <div className="flex gap-1 overflow-x-auto pb-2">
                      {(anim.frames.south || []).slice(0, 8).map((url, frameIdx) => (
                        <div
                          key={frameIdx}
                          className="w-12 h-12 flex-shrink-0 bg-muted rounded overflow-hidden"
                        >
                          <Image
                            src={url}
                            alt={`Frame ${frameIdx}`}
                            width={48}
                            height={48}
                            className="object-contain w-full h-full"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Save Button */}
          <Button onClick={onSave} className="w-full">
            Save Asset Configuration
          </Button>
        </div>
      ) : (
        <div className="text-center py-8 text-muted-foreground">
          <ImageIcon className="h-12 w-12 mx-auto mb-2 opacity-50" />
          <p>No character assets configured yet.</p>
          <p className="text-sm">Upload a ZIP file to get started.</p>
        </div>
      )}
    </div>
  );
};
