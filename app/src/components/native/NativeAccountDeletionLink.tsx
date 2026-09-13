"use client";

import { useUser } from "@clerk/nextjs";
import { ChevronRight, Trash2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useNativeShell } from "@/hooks/useNativeShell";

export const NativeAccountDeletionLink = ({
  onNavigate,
}: {
  onNavigate?: () => void;
}) => {
  const native = useNativeShell();
  const { isSignedIn } = useUser();
  if (!native || !isSignedIn) return null;
  return (
    <Button
      asChild
      variant="outline"
      className="h-[44px] min-h-[44px] w-full justify-start gap-2 whitespace-nowrap border-destructive/30 text-[14px] text-destructive hover:bg-destructive/10 hover:text-destructive"
    >
      <Link href="/account/delete" onClick={onNavigate}>
        <Trash2 className="size-4 shrink-0" aria-hidden="true" />
        <span className="flex-1 text-left">Delete account</span>
        <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
      </Link>
    </Button>
  );
};
