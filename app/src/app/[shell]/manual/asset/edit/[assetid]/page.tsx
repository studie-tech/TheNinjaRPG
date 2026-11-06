"use client";

import { FolderOpen, Pause, Play } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, use, useState } from "react";
import { type UseFormReturn, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import type { UserRole } from "@/drizzle/constants";
import type { GameAsset } from "@/drizzle/schema";
import { useAssetEditForm } from "@/hooks/asset";
import { useRequireRole } from "@/hooks/useRequireRole";
import ContentBox from "@/layout/ContentBox";
import { EditContent } from "@/layout/EditContent";
import {
  AssetPreviewBackgroundControls,
  GameAssetPreview,
} from "@/layout/GameAssetPreview";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { LpcAssetEditor } from "@/layout/LpcAssetEditor";
import { SuggestChange } from "@/layout/SuggestChange";
import { assetTypeLabels, getAssetLibraryReturnTo } from "@/libs/assetLibrary";
import { canChangeContent, canSuggestContent } from "@/utils/permissions";
import type { ZodGameAssetType } from "@/validators/asset";
import { gameAssetValidator } from "@/validators/asset";

/** Gate editing by staff permissions and provide recoverable loading/not-found states. */
export default function AssetEdit(props: { params: Promise<{ assetid: string }> }) {
  const { assetid } = use(props.params);
  const { userData, hasAccess } = useRequireRole(canOpenAssetEditor);
  const { data, isPending, error, refetch } = api.gameAsset.get.useQuery({
    id: assetid,
  });

  if (error) {
    return (
      <ContentBox title="Asset unavailable" defaultBackHref="/manual/asset">
        <p role="alert">
          {error.data?.code === "NOT_FOUND"
            ? "This asset no longer exists. Return to the library to choose another asset."
            : "The asset could not be loaded. Try again or return to the library."}
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" onClick={() => void refetch()}>
            Try again
          </Button>
          <Button asChild>
            <Link href="/manual/asset">Back to library</Link>
          </Button>
        </div>
      </ContentBox>
    );
  }
  if (isPending || !userData || !hasAccess || !data)
    return <Loader explanation="Loading asset" />;

  return (
    <Suspense fallback={<Loader explanation="Loading asset editor" />}>
      <SingleEditAsset
        key={data.id}
        asset={data}
        refetch={refetch}
        canSave={canChangeContent(userData.role)}
      />
    </Suspense>
  );
}

/** Share one validated form across media/details sections and preserve library context. */
function SingleEditAsset({
  asset,
  refetch,
  canSave,
}: {
  asset: GameAsset;
  refetch: () => Promise<unknown>;
  canSave: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const returnTo = getAssetLibraryReturnTo(params.get("returnTo"));
  const returnToLibrary = () => {
    // History length cannot prove the previous route. Match it before restoring scroll;
    // direct links and browsers without the Navigation API replace with the safe fallback.
    const navigation = window.navigation;
    const previous = navigation?.entries()[(navigation.currentEntry?.index ?? 0) - 1];
    if (previous?.url === new URL(returnTo, window.location.origin).href) {
      router.back();
    } else {
      router.replace(returnTo);
    }
  };
  const { form, formData, handleAssetSubmit, isUpdating, saveError } = useAssetEditForm(
    asset,
    refetch,
  );
  const [isPreparing, setIsPreparing] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [background, setBackground] = useState<"light" | "dark" | "checkerboard">(
    "dark",
  );
  const [name, image, type, frames, speed] = useWatch({
    control: form.control,
    name: ["name", "image", "type", "frames", "speed"],
  });
  const sharedForm = form as unknown as UseFormReturn<ZodGameAssetType, unknown>;
  // Both sections use the same controller; only Details renders the submit form.
  const mediaFields = formData
    .filter((field) => field.type === "avatar" || field.type === "audio")
    .map((field) => ({ ...field, fullWidth: true }));
  const detailFields = formData.filter(
    (field) => field.type !== "avatar" && field.type !== "audio",
  );

  return (
    <ContentBox
      title={canSave ? "Edit asset" : "Suggest asset changes"}
      subtitle={asset.name}
      defaultBackHref={returnTo}
      onBack={returnToLibrary}
      backDisabled={isUpdating || isPreparing}
      noBorder
      padding={false}
    >
      <div className="mt-4 space-y-4">
        <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="bg-secondary text-secondary-foreground rounded-md px-2 py-1 text-xs font-medium">
            {assetTypeLabels[type]}
          </span>
          <Button
            variant="ghost"
            disabled={isUpdating || isPreparing}
            onClick={returnToLibrary}
            className="text-primary gap-1.5"
          >
            <FolderOpen className="size-4" />
            Back to library
          </Button>
        </div>
        {type === "LPC" && (
          <LpcAssetEditor
            id={asset.id}
            name={name}
            form={form}
            disabled={isUpdating || !canSave}
            onBusyChange={setIsPreparing}
          />
        )}
        {type !== "LPC" && (
          <section
            className="border-border bg-background/70 rounded-xl border p-4 sm:p-5"
            aria-labelledby="asset-media-heading"
          >
            <h3 id="asset-media-heading" className="text-lg font-semibold">
              Media
            </h3>
            <p className="text-muted-foreground mt-1 mb-4 text-sm">
              {type === "ANIMATION"
                ? "Upload a vertical sprite sheet, then set its frame count and speed below."
                : type === "SFX" || type === "MUSIC"
                  ? "Choose or generate audio. You can listen before saving."
                  : "Upload, replace or generate the artwork for this asset."}
            </p>
            <EditContent
              schema={gameAssetValidator}
              form={sharedForm}
              formData={mediaFields}
              showSubmit={false}
              submitLoading={isUpdating || isPreparing}
              fieldsOnly
              type="asset"
              relationId={asset.id}
              allowImageUpload={canSave}
            />
            {type === "ANIMATION" && (
              <div className="mx-auto mt-4 max-w-xs space-y-2">
                <GameAssetPreview
                  asset={{
                    name,
                    image,
                    type,
                    frames: Number(frames),
                    speed: Number(speed),
                  }}
                  play={playing}
                  background={background}
                  className="rounded-lg"
                />
                <AssetPreviewBackgroundControls
                  value={background}
                  onChange={setBackground}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-full gap-2"
                  onClick={() => setPlaying(!playing)}
                >
                  {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
                  {playing ? "Pause preview" : "Play animation"}
                </Button>
              </div>
            )}
          </section>
        )}
        <section
          className="border-border bg-background/70 rounded-xl border p-4 sm:p-5"
          aria-labelledby="asset-details-heading"
        >
          <h3 id="asset-details-heading" className="text-lg font-semibold">
            Asset details
          </h3>
          <p className="text-muted-foreground mt-1 mb-4 text-sm">
            Use a descriptive name and folder so other creators can find this asset.
            Record where the media came from and how it may be used.
          </p>
          <EditContent
            schema={gameAssetValidator}
            form={sharedForm}
            formData={detailFields}
            showSubmit={canSave}
            buttonTxt="Save changes"
            submitLoading={isUpdating || isPreparing}
            submitLoadingText="Saving changes…"
            type="asset"
            relationId={asset.id}
            allowImageUpload={canSave}
            onAccept={handleAssetSubmit}
          >
            {saveError && (
              <p role="alert" className="text-destructive col-span-full text-sm">
                {saveError}
              </p>
            )}
          </EditContent>
          <p className="text-muted-foreground mt-3 text-xs">
            Folder names use letters and numbers; leave empty for Unfiled. Hidden assets
            remain in the library and are marked hidden for game content.
          </p>
          <div className="border-border mt-4 flex justify-end border-t pt-3">
            <SuggestChange
              entityType="GAME_ASSET"
              entityId={asset.id}
              getData={() => form.getValues()}
              label={canSave ? "Suggest instead" : "Suggest a change"}
            />
          </div>
        </section>
      </div>
    </ContentBox>
  );
}

/** Allow both direct content editors and staff who submit review suggestions. */
const canOpenAssetEditor = (role: UserRole) =>
  canChangeContent(role) || canSuggestContent(role);
