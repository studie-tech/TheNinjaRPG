"use client";

import { useState } from "react";
import { api } from "@/app/_trpc/client";
import ContentBox from "@/layout/ContentBox";
import { FISHING_SPECIES } from "@/libs/fishing";

const defaultSpecies = FISHING_SPECIES[0]?.id ?? "river-carp";

/** Staff authoring surface; saveHabitat is authoritative for water and bank validation. */
export function FishingHabitatEditor() {
  const utils = api.useUtils();
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState<string | undefined>();
  const [name, setName] = useState("");
  const [sector, setSector] = useState("1");
  const [tileX, setTileX] = useState("0");
  const [tileY, setTileY] = useState("0");
  const [radius, setRadius] = useState("1");
  const [speciesIds, setSpeciesIds] = useState<string[]>([defaultSpecies]);
  const [active, setActive] = useState(true);
  const { data: habitats } = api.fishing.listHabitats.useQuery();
  const refresh = () => void utils.fishing.listHabitats.invalidate();
  const save = api.fishing.saveHabitat.useMutation({
    onSuccess: (result) => {
      setMessage(result.message);
      if (result.success) {
        setEditingId(result.id);
        refresh();
      }
    },
  });
  const remove = api.fishing.deleteHabitat.useMutation({
    onSuccess: (result) => {
      setMessage(result.message);
      if (result.success) {
        if (editingId) reset();
        refresh();
      }
    },
  });
  const reset = () => {
    setEditingId(undefined);
    setName("");
    setSector("1");
    setTileX("0");
    setTileY("0");
    setRadius("1");
    setSpeciesIds([defaultSpecies]);
    setActive(true);
  };
  const edit = (habitat: NonNullable<typeof habitats>[number]) => {
    setEditingId(habitat.id);
    setName(habitat.name);
    setSector(String(habitat.sector));
    setTileX(String(habitat.tileX));
    setTileY(String(habitat.tileY));
    setRadius(String(habitat.radius));
    setSpeciesIds(
      habitat.speciesIds.length > 0 ? habitat.speciesIds : [defaultSpecies],
    );
    setActive(habitat.active);
  };
  const numeric = (value: string) => Number(value);
  return (
    <ContentBox
      title="Fishing Habitats"
      subtitle="Place fishable water and choose the species available there"
      defaultBackHref="/manual"
    >
      <div className="space-y-4">
        <p className="text-sm">
          A habitat must be water with an unblocked, reachable bank in its casting
          radius. The server checks the published sector map on every save.
        </p>
        {message && (
          <p className="rounded border p-2 text-sm" role="status">
            {message}
          </p>
        )}
        <div className="grid gap-2 sm:grid-cols-3">
          <input
            className="rounded border p-2"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Habitat name"
          />
          <input
            className="rounded border p-2"
            type="number"
            min="1"
            value={sector}
            onChange={(event) => setSector(event.target.value)}
            placeholder="Sector"
          />
          <input
            className="rounded border p-2"
            type="number"
            min="0"
            value={tileX}
            onChange={(event) => setTileX(event.target.value)}
            placeholder="Water tile X"
          />
          <input
            className="rounded border p-2"
            type="number"
            min="0"
            value={tileY}
            onChange={(event) => setTileY(event.target.value)}
            placeholder="Water tile Y"
          />
          <input
            className="rounded border p-2"
            type="number"
            min="0"
            max="8"
            value={radius}
            onChange={(event) => setRadius(event.target.value)}
            placeholder="Casting radius"
          />
          <select
            aria-label="Available fish species"
            className="min-h-28 rounded border p-2"
            multiple
            value={speciesIds}
            onChange={(event) =>
              setSpeciesIds(
                [...event.target.selectedOptions].map((option) => option.value),
              )
            }
          >
            {FISHING_SPECIES.map((species) => (
              <option key={species.id} value={species.id}>
                {species.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
            />{" "}
            Active for players
          </label>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded bg-primary px-3 py-2 text-primary-foreground"
            disabled={!name || speciesIds.length === 0 || save.isPending}
            onClick={() =>
              save.mutate({
                id: editingId,
                name,
                sector: numeric(sector),
                tileX: numeric(tileX),
                tileY: numeric(tileY),
                radius: numeric(radius),
                speciesIds,
                active,
              })
            }
          >
            {editingId ? "Save habitat" : "Create habitat"}
          </button>
          {editingId && (
            <button type="button" className="rounded border px-3 py-2" onClick={reset}>
              New habitat
            </button>
          )}
        </div>
        <section>
          <h2 className="font-semibold">Existing habitats</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {habitats?.map((habitat) => (
              <li
                key={habitat.id}
                className="flex flex-wrap items-center gap-2 rounded border p-2"
              >
                <span>
                  {habitat.name} — sector {habitat.sector}, {habitat.tileX}/
                  {habitat.tileY}, radius {habitat.radius};{" "}
                  {habitat.active ? "active" : "inactive"}
                </span>
                <button
                  type="button"
                  className="rounded border px-2 py-1"
                  onClick={() => edit(habitat)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="rounded border px-2 py-1"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate({ id: habitat.id })}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </ContentBox>
  );
}
