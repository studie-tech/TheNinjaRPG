import React from "react";
import Link from "next/link";
import ContentBox from "@/layout/ContentBox";
import { api } from "@/app/_trpc/client";
import Confirm2 from "@/layout/Confirm2";
import AvatarImage from "@/layout/Avatar";
import Countdown from "@/layout/Countdown";
import Loader from "@/layout/Loader";
import {
  Form,
  FormControl,
  FormField,
  FormLabel,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { useRouter } from "next/navigation";
import { UserRoundPlus, Swords, Medal, ShieldBan, Eye } from "lucide-react";
import { groupBy } from "@/utils/grouping";
import { UploadButton } from "@/utils/uploadthing";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { showMutationToast } from "@/libs/toast";
import { Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Reward } from "@/layout/Objective";
import { useUserData } from "@/utils/UserContext";
import { tournamentCreateSchema } from "@/validators/tournament";
import { TOURNAMENT_ROUND_SECONDS, IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import { secondsFromDate } from "@/utils/time";
import type { TournamentMatch } from "@/drizzle/schema";
import type { ObjectiveRewardType } from "@/validators/objectives";
import type { TournamentCreateSchema } from "@/validators/tournament";
import type { TournamentType } from "@/drizzle/constants";
import type { UserWithRelations } from "@/routers/profile";

interface TournamentProps {
  userData: NonNullable<UserWithRelations>;
  tournamentId: string;
  rewards: ObjectiveRewardType;
  canCreate?: boolean;
  canJoin?: boolean;
  title: string;
  subtitle: string;
  type: TournamentType;
}

const Tournament: React.FC<TournamentProps> = (props) => {
  // Destructure
  const { userData, tournamentId, rewards } = props;

  // Get synced time
  const { timeDiff } = useUserData();
  const syncedTime = Date.now() - timeDiff;

  // utils
  const utils = api.useUtils();

  // Get router
  const router = useRouter();

  // Queries
  const { data } = api.tournament.getTournament.useQuery({ tournamentId });

  // Mutations
  const { mutate: createTournament, isPending: isCreating } =
    api.tournament.createTournament.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        await utils.tournament.getTournament.invalidate();
      },
    });

  const { mutate: joinTournament, isPending: isJoiningTournament } =
    api.tournament.joinTournament.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        await utils.tournament.getTournament.invalidate();
      },
    });

  const { mutate: joinMatch, isPending: isJoiningMatch } =
    api.tournament.joinMatch.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        await utils.tournament.getTournament.invalidate();
        router.push("/combat");
      },
    });

  // Form
  const createForm = useForm<TournamentCreateSchema>({
    resolver: zodResolver(tournamentCreateSchema),
    defaultValues: {
      id: tournamentId,
      name: "",
      image: IMG_AVATAR_DEFAULT,
      description: "",
      rewards: rewards,
      type: props.type,
    },
  });
  const currentImage = useWatch({ control: createForm.control, name: "image" });

  // Form handlers
  const onSubmit = createForm.handleSubmit((data) => {
    createTournament({ ...data });
  });

  // Format the match data
  const matches = groupBy(data?.matches || [], "round");
  const rounds = [...matches.keys()];
  const initialSeeds = matches?.get(1)?.length || 0;

  if (isCreating) return <Loader explanation="Creating tournament" />;
  if (isJoiningTournament) return <Loader explanation="Joining tournament" />;
  if (isJoiningMatch) return <Loader explanation="Joining match" />;

  return (
    <ContentBox
      title={props.title}
      subtitle={props.subtitle}
      initialBreak={true}
      topRightContent={
        <>
          {data && props.canJoin && (
            <Confirm2
              title="Join tournament"
              proceed_label="Join"
              button={
                <Button id="create-tournament" className="w-full">
                  <UserRoundPlus className="h-5 w-5" />
                </Button>
              }
              isValid={createForm.formState.isValid}
              onAccept={(e) => {
                e.preventDefault();
                joinTournament({ tournamentId });
              }}
            >
              Do you wish to join this tournament?
            </Confirm2>
          )}
          {!data && props.canCreate && (
            <Confirm2
              title="Create new tournament"
              proceed_label="Create"
              button={
                <Button id="create-tournament" className="w-full">
                  <Trophy className="h-5 w-5" />
                </Button>
              }
              isValid={createForm.formState.isValid}
              onAccept={(e) => {
                e.preventDefault();
                createTournament(createForm.getValues());
              }}
            >
              <Form {...createForm}>
                <form className="space-y-2 grid grid-cols-2" onSubmit={onSubmit}>
                  <div>
                    <FormLabel>Tournament Image</FormLabel>
                    <AvatarImage
                      href={currentImage}
                      alt={tournamentId}
                      size={100}
                      hover_effect={true}
                      priority
                    />
                    <UploadButton
                      endpoint="tournamentUploader"
                      onClientUploadComplete={(res) => {
                        const url = res?.[0]?.serverData?.fileUrl;
                        if (url) {
                          createForm.setValue("image", url, {
                            shouldDirty: true,
                          });
                        }
                      }}
                      onUploadError={(error: Error) => {
                        showMutationToast({ success: false, message: error.message });
                      }}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <FormField
                      control={createForm.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Title</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Name of the new tournament"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={createForm.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Description</FormLabel>
                          <FormControl>
                            <Input placeholder="Description of tournament" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div>
                      <FormLabel>Winner Rewards</FormLabel>
                      <div className="text-sm">
                        <Reward info={rewards} />
                      </div>
                    </div>
                  </div>
                </form>
              </Form>
            </Confirm2>
          )}
        </>
      }
    >
      {!data && <div>There are no current tournaments</div>}
      {data && (
        <div className="grid grid-cols-8">
          <div className="col-span-2">
            <AvatarImage
              href={data.image}
              alt={data.id}
              size={100}
              hover_effect={true}
              priority
            />
          </div>
          <div className="col-span-6">
            <p>
              <b>Title: </b> {data.name}
            </p>
            <p>
              <b>Description: </b> {data.description}
            </p>
            <Reward info={data.rewards} />
            <div>
              <b>Start: </b>
              <Countdown
                targetDate={data.startedAt}
                timeDiff={timeDiff}
                onEndShow="In progress"
              />
            </div>
            {data.status === "IN_PROGRESS" && (
              <div>
                <b>Next Round: </b>
                <Countdown
                  targetDate={secondsFromDate(
                    TOURNAMENT_ROUND_SECONDS,
                    data.roundStartedAt,
                  )}
                  timeDiff={timeDiff}
                  onEndShow="Now"
                />
              </div>
            )}
          </div>
        </div>
      )}
      {data && (
        <div
          className={`mt-5 w-full h-full items-center flex flex-row overflow-x-auto`}
        >
          {rounds.length === 0 && <p>Nobody joined the tournament yet!</p>}
          {rounds.map((round, i) => {
            const seeds = matches.get(round) || [];
            return (
              <div key={`round-${round}`} className="w-60 shrink-0 ">
                <p className="font-bold text-center">{`Round ${round}`}</p>
                <div className="flex flex-col">
                  {seeds.map((seed, j) => {
                    // DETERMINE NUMBER OF EMPTY BLOCKS TO ADD TO MAKE THE GRID SQUARE
                    let emptyBlocks = 2 ** i - 1;
                    const newBlocks = 1 + emptyBlocks;
                    const isLastRound = i === rounds.length - 1;
                    const prevBlocks = j * newBlocks;
                    if (prevBlocks + newBlocks >= initialSeeds) {
                      emptyBlocks = initialSeeds - prevBlocks - 1;
                    }
                    emptyBlocks = emptyBlocks < 0 ? 0 : emptyBlocks;
                    // DETERMINE IF BORDER ON EMPTY BLOCK
                    const isTopBlock = j % 2 === 0;
                    const isBottomBlock = j % 2 === 1;
                    const isLastBlock = j === seeds.length - 1;

                    return (
                      <div key={`seed-${j}`}>
                        <div className="flex flex-col h-32">
                          <div className="flex flex-row basis-5/6 items-center">
                            {/* HORIZONTAL INCOMING LINES */}
                            {i !== 0 && (
                              <div className="basis-1/6">
                                <div className="border-t-2 border-black"></div>
                              </div>
                            )}
                            {/* INFORMATION FOR MATCH */}
                            <div className="bg-slate-500 rounded-md p-2 w-full flex flex-row items-center">
                              <div className="grow">
                                <UserMatch seed={seed} user={seed.user1} />
                                <div className="py-2 border-black">
                                  <hr className="h-px bg-slate-300 border-0" />
                                </div>
                                <UserMatch seed={seed} user={seed.user2} />
                              </div>
                              {!seed.winnerId &&
                                syncedTime > seed.startedAt.getTime() &&
                                isLastRound &&
                                !seed.battleId &&
                                [seed.userId2, seed.userId1].includes(
                                  userData.userId,
                                ) && (
                                  <Swords
                                    className="grow h-8 w-8 text-slate-300 hover:cursor-pointer hover:text-orange-200"
                                    onClick={() =>
                                      joinMatch({ matchId: seed.id, tournamentId })
                                    }
                                  />
                                )}
                              {seed.battleId && (
                                <Link
                                  className="mx-2"
                                  href={`/battlelog/${seed.battleId}`}
                                >
                                  <Eye className="h-8 w-8 text-slate-300 hover:cursor-pointer hover:text-orange-200" />
                                </Link>
                              )}
                            </div>
                            {/* VERTICAL & HORIZONTAL OUTGOING LINES */}
                            {i !== rounds.length - 1 && (
                              <div className="basis-1/6 h-full flex flex-col jutsify-center">
                                <div
                                  className={`basis-1/2 ${isBottomBlock ? "border-r-2" : ""} border-black`}
                                ></div>
                                <div className="border-t-2 border-black"></div>
                                <div
                                  className={`basis-1/2 ${isTopBlock && !isLastBlock ? "border-r-2" : ""} border-black`}
                                ></div>
                              </div>
                            )}
                          </div>
                          <p
                            className={`text-center italic text-sm ${isTopBlock && !isLastBlock && !isLastRound ? "border-r-2" : ""} border-black`}
                          >
                            {seed.createdAt.toLocaleString()}
                          </p>
                        </div>
                        {[...Array(emptyBlocks).keys()].map((k) => (
                          <div
                            key={`empty-${k}`}
                            className={`h-32 ${isTopBlock && !isLastBlock && !isLastRound ? "border-r-2 border-black" : ""}`}
                          ></div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ContentBox>
  );
};

export default Tournament;

interface UserMatchProps {
  seed: TournamentMatch;
  user: { userId: string; username: string; avatar: string | null } | null;
}

const UserMatch: React.FC<UserMatchProps> = (props) => {
  const { seed, user } = props;
  return (
    <div className="flex flex-row items-center">
      {user && (
        <div className="w-10 mr-2 text-center">
          <AvatarImage
            href={user.avatar}
            alt={user.userId}
            size={100}
            hover_effect={true}
            priority
          />
        </div>
      )}
      <Link
        href={`/userid/${seed.userId1}`}
        className={`grow text-slate-100 ${seed.userId1 ? "hover:cursor-pointer hover:text-orange-100" : ""}`}
      >
        {user?.username || "---"}
      </Link>
      {seed.winnerId && seed.winnerId === user?.userId && (
        <Medal className="h-7 w-7 text-green-600" />
      )}
      {seed.winnerId && seed.winnerId !== user?.userId && (
        <ShieldBan className="h-7 w-7 text-red-600" />
      )}
    </div>
  );
};
