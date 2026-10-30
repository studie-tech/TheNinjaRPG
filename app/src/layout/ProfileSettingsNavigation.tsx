"use client";

import { ArrowLeft, ChevronRight, type LucideIcon, Search, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Link from "@/layout/Link";
import { cn } from "@/libs/shadui";

/**
 * Navigate an authorized settings catalog through URL-backed categories and editors.
 * Only the selected editor mounts, so unopened forms do not load data or hold drafts.
 */
export function ProfileSettingsNavigation({
  groups,
}: {
  groups: ProfileSettingsGroup[];
}) {
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const hasNavigated = useRef(false);
  const searchId = useId();
  const groupId = searchParams.get("settings");
  const settingId = searchParams.get("setting");
  const activeGroup = groups.find((group) => group.id === groupId);
  const activeSetting = activeGroup?.settings.find(
    (setting) => setting.id === settingId,
  );
  const query = search.trim().toLowerCase();
  const searchTerms = query.split(/\s+/);
  const results = groups.flatMap((group) =>
    group.settings
      .filter((setting) => {
        const text =
          `${group.title} ${setting.title} ${setting.description} ${setting.keywords ?? ""}`.toLowerCase();
        return searchTerms.every((term) => text.includes(term));
      })
      .map((setting) => ({ group, setting })),
  );

  // Move focus with in-page navigation without stealing it on the initial render.
  useEffect(() => {
    if (!hasNavigated.current) return;
    headingRef.current?.focus({ preventScroll: true });
    const bounds = headingRef.current?.getBoundingClientRect();
    if (bounds && (bounds.top < 0 || bounds.bottom > window.innerHeight)) {
      headingRef.current?.scrollIntoView({ block: "start" });
    }
  }, [groupId, settingId]);

  /** Retain unrelated profile parameters while replacing the settings destination. */
  const hrefFor = (group?: ProfileSettingsGroup, setting?: ProfileSetting) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "edit");
    params.delete("settings");
    params.delete("setting");
    if (group) params.set("settings", group.id);
    if (setting) params.set("setting", setting.id);
    return `/profile?${params}`;
  };

  /** Use Next's native history integration; retain search when opening a result. */
  const navigate = (href: string, clearSearch = false) => {
    hasNavigated.current = true;
    if (clearSearch) setSearch("");
    window.history.pushState(null, "", href);
  };
  /** Skip the extra menu step for categories containing a single editor. */
  const groupHref = (group: ProfileSettingsGroup) =>
    hrefFor(group, group.settings.length === 1 ? group.settings[0] : undefined);
  const parentGroup =
    activeSetting && !query && activeGroup && activeGroup.settings.length > 1
      ? activeGroup
      : undefined;
  const backHref = hrefFor(parentGroup);
  const backLabel =
    activeSetting && query ? "Search results" : (parentGroup?.title ?? "All settings");

  return (
    <div className="@container/settings">
      {!activeGroup ? (
        <div className="p-4 sm:p-6">
          <div className="relative mb-5">
            <label htmlFor={searchId} className="sr-only">
              Search settings
            </label>
            <Search
              aria-hidden="true"
              className="text-muted-foreground pointer-events-none absolute top-3.5 left-3 h-4 w-4"
            />
            <Input
              id={searchId}
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search settings…"
              className="border-border/30 bg-background h-11 pr-11 pl-10 [&::-webkit-search-cancel-button]:appearance-none"
            />
            {search && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute top-1 right-1"
                aria-label="Clear search"
                onClick={() => setSearch("")}
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </Button>
            )}
          </div>
          <h2 ref={headingRef} tabIndex={-1} className="sr-only">
            All settings
          </h2>
          {query ? (
            <div>
              <p role="status" className="text-muted-foreground mb-3 text-sm">
                {results.length === 1
                  ? "1 setting found"
                  : `${results.length} settings found`}
              </p>
              {results.length > 0 ? (
                <ul className="divide-border/15 border-border/20 divide-y overflow-hidden rounded-lg border">
                  {results.map(({ group, setting }) => (
                    <li key={`${group.id}-${setting.id}`}>
                      <SettingsRow
                        title={setting.title}
                        description={setting.description}
                        context={group.title}
                        icon={setting.icon}
                        href={hrefFor(group, setting)}
                        onNavigate={navigate}
                        destructive={group.destructive}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="border-border/20 rounded-lg border px-4 py-8 text-center">
                  <p className="font-medium">No settings match “{search.trim()}”</p>
                  <p className="text-muted-foreground mt-1 text-sm">
                    Try avatar, combat, display, or privacy.
                  </p>
                  <Button
                    type="button"
                    variant="link"
                    className="mt-2"
                    onClick={() => setSearch("")}
                  >
                    Show all settings
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <nav aria-label="Settings categories">
              <ul className="divide-border/15 border-border/20 divide-y overflow-hidden rounded-lg border">
                {groups.map((group) => (
                  <li key={group.id}>
                    <SettingsRow
                      title={group.title}
                      description={group.description}
                      icon={group.icon}
                      href={groupHref(group)}
                      onNavigate={(href) => navigate(href, true)}
                      destructive={group.destructive}
                      prominent
                    />
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </div>
      ) : (
        <div className="@min-[640px]/settings:grid @min-[640px]/settings:grid-cols-[176px_minmax(0,1fr)]">
          <nav
            aria-label="Settings categories"
            className="border-border/15 bg-background/50 hidden border-r p-3 @min-[640px]/settings:block"
          >
            <Link
              href={hrefFor()}
              prefetch={false}
              onNavigate={(event) => {
                event.preventDefault();
                navigate(hrefFor(), true);
              }}
              className="text-muted-foreground hover:bg-primary/5 focus-visible:outline-ring mb-3 flex min-h-11 items-center gap-2 rounded-md px-2 text-sm focus-visible:outline-2"
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4 shrink-0" /> All settings
            </Link>
            <ul className="space-y-1">
              {groups.map((group) => (
                <li key={group.id}>
                  <Link
                    href={groupHref(group)}
                    prefetch={false}
                    aria-current={group.id === activeGroup.id ? "true" : undefined}
                    onNavigate={(event) => {
                      event.preventDefault();
                      navigate(groupHref(group), true);
                    }}
                    className={cn(
                      "hover:bg-primary/5 focus-visible:outline-ring flex min-h-12 items-center gap-2 rounded-md px-2 py-3 text-sm leading-snug focus-visible:outline-2",
                      group.id === activeGroup.id
                        ? "bg-primary/10 font-semibold"
                        : "text-muted-foreground",
                      group.destructive && "text-destructive",
                    )}
                  >
                    <group.icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                    {group.title}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <section
            className="min-w-0 p-4 sm:p-6"
            aria-labelledby={`${searchId}-heading`}
          >
            <Link
              href={backHref}
              prefetch={false}
              onNavigate={(event) => {
                event.preventDefault();
                navigate(backHref);
              }}
              className={cn(
                "text-muted-foreground hover:text-card-foreground focus-visible:outline-ring mb-3 inline-flex min-h-11 items-center gap-2 rounded-md text-sm focus-visible:outline-2",
                !parentGroup && !query && "@min-[640px]/settings:hidden",
              )}
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4 shrink-0" />
              {backLabel}
            </Link>
            <header className="mb-5">
              <h2
                id={`${searchId}-heading`}
                ref={headingRef}
                tabIndex={-1}
                className={cn(
                  "scroll-mt-6 text-xl font-semibold tracking-tight focus:outline-none",
                  activeGroup.destructive && "text-destructive",
                )}
              >
                {activeSetting?.title ?? activeGroup.title}
              </h2>
              <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                {activeSetting?.description ?? activeGroup.description}
              </p>
            </header>
            {activeSetting ? (
              <div key={`${activeGroup.id}-${activeSetting.id}`}>
                {activeSetting.notice && (
                  <div className="border-border/15 bg-background/70 mb-5 rounded-md border p-3 text-sm leading-relaxed">
                    {activeSetting.notice}
                  </div>
                )}
                {activeSetting.content}
              </div>
            ) : (
              <nav aria-label={activeGroup.title}>
                <ul className="divide-border/15 border-border/20 divide-y overflow-hidden rounded-lg border">
                  {activeGroup.settings.map((setting) => (
                    <li key={setting.id}>
                      <SettingsRow
                        title={setting.title}
                        description={setting.description}
                        icon={setting.icon}
                        href={hrefFor(activeGroup, setting)}
                        onNavigate={navigate}
                        destructive={activeGroup.destructive}
                      />
                    </li>
                  ))}
                </ul>
              </nav>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

/** Destination row shared by category menus, editor lists, and search results. */
function SettingsRow({
  title,
  description,
  context,
  icon: Icon,
  href,
  onNavigate,
  prominent = false,
  destructive = false,
}: {
  title: string;
  description: string;
  context?: string;
  icon: LucideIcon;
  href: string;
  onNavigate: (href: string) => void;
  prominent?: boolean;
  destructive?: boolean;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      onNavigate={(event) => {
        event.preventDefault();
        onNavigate(href);
      }}
      className={cn(
        "group hover:bg-primary/5 focus-visible:outline-ring flex min-h-16 items-center gap-3 px-3 py-4 focus-visible:outline-2 focus-visible:-outline-offset-2",
        prominent && "gap-4 sm:px-4 sm:py-5",
      )}
    >
      <span
        className={cn(
          "text-muted-foreground flex h-8 w-8 shrink-0 items-center justify-center",
          prominent && "bg-primary/8 text-foreground h-10 w-10 rounded-lg",
          destructive && "text-destructive",
        )}
      >
        <Icon aria-hidden="true" className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        {context && (
          <span className="text-muted-foreground mb-0.5 block text-xs">{context}</span>
        )}
        <span
          className={cn(
            "block text-sm leading-snug font-semibold",
            destructive && "text-destructive",
          )}
        >
          {title}
        </span>
        <span className="text-muted-foreground mt-1 block text-sm leading-snug">
          {description}
        </span>
      </span>
      <ChevronRight
        aria-hidden="true"
        className="text-muted-foreground group-hover:text-card-foreground h-4 w-4 shrink-0"
      />
    </Link>
  );
}

/** A discoverable editor whose own component owns saving and eligibility feedback. */
export type ProfileSetting = {
  id: string;
  title: string;
  description: string;
  keywords?: string;
  icon: LucideIcon;
  notice?: ReactNode;
  /** Mounted only when this setting is selected. */
  content: ReactNode;
};

/** Category assembled from the settings available to the current player. */
export type ProfileSettingsGroup = {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  destructive?: boolean;
  settings: ProfileSetting[];
};
