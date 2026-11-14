import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, Medal, ShieldBan, Swords, Trophy, UserRoundPlus } from "lucide-react";
import type React from "react";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { IMG_AVATAR_DEFAULT, TOURNAMENT_ROUND_SECONDS } from "@/drizzle/constants";
import type { TournamentMatch } from "@/drizzle/schema";
import { useCombatEntry } from "@/hooks/combatEntry";
import { useNavigationRouter as useRouter } from "@/hooks/navigation";
import { useNow } from "@/hooks/useNow";
import AvatarImage from "@/layout/Avatar";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import Countdown from "@/layout/Countdown";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { Reward } from "@/layout/Objective";
import { QueryError } from "@/layout/QueryError";
import { showMutationToast } from "@/libs/toast";
import type { UserWithRelations } from "@/routers/profile";
import { groupBy } from "@/utils/grouping";
import { pushToCombat } from "@/utils/routing";
import { secondsFromDate } from "@/utils/time";
import { useUserInfo } from "@/utils/UserContext";
import { readUploadResult, showUploadError, UploadButton } from "@/utils/uploadthing";
import type { ObjectiveRewardType } from "@/validators/rewards";
import {
  type TournamentCreateSchema,
  type TournamentCreateSchemaInput,
  tournamentCreateSchema,
} from "@/validators/tournament";

interface TournamentProps {
  userData: NonNullable<UserWithRelations>;
  tournamentId: string;
  rewards: ObjectiveRewardType;
  canCreate?: boolean;
  canJoin?: boolean;
  title: string;
  subtitle: string;
  type: "CLAN";
}

