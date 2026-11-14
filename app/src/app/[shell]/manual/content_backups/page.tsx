"use client";

import { DatabaseBackup } from "lucide-react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import { showMutationToast } from "@/libs/toast";
import { canControlBackups } from "@/utils/permissions";
import type { ArrayElement } from "@/utils/typeutils";
import { useUserDataSelector } from "@/utils/UserContext";

export default function ManualBackupPage() {
  // State
  const { data: userData } = useUserDataSelector((u) => ({ role: u.role }));
  const hasAccess = canControlBackups(userData?.role ?? "USER");

  // tRPC utils
  const utils = api.useUtils();

  // Queries
  const { data } = api.staff.getBackups.useQuery(undefined, {
    enabled: hasAccess,
  });

  // Mutations
  const createBackupMutation = api.staff.createBackup.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.staff.getBackups.invalidate();
      }
    },
  });

  const pushToDevMutation = api.staff.pushBackupToDev.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.staff.getBackups.invalidate();
      }
    },
  });

  const rows = data?.map((b) => ({
    ...b,
    actions: (
      <div className="flex gap-2">
        <Confirm
          title="Push backup to dev?"
          disabled={pushToDevMutation.isPending}
          isLoading={pushToDevMutation.isPending}
          proceed_label="Push to Dev"
          button={<Button disabled={pushToDevMutation.isPending}>Push to Dev</Button>}
          onAccept={() => pushToDevMutation.mutate({ id: b.id })}
        >
          Push backup {b.id} ({b.type}) to dev? It overwrites the {b.type} content on
          the dev database.
        </Confirm>
      </div>
    ),
  }));

  type Backup = ArrayElement<typeof rows>;
  const columns: ColumnDefinitionType<Backup, keyof Backup>[] = [
    { key: "id", header: "ID", type: "string" },
    { key: "type", header: "Type", type: "string" },
    { key: "createdAt", header: "Created", type: "date" },
    { key: "actions", header: "Actions", type: "jsx" },
  ];

  if (!hasAccess) {
    return <div className="p-4">You do not have permission to view this page.</div>;
  }

  return (
    <ContentBox
      title="Backup & Sync"
      subtitle="Content backups and sync to dev"
      defaultBackHref="/manual"
      padding={false}
      topRightContent={
        <div className="flex gap-2">
          {BACKUP_TYPES.map(([type, label]) => (
            <Button
              key={type}
              onClick={() => createBackupMutation.mutate({ type })}
              disabled={createBackupMutation.isPending}
            >
              <DatabaseBackup className="mr-2 h-6 w-6" /> {label}
            </Button>
          ))}
        </div>
      }
    >
      <Table data={rows} columns={columns} />
    </ContentBox>
  );
}

const BACKUP_TYPES = [
  ["bloodline", "Back up bloodlines"],
  ["jutsu", "Back up jutsu"],
  ["item", "Back up items"],
  ["ai", "Back up AI"],
] as const;
