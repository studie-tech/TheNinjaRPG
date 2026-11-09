"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import Loader from "@/layout/Loader";
import {
  getIsolatedPyramid,
  getPyramidRunTracker,
  hasQuestContentChanged,
} from "@/libs/questRun";
import { usePublicPathname } from "@/utils/routing";
import { useUserDataSelector } from "@/utils/UserContext";

// Quest scenes are only needed for a paused run, so public pages need not load them.
const LogbookEntry = dynamic(
  () => import("@/layout/Logbook").then((module) => module.LogbookEntry),
  { loading: () => <Loader explanation="Loading your Pyramid run" /> },
);

/** Keep isolated runs on combat while allowing authentication to finish on another device. */
export const PyramidRunBoundary = ({ children }: { children: React.ReactNode }) => {
  const { data: user } = useUserDataSelector((user) => ({
    userQuests: user.userQuests,
    questData: user.questData,
  }));
  const pathname = usePublicPathname();
  const router = useRouter();
  const isolated = getIsolatedPyramid(user);
  const isAuthHandoff = pathname === "/native-sign-in";
  const mustReturn = !!isolated && pathname !== "/combat" && !isAuthHandoff;
  useEffect(() => {
    if (mustReturn) router.replace("/combat");
  }, [mustReturn, router]);
  if (mustReturn) return <Loader explanation="Returning to your Pyramid" />;
  const paused = user?.userQuests.find(
    (entry) =>
      entry.questType === "battlepyramid" &&
      !entry.endAt &&
      !entry.completed &&
      (entry.quest.hidden || hasQuestContentChanged(entry)),
  );
  return (
    <>
      {!isolated && paused && pathname !== "/combat" && !isAuthHandoff && (
        <PyramidRun />
      )}
      {children}
    </>
  );
};

/** Reuse quest progression and abandonment between fights, including hidden or edited runs. */
export const PyramidRun = () => {
  const { data: user } = useUserDataSelector((user) => ({
    userQuests: user.userQuests,
    questData: user.questData,
  }));
  const run =
    getIsolatedPyramid(user) ??
    user?.userQuests.find(
      (entry) =>
        entry.questType === "battlepyramid" && !entry.endAt && !entry.completed,
    );
  if (!run) return null;
  return (
    <LogbookEntry
      userQuest={run}
      tracker={getPyramidRunTracker(run, user?.questData)}
      showScene
    />
  );
};
