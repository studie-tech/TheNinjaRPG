"use client";

import { Check, Palette } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useSelectGameLayout } from "@/hooks/useGameLayout";
import ContentBox from "@/layout/ContentBox";
import Image from "@/layout/Image";
import { GAME_LAYOUTS, type GameLayoutId, getGameLayout } from "@/libs/gameLayouts";
import { cn } from "@/libs/shadui";
import { useActiveLayout } from "@/utils/LayoutContext";

export default function GameLayoutsPage() {
  const activeLayout = useActiveLayout();
  const selectLayout = useSelectGameLayout();
  const [tone, setTone] = useState<"all" | "light" | "dark">("all");
  const [announcement, setAnnouncement] = useState("");
  const themes = GAME_LAYOUTS.filter((theme) => tone === "all" || theme.tone === tone);

  const chooseTheme = (id: GameLayoutId) => {
    selectLayout(id);
    setAnnouncement(
      `${getGameLayout(id).name} selected. Your game layout has been updated.`,
    );
  };

  return (
    <ContentBox
      title="Choose your surroundings"
      subtitle="Five ways to make Seichi your own."
      defaultBackHref="/profile"
      padding={false}
    >
      <div className="p-4 sm:p-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-prose text-muted-foreground text-sm">
            Find a space that suits how you play. Every layout includes your character,
            the full world menu, notifications and your mobile shortcuts. Your choice is
            saved on this device.
          </p>
          <fieldset
            className="flex gap-1 rounded-lg border border-border p-1"
            aria-label="Filter layouts by appearance"
          >
            {(["all", "light", "dark"] as const).map((value) => (
              <Button
                key={value}
                size="sm"
                variant={tone === value ? "default" : "ghost"}
                aria-pressed={tone === value}
                onClick={() => setTone(value)}
              >
                {value === "all" ? "All layouts" : value === "light" ? "Light" : "Dark"}
              </Button>
            ))}
          </fieldset>
        </div>
        <p role="status" className="sr-only">
          {announcement}
        </p>
        <div className="grid gap-6 xl:grid-cols-2">
          {themes.map((theme) => {
            const isSelected = activeLayout === theme.id;
            return (
              <article
                key={theme.id}
                className={cn(
                  "overflow-hidden rounded-xl border border-border bg-card",
                  isSelected && "ring-2 ring-primary",
                )}
                aria-labelledby={`name-${theme.id}`}
              >
                <div className="relative aspect-[5/2] overflow-hidden bg-muted">
                  <Image
                    src={theme.art}
                    alt=""
                    width={720}
                    height={480}
                    className="h-full w-full object-cover"
                    sizes="(min-width: 1280px) 480px, (min-width: 640px) 720px, 100vw"
                    loading="lazy"
                  />
                  <span className="absolute top-3 right-3 rounded-full bg-slate-950/85 px-3 py-1 text-white text-xs">
                    {theme.tone === "dark" ? "Dark" : "Light"}
                  </span>
                </div>
                <div className="space-y-3 p-5">
                  <h2 id={`name-${theme.id}`} className="font-semibold text-xl">
                    {theme.name}
                  </h2>
                  <p className="font-semibold text-primary text-sm">
                    {theme.visualLanguage}
                  </p>
                  <p className="text-sm">{theme.audience}</p>
                  <p className="text-muted-foreground text-sm">{theme.rationale}</p>
                  <details className="text-sm">
                    <summary className="min-h-11 cursor-pointer py-2 font-semibold">
                      Layout composition
                    </summary>
                    <p className="pb-3 text-muted-foreground">{theme.composition}</p>
                  </details>
                  <Button
                    className="w-full gap-2"
                    aria-label={`Use ${theme.name}`}
                    aria-pressed={isSelected}
                    onClick={() => chooseTheme(theme.id)}
                  >
                    {isSelected ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Palette className="h-4 w-4" />
                    )}
                    {isSelected ? "Current layout" : `Use ${theme.name}`}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
        <p className="mt-8 text-muted-foreground text-sm">
          Reading preferences, text size and mobile shortcuts work with every layout.
        </p>
      </div>
    </ContentBox>
  );
}