const Tournament: React.FC<TournamentProps> = (props) => {
  // Destructure
  const { userData, tournamentId, rewards } = props;

  const { timeDiff, pusher, prepareUserUpdate, updateUser } = useUserInfo();

  const utils = api.useUtils();

  // Get router
  const router = useRouter();
  const { prepareCombatEntry, loadBattle } = useCombatEntry();

  // Queries. Each read advances the bracket server-side, so poll only while rounds run.
  const {
    data,
    isPending: isLoadingTournament,
    isError: isTournamentError,
    isFetching: isFetchingTournament,
    refetch: refetchTournament,
  } = api.tournament.getTournament.useQuery(
    { tournamentId },
    {
      refetchInterval: (query) =>
        query.state.data?.status === "IN_PROGRESS"
          ? TOURNAMENT_POLL_INTERVAL_MS
          : false,
    },
  );
  const hasNoTournament = !isLoadingTournament && !isTournamentError && !data;
  const isInProgress = data?.status === "IN_PROGRESS";
  // Ticking clock so the fight control appears when a match opens without a reload
  const syncedTime =
    useNow(TOURNAMENT_CLOCK_TICK_MS, { enabled: isInProgress }) - timeDiff;

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

  const {
    mutate: joinMatch,
    isPending: isJoiningMatch,
    variables: joiningMatch,
  } = api.tournament.joinMatch.useMutation({
    onMutate: () => {
      prepareCombatEntry();
      return prepareUserUpdate();
    },
    onSuccess: async (data, _variables, revision) => {
      if (data.success && data.battleId) loadBattle(data.battleId);
      if (data.success || data.userRecovery)
        await updateUser(data, { revision, refetch: false });
      showMutationToast(data);
      await utils.tournament.getTournament.invalidate();
      // A match can be joined without a battle starting — the opponent no-showed and this
      // player took the round — so there is nothing to go to combat for
      if (data.success && data.battleId) pushToCombat(router, data.battleId);
    },
    onError: (error) => {
      showMutationToast({ success: false, message: error.message });
    },
  });

  // Form
  const createForm = useForm<
    TournamentCreateSchemaInput,
    unknown,
    TournamentCreateSchema
  >({
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
  const initialSeeds = matches.get(1)?.length ?? 0;

  return (
    <ContentBox
      title={props.title}
      subtitle={props.subtitle}
      initialBreak={true}
      topRightContent={
        <>
          {data && props.canJoin && (
            <Confirm
              title="Join tournament"
              proceed_label="Join"
              button={
                <Button
                  id="join-tournament"
                  className="w-full"
                  aria-label="Join tournament"
                  loading={isJoiningTournament}
                >
                  <UserRoundPlus className="h-5 w-5" />
                </Button>
              }
              disabled={isJoiningTournament}
              onAccept={(e) => {
                e.preventDefault();
                joinTournament({ tournamentId });
              }}
            >
              Do you wish to join this tournament?
            </Confirm>
          )}
          {hasNoTournament && props.canCreate && (
            <Confirm
              title="Create new tournament"
              proceed_label="Create"
              button={
                <Button
                  id="create-tournament"
                  className="w-full"
                  aria-label="Create tournament"
                  loading={isCreating}
                >
                  <Trophy className="h-5 w-5" />
                </Button>
              }
              disabled={isCreating}
              isValid={createForm.formState.isValid}
              onAccept={onSubmit}
            >
              <Form {...createForm}>
                <form className="grid grid-cols-2 space-y-2" onSubmit={onSubmit}>
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
                        const url = readUploadResult(res)?.fileUrl;
                        if (url) {
                          createForm.setValue("image", url, {
                            shouldDirty: true,
                          });
                        }
                      }}
                      onUploadError={showUploadError}
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
            </Confirm>
          )}
        </>
      }
    >
      {isLoadingTournament && <Loader explanation="Loading tournament" />}
      {isTournamentError && !data && (
        <QueryError
          message="Could not load the tournament."
          onRetry={() => void refetchTournament()}
          isRetrying={isFetchingTournament}
        />
      )}
      {hasNoTournament && <div>There are no current tournaments</div>}
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
                  onFinish={() => void utils.tournament.getTournament.invalidate()}
                />
              </div>
            )}
          </div>
        </div>
      )}
      {data && (
        <div
          className={`mt-5 flex h-full w-full flex-row items-center overflow-x-auto`}
        >
          {rounds.length === 0 && <p>Nobody joined the tournament yet!</p>}
          {rounds.map((round, roundIndex) => {
            const seeds = matches.get(round) || [];
            return (
              <div key={`round-${round}`} className="w-60 shrink-0">
                <p className="text-center font-bold">{`Round ${round}`}</p>
                <div className="flex flex-col">
                  {seeds.map((seed, seedIndex) => {
                    // DETERMINE NUMBER OF EMPTY BLOCKS TO ADD TO MAKE THE GRID SQUARE
                    let emptyBlocks = 2 ** roundIndex - 1;
                    const newBlocks = 1 + emptyBlocks;
                    const isLastRound = roundIndex === rounds.length - 1;
                    const prevBlocks = seedIndex * newBlocks;
                    if (prevBlocks + newBlocks >= initialSeeds) {
                      emptyBlocks = initialSeeds - prevBlocks - 1;
                    }
                    emptyBlocks = Math.max(emptyBlocks, 0);
                    // DETERMINE IF BORDER ON EMPTY BLOCK
                    const isTopBlock = seedIndex % 2 === 0;
                    const isBottomBlock = seedIndex % 2 === 1;
                    const isLastBlock = seedIndex === seeds.length - 1;

                    return (
                      <div key={seed.id}>
                        <div className="flex h-32 flex-col">
                          <div className="flex basis-5/6 flex-row items-center">
                            {/* HORIZONTAL INCOMING LINES */}
                            {roundIndex !== 0 && (
                              <div className="basis-1/6">
                                <div className="border-black border-t-2"></div>
                              </div>
                            )}
                            {/* INFORMATION FOR MATCH */}
                            <div className="flex w-full flex-row items-center rounded-md bg-slate-500 p-2">
                              <div className="grow">
                                <UserMatch seed={seed} user={seed.user1} />
                                <div className="border-black py-2">
                                  <hr className="h-px border-0 bg-slate-300" />
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
                                  <Button
                                    type="button"
                                    className="ml-2 shrink-0"
                                    disabled={isJoiningMatch}
                                    loading={
                                      isJoiningMatch &&
                                      joiningMatch?.matchId === seed.id
                                    }
                                    onClick={() =>
                                      joinMatch({
                                        matchId: seed.id,
                                        tournamentId,
                                        originSocketId: pusher?.connection.socket_id,
                                      })
                                    }
                                  >
                                    <Swords className="mr-1 h-4 w-4" />
                                    Fight
                                  </Button>
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
                            {roundIndex !== rounds.length - 1 && (
                              <div className="jutsify-center flex h-full basis-1/6 flex-col">
                                <div
                                  className={`basis-1/2 ${isBottomBlock ? "border-r-2" : ""} border-black`}
                                ></div>
                                <div className="border-black border-t-2"></div>
                                <div
                                  className={`basis-1/2 ${isTopBlock && !isLastBlock ? "border-r-2" : ""} border-black`}
                                ></div>
                              </div>
                            )}
                          </div>
                          <p
                            className={`text-center text-sm italic ${isTopBlock && !isLastBlock && !isLastRound ? "border-r-2" : ""} border-black`}
                          >
                            {seed.createdAt.toLocaleString()}
                          </p>
                        </div>
                        {[...Array(emptyBlocks).keys()].map((emptyIdx) => (
                          <div
                            key={`empty-${seed.id}-${emptyIdx}`}
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

const TOURNAMENT_POLL_INTERVAL_MS = 10_000;
const TOURNAMENT_CLOCK_TICK_MS = 1_000;

interface UserMatchProps {
  seed: TournamentMatch;
  user: { userId: string; username: string; avatar: string | null } | null;
}

const UserMatch: React.FC<UserMatchProps> = (props) => {
  const { seed, user } = props;
  return (
    <div className="flex flex-row items-center">
      {user && (
        <div className="mr-2 w-10 text-center">
          <AvatarImage
            href={user.avatar}
            alt={user.userId}
            size={100}
            hover_effect={true}
          />
        </div>
      )}
      {user ? (
        <Link
          href={`/userid/${user.userId}`}
          className="grow text-slate-100 hover:cursor-pointer hover:text-orange-100"
        >
          {user.username}
        </Link>
      ) : (
        <span className="grow text-slate-100">---</span>
      )}
      {seed.winnerId && seed.winnerId === user?.userId && (
        <Medal className="h-7 w-7 text-green-600" />
      )}
      {seed.winnerId && seed.winnerId !== user?.userId && (
        <ShieldBan className="h-7 w-7 text-red-600" />
      )}
    </div>
  );
};
