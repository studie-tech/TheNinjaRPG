import { BoardScreen } from "@/screens/forum/BoardScreen";

export default async function BoardPage(props: {
  params: Promise<{ boardid: string }>;
}) {
  return <BoardScreen params={await props.params} />;
}
