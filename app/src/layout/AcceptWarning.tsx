"use client";

import type React from "react";
import { useEffect, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import DisplayUserReport from "@/layout/UserReport";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { useUserData } from "@/utils/UserContext";

const AcceptWarning: React.FC = () => {
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

  // Query
  const { data: userData } = useUserData();
  const { data: report } = api.reports.getBan.useQuery(undefined, {
    enabled: !!userData?.isWarned,
  });

  // Get utils
  const utils = api.useUtils();

  const acceptWarning = api.reports.acceptWarning.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        setIsModalOpen(false);
        await utils.profile.getUser.invalidate();
        await utils.reports.getBan.invalidate();
      }
    },
  });

  // Show modal when user is warned and has a warning report
  useEffect(() => {
    if (userData?.isWarned && report) {
      setIsModalOpen(true);
    }
  }, [userData?.isWarned, report]);

  // Don't render anything if user is not warned or no report
  if (!userData?.isWarned || !report) {
    return null;
  }

  const handleAcceptWarning = () => {
    acceptWarning.mutate();
  };

  const handleDialogClose = () => {
    // Prevent closing without accepting the warning
    if (!userData?.isWarned) {
      setIsModalOpen(false);
    }
  };

  return (
    <>
      {isModalOpen && (
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogContent
            className={cn("max-w-4xl", "max-h-screen overflow-y-scroll")}
            onEscapeKeyDown={handleDialogClose}
            onInteractOutside={handleDialogClose}
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
                  handleAcceptWarning();
                  if (!acceptWarning.isPending) {
                    setIsModalOpen(false);
                  }
                }}
                className="z-30 rounded-lg bg-orange-600 text-white hover:bg-orange-700"
                disabled={acceptWarning.isPending}
              >
                {acceptWarning.isPending ? "Accepting..." : "Accept Warning"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
};

export default AcceptWarning;
