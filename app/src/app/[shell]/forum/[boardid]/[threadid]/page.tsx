import { ThreadScreen } from "@/screens/forum/ThreadScreen";

export default async function ThreadPage(props: {
  params: Promise<{ threadid: string; boardid: string }>;
  searchParams: Promise<{ post?: string }>;
}) {
  return (
    <ThreadScreen params={await props.params} searchParams={await props.searchParams} />
  );
}
