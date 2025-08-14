"use client";

import { useState, useEffect, use } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import Image from "next/image";
import Loader from "@/layout/Loader";
import ContentBox from "@/layout/ContentBox";
import RichInput from "@/layout/RichInput";
import Post from "@/layout/Post";
import Confirm2 from "@/layout/Confirm2";
import {
  Form,
  FormControl,
  FormField,
  FormLabel,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { forumText } from "@/layout/seoTexts";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { showMutationToast } from "@/libs/toast";
import { Bookmark, Lock, Unlock, Trash2 } from "lucide-react";
import { api } from "@/app/_trpc/client";
import { forumBoardSchema, type ForumBoardSchema } from "@/validators/forum";
import { useUserData } from "@/utils/UserContext";
import { secondsPassed } from "@/utils/time";
import { useInfinitePagination } from "@/libs/pagination";
import { canModerate, canPostAsAi } from "@/utils/permissions";
import { IMG_ICON_FORUM } from "@/drizzle/constants";
import { getSearchValidator } from "@/validators/register";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { useWatch } from "react-hook-form";
import type { z } from "zod";

export default function Board(props: { params: Promise<{ boardid: string }> }) {
  const params = use(props.params);
  const { data: userData } = useUserData();
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);
  const board_id = params.boardid;

  const {
    data: threads,
    fetchNextPage,
    hasNextPage,
    refetch,
  } = api.forum.getThreads.useInfiniteQuery(
    { board_id: board_id, limit: 20 },
    {
      enabled: board_id !== undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
    },
  );
  const allThreads = threads?.pages.map((page) => page.threads).flat();
  const board = threads?.pages[0]?.board;

  useInfinitePagination({
    fetchNextPage,
    hasNextPage,
    lastElement,
  });

  const form = useForm<ForumBoardSchema>({
    resolver: zodResolver(forumBoardSchema),
  });

  // User search for sender selection (AI posting)
  const maxUsers = 1;
  const userSearchSchema = getSearchValidator({ max: maxUsers });
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
  const canPostAsAI = userData && canPostAsAi(userData.role);

  const { mutate: createThread, isPending: l1 } = api.forum.createThread.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      await refetch();
      form.reset();
    },
  });

  const { mutate: pinThread, isPending: l2 } = api.forum.pinThread.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      await refetch();
    },
  });

  const { mutate: lockThread, isPending: l3 } = api.forum.lockThread.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      await refetch();
    },
  });

  const { mutate: deleteThread, isPending: l4 } = api.forum.deleteThread.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      await refetch();
    },
  });

  useEffect(() => {
    if (board) {
      form.setValue("board_id", board.id);
    }
  }, [board, form]);

  const onSubmit = form.handleSubmit((data) => {
    createThread({
      ...data,
      ...(senderUser?.userId ? { senderId: senderUser.userId } : {}),
    });
  });

  if (!board) return <Loader explanation="Loading..."></Loader>;

  const isPending = l1 || l2 || l3 || l4;
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
        initialBreak={userData ? false : true}
        subtitle={board.name}
        topRightContent={
          <>
            {isPending && <Loader></Loader>}
            {userData && !userData.isBanned && !userData.isSilenced && !isPending && (
              <div className="flex flex-row items-center">
                <Confirm2
                  title="Create a new thread"
                  proceed_label="Submit"
                  button={<Button id="create">New Thread</Button>}
                  isValid={form.formState.isValid}
                  onAccept={onSubmit}
                >
                  <Form {...form}>
                    <form className="space-y-2" onSubmit={onSubmit}>
                      {canPostAsAI && (
                        <div>
                          <FormLabel>Sender</FormLabel>
                          <UserSearchSelect
                            useFormMethods={userSearchMethods}
                            label="Post as (leave empty to post as yourself)"
                            selectedUsers={[]}
                            showYourself={true}
                            showAi={true}
                            inline={true}
                            maxUsers={maxUsers}
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
                    </form>
                  </Form>
                </Confirm2>
              </div>
            )}
          </>
        }
      >
        {allThreads?.length === 0 && <div>No threads found</div>}
        {allThreads?.map((thread, i) => {
          // Icons, which have to be clickable for moderators+, but just shown otherwise
          const MyBookmark = (
            <Bookmark
              className={`mr-2 h-6 w-6 ${
                thread.isPinned
                  ? "text-orange-500"
                  : canEdit
                    ? "hover:text-orange-500"
                    : ""
              }`}
            />
          );
          const MyLockIcon = thread.isLocked ? (
            <Lock className="h-6 w-6 text-orange-500" />
          ) : (
            <Unlock className={`h-6 w-6 ${canEdit ? "hover:text-orange-500" : ""}`} />
          );
          const MyDeleteIcon = (
            <Trash2
              className={`ml-2 h-6 w-6 ${canEdit ? "hover:text-orange-500" : ""}`}
            />
          );
          // Dynamic Names
          const pinAction = thread.isPinned ? "unpin" : "pin";
          const lockAction = thread.isLocked ? "unlock" : "lock";
          let title = thread.title;
          title = thread.isLocked ? "[Locked] " + title : title;
          title = thread.isPinned ? "[Pinned] " + title : title;

          return (
            <div
              key={thread.id}
              ref={i === allThreads.length - 1 ? setLastElement : null}
            >
              <Link href={"/forum/" + board.id + "/" + thread.id}>
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
                      <div className="mt-2 flex flex-row items-center ">
                        {userData && canModerate(userData.role) ? (
                          <>
                            <Confirm2
                              title={`Confirm ${pinAction}ning thread`}
                              button={MyBookmark}
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
