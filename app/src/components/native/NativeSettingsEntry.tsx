"use client";

import { useUser } from "@clerk/nextjs";
import { ChevronRight, Smartphone } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useNativeShell } from "@/hooks/useNativeShell";
import { NativeAccountDeletionLink } from "./NativeAccountDeletionLink";

export const NativeSettingsEntry = ({ onNavigate }: { onNavigate?: () => void }) => {
  const native = useNativeShell();
  const { isSignedIn } = useUser();
  if (!native || !isSignedIn) return null;
  return (
    <section className="space-y-3 border-primary/20 border-t pt-4">
      <p className="font-semibold text-base">App &amp; account</p>
      <Button
        asChild
        variant="outline"
        className="h-[44px] min-h-[44px] w-full justify-start gap-2 whitespace-nowrap text-[14px]"
      >
        <Link href="/settings/device" onClick={onNavigate}>
          <Smartphone className="size-4 shrink-0" aria-hidden="true" />
          <span className="flex-1 text-left">App settings</span>
          <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
        </Link>
      </Button>
      <p className="text-muted-foreground text-sm">
        Notifications, touch feedback and home screen widgets.
      </p>
      <NativeAccountDeletionLink onNavigate={onNavigate} />
    </section>
  );
};
