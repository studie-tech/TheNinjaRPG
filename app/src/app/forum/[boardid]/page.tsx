"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Bookmark, Instagram, Lock, Trash2, Unlock } from "lucide-react";
import Link from "next/link";
import { use, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { api } from "@/app/_trpc/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { FORUM_BOARD_THREADS_PER_PAGE, IMG_ICON_FORUM } from "@/drizzle/constants";
import Confirm2 from "@/layout/Confirm2";
import ContentBox from "@/layout/ContentBox";
import ContentImageSelector from "@/layout/ContentImageSelector";
import Image from "@/layout/Image";
import Loader from "@/layout/Loader";
import Post from "@/layout/Post";
import RichInput from "@/layout/RichInput";
import { forumText } from "@/layout/seoTexts";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { useInfinitePagination } from "@/libs/pagination";
import { showMutationToast } from "@/libs/toast";
import { canCreateNews, canModerate, canPostAsAi } from "@/utils/permissions";
import { secondsPassed } from "@/utils/time";
import { useUserData } from "@/utils/UserContext";
import { type ForumBoardSchema, forumBoardSchema } from "@/validators/forum";
import { getSearchValidator } from "@/validators/register";

function Board(properties: { parameters: Promise<{ boardid: string }> }) {
  const parameters = use(properties.parameters);
  const { data: userData } = useUserData();
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);
  const boardIdentifier = parameters.boardid;

  const {
    data: threads,
    fetchNextPage,
    hasNextPage,
    refetch,
  } = api.forum.getThreads.useInfiniteQuery(
    { boardId: boardIdentifier, limit: FORUM_BOARD_THREADS_PER_PAGE },
    {
      enabled: boardIdentifier !== undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
    },
  );
  const allThreads = threads?.pages.flatMap((page) => page.threads);
  const board = threads?.pages[0]?.board;

  useInfinitePagination({
    fetchNextPage,
    hasNextPage,
    lastElement,
  });

  const form = useForm<ForumBoardSchema>({
    defaultValues: {
      board_id: boardIdentifier,
      title: "",
      content: "",
      image: null,
      senderId: null,
    },
    resolver: zodResolver(forumBoardSchema),
  });

  const watchedImage = useWatch({ control: form.control, name: "image" });

  // User search for sender selection (AI posting)
  const maximumUsers = 1;
  const userSearchSchema = getSearchValidator({ max: maximumUsers });
  const userSearchMethods = useForm<z.infer<typeof userSearchSchema>>({
    resolver: zodResolver(userSearchSchema),
    defaultValues: { username: "", users: [] },
  });
  const watchedUsers = useWatch({
    control: userSearchMethods.control,
    name: "users",
    defaultValue: [],
  });
  const senderUser = watchedUsers?.[0];
  const canUserPostAsAi = userData && canPostAsAi(userData.role);
  const isNewsBoard = board?.name === "News";
  const canPostNews = userData && canCreateNews(userData.role);

  const { mutate: createThread, isPending: isCreatingThread } =
    api.forum.createThread.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        await refetch();
        form.reset();
      },
    });

  const { mutate: pinThread, isPending: isPinningThread } =
    api.forum.pinThread.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        await refetch();
      },
    });

  const { mutate: lockThread, isPending: isLockingThread } =
    api.forum.lockThread.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        await refetch();
      },
    });

  const { mutate: deleteThread, isPending: isDeletingThread } =
    api.forum.deleteThread.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        await refetch();
      },
    });

  const onSubmit = form.handleSubmit((data) => {
    createThread({
      ...data,
      image: data.image || null,
      ...(senderUser?.userId ? { senderId: senderUser.userId } : {}),
    });
  });

  if (!board) return <Loader explanation="Loading..."></Loader>;

  const canEdit = userData && canModerate(userData.role);

  return (
    <>
      {!userData && (
        <ContentBox title="Public Forum" defaultBackHref={"/forum/"}>
          {forumText}
        </ContentBox>
      )}
      <ContentBox
        title="Forum"
        defaultBackHref={userData ? "/forum/" : undefined}
        initialBreak={!userData}
        subtitle={board.name}
        topRightContent={
          userData &&
          !userData.isBanned &&
          !userData.isSilenced && (
            <div className="flex flex-row items-center">
              <Confirm2
                title="Create a new thread"
                proceed_label="Submit"
                button={
                  <Button id="create" disabled={isCreatingThread}>
                    {isCreatingThread ? "Creating..." : "New Thread"}
                  </Button>
                }
                isValid={form.formState.isValid}
                onAccept={onSubmit}
              >
                <Form {...form}>
                  <form className="space-y-2" onSubmit={onSubmit}>
                    {canUserPostAsAi && (
                      <div>
                        <FormLabel>Sender</FormLabel>
                        <UserSearchSelect
                          useFormMethods={userSearchMethods}
                          label="Post as (leave empty to post as yourself)"
                          selectedUsers={[]}
                          showYourself={true}
                          showAi={true}
                          inline={true}
                          maxUsers={maximumUsers}
                        />
                      </div>
                    )}
                    <FormField
                      control={form.control}
                      name="title"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Title</FormLabel>
                          <FormControl>
                            <Input placeholder="Title for your thread" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <RichInput
                      id="content"
                      label="Contents of your thread"
                      height="300"
                      placeholder=""
                      control={form.control}
                      error={form.formState.errors.content?.message}
                    />
                    {isNewsBoard && canPostNews && (
                      <div className="mt-4 space-y-3">
                        <ContentImageSelector
                          label="News Image (for Instagram)"
                          imageUrl={watchedImage}
                          id={boardIdentifier}
                          prompt={form.getValues("title") || "News announcement"}
                          allowImageUpload={true}
                          type="ai"
                          size="square"
                          maxDim={1080}
                          onUploadComplete={(url) => form.setValue("image", url)}
                        />
                        <Alert>
                          <Instagram className="h-4 w-4" />
                          <AlertTitle>Instagram Integration</AlertTitle>
                          <AlertDescription>
                            Adding an image will automatically post this news to
                            Instagram. Without an image, news will only be posted to
                            Discord and Facebook.
                          </AlertDescription>
                        </Alert>
                      </div>
                    )}
                  </form>
                </Form>
              </Confirm2>
            </div>
          )
        }
      >
        {allThreads?.length === 0 && <div>No threads found</div>}
        {allThreads?.map((thread, i) => {
          // Icons, which have to be clickable for moderators+, but just shown otherwise
          const MyBookmark = (
            <div className={isPinningThread ? "opacity-50" : ""}>
              <Bookmark
                className={`mr-2 h-6 w-6 ${thread.isPinned ? "text-orange-500" : canEdit ? "hover:text-orange-500" : ""}`}
              />
            </div>
          );
          const MyLockIcon = thread.isLocked ? (
            <div className={isLockingThread ? "opacity-50" : ""}>
              <Lock className="h-6 w-6 text-orange-500" />
            </div>
          ) : (
            <div className={isLockingThread ? "opacity-50" : ""}>
              <Unlock className={`h-6 w-6 ${canEdit ? "hover:text-orange-500" : ""}`} />
            </div>
          );
          const MyDeleteIcon = (
            <div className={isDeletingThread ? "opacity-50" : ""}>
              <Trash2
                className={`ml-2 h-6 w-6 ${canEdit ? "hover:text-orange-500" : ""}`}
              />
            </div>
          );
          // Dynamic Names
          const pinAction = thread.isPinned ? "unpin" : "pin";
          const lockAction = thread.isLocked ? "unlock" : "lock";
          let title = thread.title;
          title = thread.isLocked ? `[Locked] ${title}` : title;
          title = thread.isPinned ? `[Pinned] ${title}` : title;

          return (
            <div
              key={thread.id}
              ref={i === allThreads.length - 1 ? setLastElement : null}
            >
              <Link href={`/forum/${board.id}/${thread.id}`}>
                <Post
                  title={title}
                  hover_effect={true}
                  align_middle={true}
                  image={
                    <div className="mr-3 basis-1/12">
                      <Image
                        src={IMG_ICON_FORUM}
                        width={100}
                        height={100}
                        alt="Forum Icon"
                        className={
                          secondsPassed(thread.updatedAt) > 3600 * 24
                            ? "opacity-50"
                            : ""
                        }
                      ></Image>
                    </div>
                  }
                  options={
                    <div className="ml-3">
                      <div className="mt-2 flex flex-row items-center">
                        {userData && canModerate(userData.role) ? (
                          <>
                            <Confirm2
                              title={`Confirm ${pinAction}ning thread`}
                              button={MyBookmark}
                              disabled={isPinningThread}
                              onAccept={(e) => {
                                e.preventDefault();
                                pinThread({
                                  thread_id: thread.id,
                                  status: !thread.isPinned,
                                });
                              }}
                            >
                              You are about to {pinAction} a thread. Are you sure?
                            </Confirm2>
                            <Confirm2
                              title={`Confirm ${lockAction}ing thread`}
                              button={MyLockIcon}
                              disabled={isLockingThread}
                              onAccept={(e) => {
                                e.preventDefault();
                                lockThread({
                                  thread_id: thread.id,
                                  status: !thread.isLocked,
                                });
                              }}
                            >
                              You are about to {lockAction} a thread. Are you sure?
                            </Confirm2>
                            <Confirm2
                              title={`Confirm deleting thread`}
                              button={MyDeleteIcon}
                              disabled={isDeletingThread}
                              onAccept={(e) => {
                                e.preventDefault();
                                deleteThread({ thread_id: thread.id });
                              }}
                            >
                              You are about to delete a thread. Are you sure?
                            </Confirm2>
                          </>
                        ) : (
                          <>
                            {MyBookmark}
                            {MyLockIcon}
                          </>
                        )}
                      </div>
                      <div className="mt-2">
                        <span className="font-bold">{board.nPosts} </span> replies
                      </div>
                    </div>
                  }
                >
                  Started by {thread.user.username},{" "}
                  {thread.createdAt.toLocaleDateString()}
                </Post>
              </Link>
            </div>
          );
        })}
      </ContentBox>
    </>
  );
}

export default Board;
