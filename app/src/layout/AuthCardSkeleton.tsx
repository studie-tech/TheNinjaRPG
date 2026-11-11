import type React from "react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Placeholder for the Clerk sign-in and sign-up card, which mounts only once the client
 * knows whether it runs in the native shell. It reserves the card's height so the form
 * does not push the page down when it appears.
 */
export const AuthCardSkeleton: React.FC = () => (
  <div className="flex w-full flex-col gap-[12px] py-[16px]" aria-hidden="true">
    <Skeleton className="h-[48px] w-full" />
    <Skeleton className="mx-auto h-[16px] w-1/3" />
    <Skeleton className="h-[16px] w-1/4" />
    <Skeleton className="h-[48px] w-full" />
    <Skeleton className="h-[48px] w-full" />
    <Skeleton className="mx-auto mt-[12px] h-[16px] w-1/2" />
  </div>
);
