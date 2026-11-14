"use client";

import { Search } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Loader from "@/layout/Loader";
import { showMutationToast } from "@/libs/toast";
import { canChangeContent } from "@/utils/permissions";
import { formatSoundLength } from "@/utils/time";
import { useUserDataSelector } from "@/utils/UserContext";

interface EpidemicSfxSearchProps {
  /** Runs after import caches refresh; a returned promise keeps import controls pending. */
  onImported: (assetId: string) => void | Promise<void>;
}

/**
 * Epidemic Sound search inside the SFX picker. Previews stream through our own origin;
 * "Use this" copies the sound to our storage as a new SFX asset with its license recorded.
 */
export const EpidemicSfxSearch: React.FC<EpidemicSfxSearchProps> = ({ onImported }) => {
  const { data: userData } = useUserDataSelector((u) => ({ role: u.role }));
  const [draft, setDraft] = useState("");
  const [term, setTerm] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  // Block same-tick clicks before the mutation's pending state disables the buttons.
  const importInFlight = useRef(false);
  const canSearch = !!userData && canChangeContent(userData.role);
  const utils = api.useUtils();
  const { data, error, isFetching } = api.contentReview.searchSfx.useQuery(
    { term },
    { enabled: canSearch && term.length >= 2 },
  );
  const importSfx = api.contentReview.importSfx.useMutation({
    onMutate: () => setImportError(null),
    onSuccess: async (result) => {
      showMutationToast(result);
      if (result.success && result.assetId) {
        // Refresh the asset library, picker options and labels before handing off the asset.
        await Promise.all([
          utils.gameAsset.getAll.invalidate(),
          utils.gameAsset.getAllFolders.invalidate(),
          utils.gameAsset.getAllNames.invalidate(),
          utils.misc.getAllGameAssetNames.invalidate(),
          utils.gameAsset.getNameTags.invalidate(),
        ]);
        await onImported(result.assetId);
      } else if (!result.success) {
        setImportError(result.message);
      }
    },
    onError: (error) =>
      setImportError(
        error.message.includes("Download quota exceeded")
          ? "The sound service has reached its download limit. Try again later or upload audio in the asset editor."
          : "This sound could not be imported. Try again or choose another sound.",
      ),
    onSettled: () => {
      importInFlight.current = false;
    },
  });

  if (!canSearch) return null;

  return (
    <div className="space-y-2 border-t pt-3">
      <h4 className="text-sm font-bold">Find a new sound</h4>
      <div className="flex gap-2">
        <Input
          value={draft}
          placeholder="Describe the sound, e.g. short fiery whoosh"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              setTerm(draft.trim());
            }
          }}
        />
        <Button
          type="button"
          variant="secondary"
          aria-label="Search sounds"
          onClick={() => setTerm(draft.trim())}
        >
          <Search className="h-4 w-4" />
        </Button>
      </div>
      {isFetching && <Loader explanation="Searching for sounds" />}
      {data && !data.configured && (
        <p className="text-sm opacity-70">
          Sound search is not configured on this server.
        </p>
      )}
      {error && !data && !isFetching && (
        <p className="text-sm text-red-500">
          The sound search failed ({error.message}). Try again in a moment.
        </p>
      )}
      {data?.configured && data.results.length === 0 && !isFetching && (
        <p className="text-sm opacity-70">No sounds matched that description.</p>
      )}
      {importError && (
        <p role="alert" className="text-destructive text-sm">
          {importError}
        </p>
      )}
      <div className="grid max-h-96 grid-cols-2 gap-3 overflow-auto md:grid-cols-3">
        {data?.results.map((sfx) => (
          <div key={sfx.id} className="space-y-2 rounded border p-2">
            <p className="truncate text-sm font-medium">{sfx.title}</p>
            <p className="text-xs opacity-70">{formatSoundLength(sfx.lengthMs)}</p>
            {/* biome-ignore lint/a11y/useMediaCaption: sound effects have no speech to caption */}
            <audio
              controls
              preload="none"
              className="w-full"
              src={`/api/content-review/sfx-preview?id=${encodeURIComponent(sfx.id)}`}
            />
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              disabled={importSfx.isPending}
              loading={
                importSfx.isPending && importSfx.variables?.epidemicId === sfx.id
              }
              onClick={() => {
                if (importInFlight.current) return;
                importInFlight.current = true;
                importSfx.mutate({ epidemicId: sfx.id, title: sfx.title });
              }}
            >
              Use this
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
};
