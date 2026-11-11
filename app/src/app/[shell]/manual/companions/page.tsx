"use client";

import { FilePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PET_ABILITY_SLOTS_BY_RARITY,
  PetRarities,
  PetRoles,
} from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import Table from "@/layout/Table";
import { canChangeContent } from "@/utils/permissions";
import { capitalizeFirstLetter } from "@/utils/string";
import { useUserData } from "@/utils/UserContext";
import { CreateSpeciesModal } from "./SpeciesEditor";

/** Public species catalogue with the same role-gated controls as other Manual pages. */
export default function ManualCompanions() {
  const { data: userData } = useUserData();
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [rarity, setRarity] = useState("ALL");
  const [role, setRole] = useState("ALL");
  const { data: species, isPending, error, refetch } = api.petSpecies.getAll.useQuery();
  const canEdit = !!userData && canChangeContent(userData.role);
  const filtered = species?.filter(
    (entry) =>
      (rarity === "ALL" || entry.rarity === rarity) &&
      (role === "ALL" || entry.role === role) &&
      `${entry.name} ${entry.description}`.toLowerCase().includes(search.toLowerCase()),
  );
  const rows = filtered?.map((entry) => ({
    ...entry,
    slots: PET_ABILITY_SLOTS_BY_RARITY[entry.rarity],
    species: (
      <>
        <strong>{entry.name}</strong>
        <p className="mt-1 break-words text-muted-foreground">{entry.description}</p>
      </>
    ),
    status: (
      <Badge variant="outline" className="gap-1.5 whitespace-nowrap font-normal">
        <span
          aria-hidden
          className={`h-2 w-2 shrink-0 rounded-full ${entry.isActive ? "bg-green-500" : "bg-muted-foreground"}`}
        />
        {entry.isActive ? "Available" : "Retired"}
      </Badge>
    ),
  }));

  return (
    <ContentBox
      title="Companion Species"
      subtitle="Species, rarity, playstyle and authored companion defaults"
      defaultBackHref="/manual"
      topRightContent={
        canEdit ? (
          <Button onClick={() => setIsCreating(true)}>
            <FilePlus className="mr-2 h-4 w-4" />
            New species
          </Button>
        ) : undefined
      }
    >
      <p className="mb-4 text-sm">
        Each companion receives an AI-generated portrait shaped by its species,
        appearance choices and evolution rank. Retired species remain with existing
        companions, but are no longer offered at the sanctuary. Rarity sets jutsu
        capacity; species can also provide default moves, AI instructions and passive
        skills for eligible battles.
      </p>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <Input
          aria-label="Search companion species"
          placeholder="Search species or description"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="sm:flex-1"
        />
        <Select value={rarity} onValueChange={setRarity}>
          <SelectTrigger aria-label="Filter species by rarity" className="sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All rarities</SelectItem>
            {PetRarities.map((value) => (
              <SelectItem key={value} value={value}>
                {capitalizeFirstLetter(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger aria-label="Filter species by role" className="sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All roles</SelectItem>
            {PetRoles.map((value) => (
              <SelectItem key={value} value={value}>
                {capitalizeFirstLetter(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {isPending ? (
        <Loader explanation="Loading companion species" />
      ) : error ? (
        <div role="alert">
          <p>Could not load companion species. {error.message}</p>
          <Button variant="outline" className="mt-2" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : !rows?.length ? (
        <p>No companion species match your filters.</p>
      ) : (
        <Table
          data={rows}
          columns={[
            { key: "species", header: "Species", type: "jsx" },
            { key: "rarity", header: "Rarity", type: "capitalized" },
            { key: "role", header: "Role", type: "capitalized" },
            { key: "slots", header: "Jutsu slots", type: "string" },
            { key: "status", header: "Offers", type: "jsx" },
          ]}
          buttons={
            canEdit
              ? [
                  {
                    label: "Edit",
                    ariaLabel: (entry) => `Edit ${entry.name}`,
                    onClick: (entry) =>
                      router.push(`/manual/companions/edit/${entry.id}`),
                  },
                ]
              : undefined
          }
        />
      )}
      {isCreating && canEdit && <CreateSpeciesModal setIsOpen={setIsCreating} />}
    </ContentBox>
  );
}
