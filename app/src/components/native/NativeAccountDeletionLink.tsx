"use client";

import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import { useNativeShell } from "@/hooks/useNativeShell";

export const NativeAccountDeletionLink = () => {
  const native = useNativeShell();
  const { isSignedIn } = useUser();
  if (!native || !isSignedIn) return null;
  return (
    <Link href="/account/delete" className="underline">
      Delete account permanently
    </Link>
  );
};
