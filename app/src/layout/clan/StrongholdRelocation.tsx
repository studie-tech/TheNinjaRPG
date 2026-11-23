import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { NumberInput } from "@/components/ui/number-input";
import { MAP_SECTOR_ID_MAX } from "@/drizzle/constants";
import { useMap } from "@/hooks/map";
import { useStrongholdRelocation } from "@/hooks/useStrongholdRelocation";
import Loader from "@/layout/Loader";
import GlobalMap from "@/layout/Map";
import Modal from "@/layout/Modal";

/** Let a faction leader choose and confirm the settlement's single free relocation. */
export const StrongholdRelocation = ({
  clanId,
  homeSector,
  onClose,
}: {
  clanId: string;
  homeSector: number;
  onClose: () => void;
}) => {
  const { globe, mapError } = useMap();
  const { data: villages } = api.village.getAll.useQuery();
  const [selectedSector, setSelectedSector] = useState<number | null>(null);
  const relocation = useStrongholdRelocation(clanId);
  const destination =
    Number.isSafeInteger(selectedSector) &&
    (selectedSector ?? -1) >= 0 &&
    selectedSector !== homeSector;
  const error =
    relocation.error?.message ??
    (relocation.data?.success === false ? relocation.data.message : null);
  return (
    <Modal
      id="relocate-stronghold"
      title="Relocate Stronghold"
      isOpen
      setIsOpen={(open) => {
        if (!open) onClose();
      }}
      proceed_label="Confirm relocation"
      isLoading={relocation.isPending}
      proceedDisabled={!destination}
      keepOpenOnAccept
      onAccept={() => {
        if (selectedSector === null) return;
        void relocation
          .mutateAsync({ clanId, sector: selectedSector })
          .then((result) => {
            if (result.success) onClose();
          })
          .catch(() => undefined);
      }}
    >
      <div className="space-y-3">
        <p>
          Move your Stronghold and its home shrine for free, once only. Other captured
          sectors stay where they are. Choose an unclaimed, non-reserved sector. Your
          faction cannot relocate while participating in a war. Players stay in their
          current sectors.
        </p>
        {globe ? (
          <div className="mx-auto aspect-square w-full max-w-md overflow-hidden rounded-md">
            <GlobalMap
              hexasphere={globe}
              highlights={villages}
              showOwnership
              autoRotate={false}
              focusSector={selectedSector ?? homeSector}
              actionExplanation="Click to select a relocation sector"
              onTileClick={(sector) => {
                if (!relocation.isPending) setSelectedSector(sector);
              }}
            />
          </div>
        ) : mapError ? (
          <p role="alert">The globe could not load. You can enter a sector below.</p>
        ) : (
          <Loader explanation="Loading globe" />
        )}
        <label className="block" htmlFor="stronghold-destination">
          Destination sector
        </label>
        <NumberInput
          id="stronghold-destination"
          min={0}
          max={MAP_SECTOR_ID_MAX}
          step={1}
          value={selectedSector ?? ""}
          disabled={relocation.isPending}
          onValueChange={setSelectedSector}
        />
        {destination && (
          <p>
            Relocate from sector {homeSector} to sector {selectedSector}. This choice is
            permanent.
          </p>
        )}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
};
