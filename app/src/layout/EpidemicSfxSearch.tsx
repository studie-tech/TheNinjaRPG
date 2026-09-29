"use client";

import { Search } from "lucide-react";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Loader from "@/layout/Loader";
import { showMutationToast } from "@/libs/toast";
import { canChangeContent } from "@/utils/permissions";
import { formatSoundLength } from "@/utils/time";
import { useUserData } from "@/utils/UserContext";

interface EpidemicSfxSearchProps {
  /** Called with the new GameAsset id once the sound is in the asset library. */
  onImported: (assetId: string) => void;
}

/**
 * Epidemic Sound search inside the SFX picker. Previews stream through our own origin;
 * "Use this" copies the sound to our storage as a new SFX asset with its license recorded.
 */
export const EpidemicSfxSearch: React.FC<EpidemicSfxSearchProps> = ({ onImported }) => {
  const { data: userData } = useUserData();
  const [draft, setDraft] = useState("");
  const [term, setTerm] = useState("");
  const canSearch = !!userData && canChangeContent(userData.role);
  const utils = api.useUtils();
  const { data, isFetching } = api.contentReview.searchSfx.useQuery(
    { term },
    { enabled: canSearch && term.length >= 2 },
  );
  const importSfx = api.contentReview.importSfx.useMutation({
    onSuccess: async (result) => {
      showMutationToast(result);
      if (result.success && result.assetId) {
        // The picker lists assets from one query and effect fields label them from another.
        await Promise.all([
          utils.gameAsset.getAll.invalidate(),
          utils.misc.getAllGameAssetNames.invalidate(),
        ]);
        onImported(result.assetId);
      }
    },
  });

  if (!canSearch) return null;

  return (
    <div className="space-y-2 border-t pt-3">
      <h4 className="font-bold text-sm">Find a new sound</h4>
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
        <Button type="button" variant="secondary" onClick={() => setTerm(draft.trim())}>
          <Search className="h-4 w-4" />
        </Button>
      </div>
      {isFetching && <Loader explanation="Searching for sounds" />}
      {data && !data.configured && (
        <p className="text-sm opacity-70">
          Sound search is not configured on this server.
        </p>
      )}
      {data?.configured && data.results.length === 0 && !isFetching && (
        <p className="text-sm opacity-70">No sounds matched that description.</p>
      )}
      <div className="grid max-h-96 grid-cols-2 gap-3 overflow-auto md:grid-cols-3">
        {data?.results.map((sfx) => (
          <div key={sfx.id} className="space-y-2 rounded border p-2">
            <p className="truncate font-medium text-sm">{sfx.title}</p>
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
              loading={
                importSfx.isPending && importSfx.variables?.epidemicId === sfx.id
              }
              onClick={() => importSfx.mutate({ epidemicId: sfx.id, title: sfx.title })}
            >
              Use this
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
};
