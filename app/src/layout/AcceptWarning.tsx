"use client";

import dynamic from "next/dynamic";
import type React from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import Loader from "@/layout/Loader";
import { showMutationToast } from "@/libs/toast";
import { useUserDataSelector } from "@/utils/UserContext";

const DisplayUserReport = dynamic(() => import("@/layout/UserReport"), {
  loading: () => <Loader explanation="Loading report" />,
});

const AcceptWarning: React.FC = () => {
  // Query
  const { data: userData, updateUser } = useUserDataSelector((user) => ({
    isWarned: user.isWarned,
  }));
  const { data: report } = api.reports.getBan.useQuery(undefined, {
    enabled: !!userData?.isWarned,
  });

  // Get utils
  const utils = api.useUtils();

  const acceptWarning = api.reports.acceptWarning.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await Promise.all([
          updateUser({ isWarned: false }),
          utils.reports.getBan.invalidate(),
        ]);
      }
    },
  });

  // The dialog stays open until the warning is accepted and isWarned clears
  if (!userData?.isWarned || !report) {
    return null;
  }

  const preventClose = (event: Event) => event.preventDefault();

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent
        className="max-w-4xl"
        closeDisabled
        onEscapeKeyDown={preventClose}
        onInteractOutside={preventClose}
      >
        <DialogHeader>
          <DialogTitle>Acknowledge Warning</DialogTitle>
        </DialogHeader>

        <DisplayUserReport report={report} hideHrefBack={true} />

        <DialogFooter>
          <Button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              acceptWarning.mutate();
            }}
            className="z-30 rounded-lg bg-orange-600 text-white hover:bg-orange-700"
            disabled={acceptWarning.isPending}
          >
            {acceptWarning.isPending ? "Accepting..." : "Accept Warning"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AcceptWarning;
