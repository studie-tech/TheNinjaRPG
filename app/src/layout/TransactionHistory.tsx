"use client";

import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import type { ColumnDefinitionType } from "@/layout/Table";
import Table from "@/layout/Table";
import { useInfinitePagination } from "@/libs/pagination";
import type { ArrayElement } from "@/utils/typeutils";

/**
 * Transaction History component
 *
 * Omitting userId shows the signed-in user's own history: the server falls back to the
 * session id, so the client never sends an id for a self view and a stale cached profile
 * cannot be mistaken for another account. Callers viewing someone else must pass a
 * definite id - passing an undefined one silently shows the viewer their own history.
 */
export const TransactionHistory: React.FC<{ userId?: string }> = (props) => {
  const { userId } = props;
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);

  const {
    data: transactions,
    fetchNextPage,
    hasNextPage,
  } = api.paypal.getPaypalTransactions.useInfiniteQuery(
    { limit: 10, userId },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
    },
  );
  const allTransactions = transactions?.pages
    .flatMap((page) => page.data)
    .map((transaction) => {
      return {
        ...transaction,
        receiver: transaction.affectedUser?.avatar || IMG_AVATAR_DEFAULT,
        value: `${transaction.amount} ${transaction.currency}`,
      };
    });

  type Transaction = ArrayElement<typeof allTransactions>;

  useInfinitePagination({ fetchNextPage, hasNextPage, lastElement });

  const columns: ColumnDefinitionType<Transaction, keyof Transaction>[] = [
    { key: "receiver", header: "Receiver", type: "avatar" },
    { key: "transactionId", header: "Transaction ID", type: "string" },
    { key: "reputationPoints", header: "Points", type: "string" },
    { key: "value", header: "Amount", type: "string" },
    { key: "type", header: "Type", type: "capitalized" },
    { key: "transactionUpdatedDate", header: "Last Update", type: "string" },
  ];

  // If no previous, do not show
  if (!allTransactions || allTransactions.length === 0) return null;

  return (
    <ContentBox
      title="Transaction History"
      subtitle="Previous purchases"
      initialBreak={true}
      padding={false}
    >
      <Table
        data={allTransactions}
        columns={columns}
        linkPrefix="/userid/"
        setLastElement={setLastElement}
      />
    </ContentBox>
  );
};
