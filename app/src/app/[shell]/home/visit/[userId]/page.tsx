"use client";

import { useParams } from "next/navigation";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import ContentBox from "@/layout/ContentBox";
import { HomeScene } from "@/layout/HomeScene";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { useUserData } from "@/utils/UserContext";

/** Display the server-authorized decoration snapshot with navigation and no owner actions. */
export default function HomeVisitPage() {
  const params = useParams<{ userId: string }>();
  const { data: user } = useUserData();
  const query = api.home.getVisitedHome.useQuery(
    { userId: params.userId },
    { enabled: !!user, staleTime: 0, retry: false },
  );
  const home = query.data?.home;
  const isOwnHome = !!user && user.userId === params.userId;
  return (
    <ContentBox
      padding={false}
      title={isOwnHome ? "Your Home" : home ? `${home.username}'s Home` : "Home visit"}
      subtitle={isOwnHome ? "Visitor preview" : undefined}
      defaultBackHref={isOwnHome ? "/home" : "/users"}
    >
      {!user ? (
        <p className="p-3">Sign in to visit player homes.</p>
      ) : query.isLoading ? (
        <Loader explanation="Opening home" />
      ) : query.isError ? (
        <div role="alert" className="p-3">
          Unable to load this home.{" "}
          <Button onClick={() => void query.refetch()}>Retry</Button>
        </div>
      ) : !home ? (
        <p role="status" className="p-3">
          {query.data?.message}
        </p>
      ) : (
        <>
          {isOwnHome ? (
            <p className="p-3 text-muted-foreground text-sm">
              This is how visitors see your home.{" "}
              <Link href="/home" className="font-semibold underline">
                Back to your home
              </Link>
            </p>
          ) : (
            <p className="p-3 text-muted-foreground text-sm">
              You are visiting. Explore the rooms and yard to see this player's
              decorations.
            </p>
          )}
          <HomeScene
            homeType={home.homeType}
            biome={home.biome}
            styles={home.styles}
            furniture={home.furniture}
            layout={home.layout}
            isVisiting
            isGuest
            isAsleep={false}
            isTogglingSleep={false}
            isDecorating={false}
            onDecoratingChange={() => {}}
            onSleep={() => {}}
            onStorage={() => {}}
            onKitchen={() => {}}
            onFarm={() => {}}
          />
        </>
      )}
    </ContentBox>
  );
}
