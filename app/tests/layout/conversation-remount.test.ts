import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type InfiniteData,
  InfiniteQueryObserver,
  QueryClient,
} from "@tanstack/react-query";
import { waitFor } from "@testing-library/react";
import { conversationQueryOptions } from "../setup/conversationQueryOptions";

type ChatPage = {
  data: string[];
  convo: { id: string } | null;
  restrictionMessage: string | null;
  nextCursor: number | null | undefined;
};

const sourceRoot = join(import.meta.dirname, "../../src");
const provider = readFileSync(join(sourceRoot, "app/_trpc/Provider.tsx"), "utf8");
const staleTimeExpression = provider.match(/\bstaleTime:\s*([^,\n]+)/)?.[1];
if (!staleTimeExpression) throw new Error("Provider query staleTime was not found");
const staleTime = new Function(`return (${staleTimeExpression});`)() as number;

describe("cached conversation remounts", () => {
  it("shares immutable conversation writes with other observers and keeps pagination and refetch working", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime, retry: false } },
    });
    const queryKey = ["conversation-comments"];
    const reads: unknown[] = [];
    let version = "initial";
    const options = {
      ...conversationQueryOptions<ChatPage>("Conversation.tsx"),
      queryKey,
      initialPageParam: null,
      enabled: false,
      queryFn: async ({ pageParam }: { pageParam: unknown }): Promise<ChatPage> => {
        reads.push(pageParam);
        return {
          data: [`${version} page ${pageParam ?? 0}`],
          convo: { id: "chat" },
          restrictionMessage: null,
          nextCursor: pageParam === null ? 1 : null,
        };
      },
    };
    const observer = new InfiniteQueryObserver(client, options);
    const otherObserver = new InfiniteQueryObserver(client, options);
    const unsubscribe = observer.subscribe(() => {});
    const unsubscribeOther = otherObserver.subscribe(() => {});
    try {
      await observer.refetch();
      const beforeInsert = observer.getCurrentResult().data!;
      client.setQueryData<InfiniteData<ChatPage>>(
        queryKey,
        (old) =>
          old && {
            pageParams: old.pageParams,
            pages: old.pages.map((page) => ({
              ...page,
              data: ["incoming", ...page.data],
            })),
          },
      );
      const afterInsert = observer.getCurrentResult().data!;
      expect(afterInsert).not.toBe(beforeInsert);
      expect(beforeInsert.pages[0]?.data).toEqual(["initial page 0"]);
      expect(afterInsert.pages[0]?.data).toEqual(["incoming", "initial page 0"]);
      expect(otherObserver.getCurrentResult().data).toBe(afterInsert);

      await observer.fetchNextPage();
      const afterPagination = observer.getCurrentResult().data!;
      expect(afterPagination.pages[0]).toBe(afterInsert.pages[0]);
      expect(afterPagination.pages[1]?.data).toEqual(["initial page 1"]);
      expect(afterPagination.pageParams).toEqual([null, 1]);
      expect(observer.getCurrentResult().hasNextPage).toBe(false);
      expect(otherObserver.getCurrentResult().data).toBe(afterPagination);

      version = "refetched";
      await observer.refetch();
      const afterRefetch = observer.getCurrentResult().data!;
      expect(afterRefetch.pages.map((page) => page.data)).toEqual([
        ["refetched page 0"],
        ["refetched page 1"],
      ]);
      expect(afterPagination.pages[0]?.data).toEqual(["incoming", "initial page 0"]);
      expect(afterRefetch.pageParams).toEqual([null, 1]);
      expect(reads).toEqual([null, 1, null, 1]);
      expect(otherObserver.getCurrentResult().data).toBe(afterRefetch);

      // A distinct query keeps TanStack Query's default sharing behavior.
      const otherKey = ["other-comments"];
      client.setQueryData(otherKey, { data: ["unchanged"] });
      const unrelated = client.getQueryData(otherKey);
      client.setQueryData(otherKey, { data: ["unchanged"] });
      expect(client.getQueryData(otherKey)).toBe(unrelated);
    } finally {
      unsubscribe();
      unsubscribeOther();
      client.clear();
    }
  });

  for (const file of ["Conversation.tsx", "TeamChatPanel.tsx"]) {
    it(`${file} refreshes missed parental restrictions and recovers when reopened`, async () => {
      const client = new QueryClient({
        defaultOptions: { queries: { staleTime, retry: false } },
      });
      const queryKey = [
        ["comments", "getConversationComments"],
        { convo_id: "chat", type: "infinite" },
      ];
      let restricted = false;
      let reads = 0;
      const mount = () =>
        new InfiniteQueryObserver(client, {
          ...conversationQueryOptions<ChatPage>(file),
          queryKey,
          initialPageParam: null,
          queryFn: async (): Promise<ChatPage> => {
            reads++;
            return {
              data: restricted ? [] : ["Permitted chat history"],
              convo: restricted ? null : { id: "chat" },
              restrictionMessage: restricted
                ? "Private messages are disabled by parental controls."
                : null,
              nextCursor: undefined,
            };
          },
        });
      let observer = mount();
      let unsubscribe = observer.subscribe(() => {});
      try {
        await waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true));
        expect(reads).toBe(1);
        expect(observer.getCurrentResult().data?.pages[0]?.data).toEqual([
          "Permitted chat history",
        ]);
        unsubscribe();
        restricted = true;

        observer = mount();
        unsubscribe = observer.subscribe(() => {});
        await waitFor(() =>
          expect(observer.getCurrentResult().data?.pages[0]?.restrictionMessage).toBe(
            "Private messages are disabled by parental controls.",
          ),
        );
        expect(reads).toBe(2);
        expect(observer.getCurrentResult().data?.pages[0]?.data).toEqual([]);
        expect(observer.getCurrentResult().data?.pages[0]?.convo).toBeNull();
        unsubscribe();
        restricted = false;

        observer = mount();
        unsubscribe = observer.subscribe(() => {});
        await waitFor(() =>
          expect(
            observer.getCurrentResult().data?.pages[0]?.restrictionMessage,
          ).toBeNull(),
        );
        expect(reads).toBe(3);
        expect(observer.getCurrentResult().data?.pages[0]?.data).toEqual([
          "Permitted chat history",
        ]);
      } finally {
        unsubscribe();
        client.clear();
      }
    });
  }
});
