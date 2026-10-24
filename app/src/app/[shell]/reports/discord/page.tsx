"use client";

import { RefreshCw, Search, Unlink } from "lucide-react";
import { useState } from "react";
import type { RouterOutputs } from "@/app/_trpc/client";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import AvatarImage from "@/layout/Avatar";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { showMutationToast } from "@/libs/toast";
import { canManageDiscordLinks, canViewDiscordLinks } from "@/utils/permissions";
import { useRequiredUserData } from "@/utils/UserContext";

/** Staff lookup of Discord links, their history and abuse flags. */
export default function DiscordLinksStaffPage() {
  const { data: userData } = useRequiredUserData();
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const canView = !!userData && canViewDiscordLinks(userData.role);
  const { data: status } = api.discord.getStatus.useQuery(undefined, {
    enabled: canView,
  });
  const { data, isFetching } = api.discord.searchLinks.useQuery(
    { query },
    { enabled: canView && !!status?.enabled && query.length >= 2 },
  );

  if (!userData) return <Loader explanation="Loading userdata" />;
  if (!canView)
    return (
      <ContentBox
        title="Discord Links"
        subtitle="Staff lookup"
        defaultBackHref="/reports"
      >
        You are not allowed to view Discord links.
      </ContentBox>
    );

  if (!status) return <Loader explanation="Loading" />;
  if (!status.enabled)
    return (
      <ContentBox
        title="Discord Links"
        subtitle="Staff lookup"
        defaultBackHref="/reports"
      >
        Discord linking is disabled.
      </ContentBox>
    );

  return (
    <ContentBox
      title="Discord Links"
      subtitle="Search by character name, Discord id or Discord username"
      defaultBackHref="/reports"
    >
      <form
        className="flex flex-row gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(draft.trim());
        }}
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Username, Discord id or Discord username"
          aria-label="Search Discord links"
        />
        <Button type="submit" className="gap-2" disabled={draft.trim().length < 2}>
          <Search className="h-4 w-4" />
          Search
        </Button>
      </form>
      {isFetching && <Loader explanation="Searching" />}
      {data && !isFetching && (
        <div className="flex flex-col gap-4 pt-4">
          <h3 className="font-bold">Active links ({data.links.length})</h3>
          {data.links.length === 0 && <p className="italic">No active links found.</p>}
          {data.links.map((link) => (
            <DiscordLinkCard
              key={link.userId}
              link={link}
              canManage={canManageDiscordLinks(userData.role)}
            />
          ))}
          <h3 className="font-bold">Link history ({data.history.length})</h3>
          {data.history.length === 0 && <p className="italic">No ended links found.</p>}
          {data.history.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="p-1">Character</th>
                    <th className="p-1">Discord</th>
                    <th className="p-1">Linked</th>
                    <th className="p-1">Unlinked</th>
                    <th className="p-1">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {data.history.map((entry) => (
                    <tr key={entry.id} className="border-b">
                      <td className="p-1">{entry.username ?? entry.userId}</td>
                      <td className="p-1">
                        {entry.discordUsername}
                        <br />
                        <span className="text-muted-foreground text-xs">
                          {entry.discordId}
                        </span>
                      </td>
                      <td className="p-1">
                        {new Date(entry.linkedAt).toLocaleDateString()}
                      </td>
                      <td className="p-1">
                        {new Date(entry.unlinkedAt).toLocaleDateString()}
                      </td>
                      <td className="p-1">
                        {entry.reason}
                        {entry.cooldownWaived ? " (cooldown waived)" : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </ContentBox>
  );
}

type StaffLink = RouterOutputs["discord"]["searchLinks"]["links"][number];

const DiscordLinkCard: React.FC<{ link: StaffLink; canManage: boolean }> = ({
  link,
  canManage,
}) => {
  const utils = api.useUtils();
  const [reason, setReason] = useState("");
  const [waiveCooldown, setWaiveCooldown] = useState(false);
  const onSuccess = async (result: { success: boolean; message: string }) => {
    showMutationToast(result);
    if (result.success) await utils.discord.searchLinks.invalidate();
  };
  const { mutate: forceUnlink, isPending: isUnlinking } =
    api.discord.forceUnlink.useMutation({ onSuccess });
  const { mutate: resync, isPending: isResyncing } = api.discord.resync.useMutation({
    onSuccess,
  });
  const flags = link.log.filter((entry) =>
    entry.relatedMsg?.startsWith("Discord link flag"),
  );

  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-row items-center gap-3">
        <div className="w-14 shrink-0">
          <AvatarImage
            href={link.avatar}
            alt={link.username ?? link.userId}
            userId={link.userId}
            hover_effect={false}
            size={100}
          />
        </div>
        <div className="grow">
          <Link href={`/userid/${link.userId}`} className="font-bold hover:underline">
            {link.username ?? link.userId}
          </Link>
          <p className="text-sm">
            Discord: <span className="font-bold">{link.discordUsername}</span> (
            {link.discordId})
          </p>
          <p className="text-muted-foreground text-xs">
            Discord account created{" "}
            {new Date(link.discordCreatedAt).toLocaleDateString()} · Linked{" "}
            {new Date(link.linkedAt).toLocaleDateString()}
            {link.clerkDiscordId ? ` · Clerk Discord login ${link.clerkDiscordId}` : ""}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-1 pt-2 text-sm sm:grid-cols-2">
        <p>
          Last sync:{" "}
          {link.syncedAt ? new Date(link.syncedAt).toLocaleString() : "never"}
          {link.syncedBanned ? " · banned on Discord" : ""}
        </p>
        <p>Scopes: {link.scopes.join(", ")}</p>
        {link.syncError && (
          <p className="text-red-600 sm:col-span-2">Sync error: {link.syncError}</p>
        )}
      </div>
      {flags.length > 0 && (
        <div className="mt-2 rounded border border-amber-500 bg-amber-500/10 p-2 text-sm">
          <p className="font-bold">Flags</p>
          {flags.flatMap((entry) =>
            (entry.changes as string[]).map((change) => (
              <p key={`${entry.id}-${change}`}>{change}</p>
            )),
          )}
        </div>
      )}
      {link.log.length > 0 && (
        <details className="pt-2 text-sm">
          <summary className="cursor-pointer">Activity ({link.log.length})</summary>
          {link.log.map((entry) => (
            <p key={entry.id}>
              {new Date(entry.createdAt).toLocaleString()}: {entry.relatedMsg}
            </p>
          ))}
        </details>
      )}
      {canManage && (
        <div className="flex flex-row flex-wrap gap-2 pt-3">
          <Button
            variant="secondary"
            className="gap-2"
            disabled={isResyncing}
            onClick={() => resync({ userId: link.userId })}
          >
            <RefreshCw className="h-4 w-4" />
            Resync
          </Button>
          <Confirm
            title={`Unlink ${link.discordUsername}`}
            proceed_label={isUnlinking ? null : "Unlink"}
            isLoading={isUnlinking}
            confirmDisabled={reason.trim().length < 3}
            confirmClassName="bg-red-600 text-white hover:bg-red-700"
            button={
              <Button variant="destructive" className="gap-2">
                <Unlink className="h-4 w-4" />
                Force unlink
              </Button>
            }
            onAccept={(e) => {
              e.preventDefault();
              forceUnlink({ userId: link.userId, reason, waiveCooldown });
            }}
          >
            <div className="flex flex-col gap-3">
              <p>
                Removes the link and the Discord roles and nickname it manages. A
                Discord ban stays in place.
              </p>
              <Label htmlFor={`reason-${link.userId}`}>Reason</Label>
              <Input
                id={`reason-${link.userId}`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this link removed?"
              />
              <div className="flex flex-row items-center gap-2">
                <Switch
                  id={`waive-${link.userId}`}
                  checked={waiveCooldown}
                  onCheckedChange={setWaiveCooldown}
                />
                <Label htmlFor={`waive-${link.userId}`}>
                  Waive the unlink cooldown (e.g. to correct a mistaken link)
                </Label>
              </div>
            </div>
          </Confirm>
        </div>
      )}
    </div>
  );
};
