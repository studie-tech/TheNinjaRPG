"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { LpcThumbnail } from "@/layout/LpcThumbnail";
import { lpcDesignColors, lpcDesignGroup } from "@/libs/lpc/designs";
import { cn } from "@/libs/shadui";
import type { LpcConfig } from "@/validators/lpcAsset";

/** Browse the shared equipment library with static, body-specific artwork instead of renderer instances. */
export const LpcDesignBrowser = ({
  designs,
  selected,
  onSelect,
}: {
  designs: { id: string; name: string; hidden: boolean; lpcConfig: LpcConfig | null }[];
  selected: string;
  onSelect: (id: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("all");
  const available = designs.filter(
    (design) =>
      design.lpcConfig &&
      ["equipment", "headgear"].includes(design.lpcConfig.category) &&
      (!design.hidden || selected === design.id),
  );
  const filtered = available.filter(
    (design) =>
      `${design.name} ${design.id}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()) &&
      (group === "all" || lpcDesignGroup(design.lpcConfig!) === group),
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="w-full">
          Browse designs
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Equipment designs</DialogTitle>
          <DialogDescription>
            Compare broad and slender artwork. Choose a design to preview it on your
            item.
          </DialogDescription>
        </DialogHeader>
        <Input
          aria-label="Search equipment designs"
          placeholder="Search designs…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <fieldset className="flex flex-wrap gap-2" aria-label="Design category">
          {["all", "headgear", "clothing", "equipment"].map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={group === value ? "default" : "outline"}
              aria-pressed={group === value}
              onClick={() => setGroup(value)}
            >
              {value === "all"
                ? "All designs"
                : value[0]!.toUpperCase() + value.slice(1)}
            </Button>
          ))}
        </fieldset>
        <p className="text-muted-foreground text-sm" role="status">
          {filtered.length} designs
        </p>
        <div className="grid max-h-[55dvh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
          {filtered.map((design) => (
            <button
              key={design.id}
              type="button"
              aria-pressed={selected === design.id}
              className={cn(
                "flex min-w-0 flex-col items-center rounded-md border p-3 text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
                selected === design.id && "border-primary bg-accent",
              )}
              onClick={() => {
                onSelect(design.id);
                setOpen(false);
              }}
            >
              <span className="flex w-full justify-center gap-1">
                <LpcThumbnail
                  className="aspect-square h-auto w-1/2"
                  config={design.lpcConfig!}
                  label={`${design.name}, broad`}
                />
                <LpcThumbnail
                  className="aspect-square h-auto w-1/2"
                  config={design.lpcConfig!}
                  body="female"
                  label={`${design.name}, slender`}
                />
              </span>
              <span className="font-medium">
                {design.name.replace(/^LPC /, "")}
                {design.hidden ? " (hidden)" : ""}
              </span>
              <span className="text-muted-foreground text-xs">
                {lpcDesignColors(design.lpcConfig!).length} colours ·{" "}
                {lpcDesignGroup(design.lpcConfig!)}
              </span>
            </button>
          ))}
        </div>
        {!filtered.length && <p>No designs match. Try another name or category.</p>}
      </DialogContent>
    </Dialog>
  );
};
