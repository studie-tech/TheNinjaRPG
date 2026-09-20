"use client";

import { DatabaseBackup } from "lucide-react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import ContentBox from "@/layout/ContentBox";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import { showMutationToast } from "@/libs/toast";
import { canControlBackups } from "@/utils/permissions";
import type { ArrayElement } from "@/utils/typeutils";
import { useUserData } from "@/utils/UserContext";

export default function ManualBackupPage() {
  // State
  const { data: userData } = useUserData();
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
        <Button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            pushToDevMutation.mutate({ id: b.id });
          }}
          disabled={pushToDevMutation.isPending}
        >
          Push to Dev
        </Button>
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
          <Button
            onClick={() => createBackupMutation.mutate({ type: "bloodline" })}
            disabled={createBackupMutation.isPending}
          >
            <DatabaseBackup className="mr-2 h-6 w-6" /> Bloodlines
          </Button>
          <Button
            onClick={() => createBackupMutation.mutate({ type: "jutsu" })}
            disabled={createBackupMutation.isPending}
          >
            <DatabaseBackup className="mr-2 h-6 w-6" /> Jutsu
          </Button>
          <Button
            onClick={() => createBackupMutation.mutate({ type: "item" })}
            disabled={createBackupMutation.isPending}
          >
            <DatabaseBackup className="mr-2 h-6 w-6" /> Items
          </Button>
          <Button
            onClick={() => createBackupMutation.mutate({ type: "ai" })}
            disabled={createBackupMutation.isPending}
          >
            <DatabaseBackup className="mr-2 h-6 w-6" /> AI
          </Button>
        </div>
      }
    >
      <Table data={rows} columns={columns} />
    </ContentBox>
  );
}
