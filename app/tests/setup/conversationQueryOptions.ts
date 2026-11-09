import type { InfiniteData, InfiniteQueryObserverOptions } from "@tanstack/react-query";
import { evaluateExpression, readSource, sliceExpressionAfter } from "./sourceSlice";

// Exercise the hooks' actual options so removing a cache or lifecycle option fails behavior tests.
export const conversationQueryOptions = <TPage>(file: string) => {
  const expression = sliceExpressionAfter(
    readSource(`layout/${file}`),
    /api\.comments\.getConversationComments\.useInfiniteQuery\(\s*queryKey\s*,\s*/,
  );
  return evaluateExpression(expression, { props: { convo_id: "chat" }, conversationId: "chat" }) as Omit<
    InfiniteQueryObserverOptions<TPage, Error, InfiniteData<TPage>>,
    "queryKey" | "queryFn" | "initialPageParam"
  >;
};
